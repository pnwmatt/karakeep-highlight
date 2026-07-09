/**
 * Local cache of not-yet-synced highlights, keyed by a local id. A highlight
 * is written here the instant the user creates it (rendered on the live page
 * immediately from this entry), then drained once the bookmark's crawl
 * completes and a Karakeep-coordinate offset can be computed (see
 * offsetMapping.ts). This mirrors Webtero's existing "annotate now, the save
 * races in the background" flow, generalized to "wait for the crawl, then
 * compute the correct offset" — and makes highlight creation resilient to
 * transient network failures, since nothing is lost if a POST fails.
 */
import type { ZHighlightColor } from "@karakeep/shared/types/highlights";

import { createHighlight, getBookmarkCrawledHtml } from "./api";
import { computeCrawledContentOffsets } from "./offsetMapping";

export interface PendingHighlight {
  localId: string;
  bookmarkId: string;
  text: string;
  note: string | null;
  color: ZHighlightColor;
  /** Which occurrence of `text` on the live page this highlight targets. */
  occurrenceIndex: number;
  /**
   * Text immediately before/after the selection on the live page. Primary
   * anchor for locating the selection within the crawled article (the
   * occurrence index is only a fallback). Optional for backward-compat with
   * entries queued before this field existed.
   */
  context?: { prefix: string; suffix: string };
  createdAt: number;
  attempts: number;
}

const STORAGE_KEY = "karakeep-pending-highlights";
const MAX_ATTEMPTS = 20;

async function readAll(): Promise<PendingHighlight[]> {
  const { [STORAGE_KEY]: entries } = await chrome.storage.local.get(
    STORAGE_KEY,
  );
  return Array.isArray(entries) ? (entries as PendingHighlight[]) : [];
}

async function writeAll(entries: PendingHighlight[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: entries });
}

export async function addPending(
  entry: Omit<PendingHighlight, "createdAt" | "attempts">,
): Promise<void> {
  const entries = await readAll();
  entries.push({ ...entry, createdAt: Date.now(), attempts: 0 });
  await writeAll(entries);
}

export async function removePending(localId: string): Promise<void> {
  const entries = await readAll();
  await writeAll(entries.filter((e) => e.localId !== localId));
}

export async function listPendingForBookmark(
  bookmarkId: string,
): Promise<PendingHighlight[]> {
  return (await readAll()).filter((e) => e.bookmarkId === bookmarkId);
}

export async function getPending(
  localId: string,
): Promise<PendingHighlight | null> {
  return (await readAll()).find((e) => e.localId === localId) ?? null;
}

export async function updatePending(
  localId: string,
  patch: Partial<Pick<PendingHighlight, "color" | "note">>,
): Promise<PendingHighlight | null> {
  const entries = await readAll();
  const idx = entries.findIndex((e) => e.localId === localId);
  if (idx === -1) {
    return null;
  }
  entries[idx] = { ...entries[idx], ...patch };
  await writeAll(entries);
  return entries[idx];
}

/**
 * Attempts to sync every pending highlight whose bookmark has finished
 * crawling. Returns the ids that were successfully created on the server
 * (callers use this to swap the locally-rendered mark's id for the real
 * one) and the ids that hit MAX_ATTEMPTS without a matching offset (left in
 * the queue but reported so the UI can flag them as unsynced).
 */
export async function syncPendingHighlights(): Promise<{
  synced: { localId: string; bookmarkId: string; highlightId: string }[];
  stalled: string[];
}> {
  const entries = await readAll();
  if (entries.length === 0) {
    return { synced: [], stalled: [] };
  }

  const synced: { localId: string; bookmarkId: string; highlightId: string }[] =
    [];
  const stalled: string[] = [];
  const remaining: PendingHighlight[] = [];
  const crawledHtmlCache = new Map<string, string | null>();

  for (const entry of entries) {
    let html = crawledHtmlCache.get(entry.bookmarkId);
    if (html === undefined) {
      try {
        html = await getBookmarkCrawledHtml(entry.bookmarkId);
      } catch {
        html = null;
      }
      crawledHtmlCache.set(entry.bookmarkId, html);
    }

    if (!html) {
      // Crawl not done yet (or failed) — keep waiting.
      remaining.push(entry);
      continue;
    }

    const offsets = computeCrawledContentOffsets(
      html,
      entry.text,
      entry.occurrenceIndex,
      entry.context,
    );
    if (!offsets) {
      const attempts = entry.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        stalled.push(entry.localId);
        // Drop it — the crawled content will never contain this text (the
        // live page diverged too much from the crawl). Keep it rendered
        // locally; it just won't exist in Karakeep proper.
        continue;
      }
      remaining.push({ ...entry, attempts });
      continue;
    }

    try {
      const highlight = await createHighlight({
        bookmarkId: entry.bookmarkId,
        startOffset: offsets.startOffset,
        endOffset: offsets.endOffset,
        color: entry.color,
        text: entry.text,
        note: entry.note,
      });
      synced.push({
        localId: entry.localId,
        bookmarkId: entry.bookmarkId,
        highlightId: highlight.id,
      });
    } catch {
      remaining.push({ ...entry, attempts: entry.attempts + 1 });
    }
  }

  await writeAll(remaining);
  return { synced, stalled };
}
