/**
 * Background-side handling of messages sent by the highlight content
 * script. Registered once from background/background.ts.
 */
import {
  checkBookmarkUrl,
  deleteHighlight,
  getBookmarkCrawledHtml,
  getHighlightsForBookmark,
  updateHighlight,
} from "./api";
import { HIGHLIGHT_MESSAGE, isLocalHighlightId } from "./messages";
import type {
  CreateHighlightRequest,
  CreateHighlightResponse,
  DeleteHighlightRequest,
  DeleteHighlightResponse,
  GetBookmarkStateRequest,
  GetBookmarkStateResponse,
  HighlightRequest,
  HighlightWithOccurrence,
  SyncedBroadcast,
  UpdateHighlightRequest,
  UpdateHighlightResponse,
} from "./messages";
import {
  crawledContextForOffset,
  occurrenceIndexForCrawledOffset,
} from "./offsetMapping";
import {
  addPending,
  listPendingForBookmark,
  removePending,
  syncPendingHighlights,
  updatePending,
} from "./pendingQueue";
import type { PendingHighlight } from "./pendingQueue";

export function registerHighlightMessageHandlers() {
  chrome.runtime.onMessage.addListener(
    (message: HighlightRequest, _sender, sendResponse) => {
      if (!message || typeof message !== "object" || !("type" in message)) {
        return undefined;
      }
      switch (message.type) {
        case HIGHLIGHT_MESSAGE.GET_BOOKMARK_STATE:
          handleGetBookmarkState(message).then(sendResponse);
          return true;
        case HIGHLIGHT_MESSAGE.CREATE:
          handleCreate(message).then(sendResponse);
          return true;
        case HIGHLIGHT_MESSAGE.UPDATE:
          handleUpdate(message).then(sendResponse);
          return true;
        case HIGHLIGHT_MESSAGE.DELETE:
          handleDelete(message).then(sendResponse);
          return true;
        default:
          return undefined;
      }
    },
  );
}

async function handleGetBookmarkState(
  req: GetBookmarkStateRequest,
): Promise<GetBookmarkStateResponse> {
  const bookmarkId = await checkBookmarkUrl(req.url).catch(() => null);
  if (!bookmarkId) {
    return { bookmarkId: null, highlights: [], pending: [] };
  }
  const [highlights, pending] = await Promise.all([
    getHighlightsForBookmark(bookmarkId).catch(() => []),
    listPendingForBookmark(bookmarkId),
  ]);

  const crawledHtml =
    highlights.length > 0
      ? await getBookmarkCrawledHtml(bookmarkId).catch(() => null)
      : null;
  const highlightsWithOccurrence: HighlightWithOccurrence[] = highlights.map(
    (h) => ({
      ...h,
      occurrenceIndex:
        crawledHtml && h.text
          ? occurrenceIndexForCrawledOffset(crawledHtml, h.text, h.startOffset)
          : 0,
      context:
        crawledHtml && h.text
          ? crawledContextForOffset(crawledHtml, h.startOffset, h.text.length)
          : { prefix: "", suffix: "" },
    }),
  );

  return { bookmarkId, highlights: highlightsWithOccurrence, pending };
}

async function handleCreate(
  req: CreateHighlightRequest,
): Promise<CreateHighlightResponse> {
  await addPending({
    localId: req.localId,
    bookmarkId: req.bookmarkId,
    text: req.text,
    note: req.note,
    color: req.color,
    occurrenceIndex: req.occurrenceIndex,
    context: req.context,
  });
  // Best-effort immediate attempt — if the crawl already finished this lands
  // right away; otherwise the alarm-driven poll (background.ts) picks it up.
  void runPendingHighlightSyncPass();
  return { ok: true };
}

async function handleUpdate(
  req: UpdateHighlightRequest,
): Promise<UpdateHighlightResponse> {
  try {
    if (isLocalHighlightId(req.highlightId)) {
      const patch: Partial<Pick<PendingHighlight, "color" | "note">> = {};
      if (req.color !== undefined) patch.color = req.color;
      if (req.note !== undefined) patch.note = req.note;
      await updatePending(req.highlightId, patch);
    } else {
      await updateHighlight({
        highlightId: req.highlightId,
        color: req.color,
        note: req.note,
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function handleDelete(
  req: DeleteHighlightRequest,
): Promise<DeleteHighlightResponse> {
  try {
    if (isLocalHighlightId(req.highlightId)) {
      await removePending(req.highlightId);
    } else {
      await deleteHighlight(req.highlightId);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Drains the pending queue and tells every tab about anything that just
 * synced, so content scripts can swap a locally-rendered mark's id for the
 * real one. Called on-demand right after a create, and periodically from a
 * chrome.alarms listener in background.ts (service workers can be
 * suspended, so setInterval isn't reliable here).
 */
export async function runPendingHighlightSyncPass(): Promise<void> {
  const { synced } = await syncPendingHighlights().catch(() => ({
    synced: [],
    stalled: [],
  }));
  if (synced.length === 0) {
    return;
  }
  const tabs = await chrome.tabs.query({});
  for (const entry of synced) {
    const msg: SyncedBroadcast = {
      type: HIGHLIGHT_MESSAGE.SYNCED,
      bookmarkId: entry.bookmarkId,
      localId: entry.localId,
      highlightId: entry.highlightId,
    };
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {
        // No content script in that tab (or it's not the highlighted page) — fine.
      });
    }
  }
}
