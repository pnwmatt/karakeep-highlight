/**
 * Message contracts between the highlight content script and the
 * background service worker. Network calls always happen in the
 * background, never the content script, since content scripts run in the
 * page's origin and may be blocked by the page's own CSP.
 */
import type { ZHighlight, ZHighlightColor } from "@karakeep/shared/types/highlights";

import type { PendingHighlight } from "./pendingQueue";

export const HIGHLIGHT_MESSAGE = {
  GET_BOOKMARK_STATE: "HIGHLIGHT_GET_BOOKMARK_STATE",
  CREATE: "HIGHLIGHT_CREATE",
  UPDATE: "HIGHLIGHT_UPDATE",
  DELETE: "HIGHLIGHT_DELETE",
  SYNCED: "HIGHLIGHT_SYNCED",
} as const;

/** Prefix distinguishing not-yet-synced highlight ids from real server ids. */
export const LOCAL_ID_PREFIX = "local:";

export function isLocalHighlightId(id: string): boolean {
  return id.startsWith(LOCAL_ID_PREFIX);
}

export function newLocalHighlightId(): string {
  return `${LOCAL_ID_PREFIX}${crypto.randomUUID()}`;
}

export interface GetBookmarkStateRequest {
  type: typeof HIGHLIGHT_MESSAGE.GET_BOOKMARK_STATE;
  url: string;
}

/**
 * A server highlight only carries a crawled-content offset, which doesn't
 * tell the content script which occurrence of `text` on the *live* page it
 * is. The background precomputes that (it already has the crawled content
 * on hand via offsetMapping.occurrenceIndexForCrawledOffset) so the content
 * script can relocate it with liveRelocate.findLiveRange (matching the
 * surrounding `context`, with the occurrence index as a fallback).
 */
export type HighlightWithOccurrence = ZHighlight & {
  occurrenceIndex: number;
  /** Prefix/suffix around the highlight in the crawled content (may be empty). */
  context: { prefix: string; suffix: string };
};

export interface GetBookmarkStateResponse {
  bookmarkId: string | null;
  highlights: HighlightWithOccurrence[];
  pending: PendingHighlight[];
}

export interface CreateHighlightRequest {
  type: typeof HIGHLIGHT_MESSAGE.CREATE;
  localId: string;
  bookmarkId: string;
  text: string;
  note: string | null;
  color: ZHighlightColor;
  occurrenceIndex: number;
  /** Prefix/suffix around the selection, used to anchor against crawled HTML. */
  context: { prefix: string; suffix: string };
}
export type CreateHighlightResponse = { ok: true } | { ok: false; error: string };

export interface UpdateHighlightRequest {
  type: typeof HIGHLIGHT_MESSAGE.UPDATE;
  highlightId: string;
  color?: ZHighlightColor;
  note?: string | null;
}
export type UpdateHighlightResponse = { ok: true } | { ok: false; error: string };

export interface DeleteHighlightRequest {
  type: typeof HIGHLIGHT_MESSAGE.DELETE;
  highlightId: string;
}
export type DeleteHighlightResponse = { ok: true } | { ok: false; error: string };

/** Broadcast from background to every tab once a pending highlight lands. */
export interface SyncedBroadcast {
  type: typeof HIGHLIGHT_MESSAGE.SYNCED;
  bookmarkId: string;
  localId: string;
  highlightId: string;
}

export type HighlightRequest =
  | GetBookmarkStateRequest
  | CreateHighlightRequest
  | UpdateHighlightRequest
  | DeleteHighlightRequest;
