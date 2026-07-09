/**
 * Thin wrapper around the real @karakeep/trpc highlights router, using the
 * same tRPC client the popup already uses (see ../../utils/trpc.ts).
 */
import type {
  ZHighlight,
  zNewHighlightSchema,
  zUpdateHighlightSchema,
} from "@karakeep/shared/types/highlights";
import type { z } from "zod";

import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import { getApiClient } from "../../utils/trpc";

export type NewHighlightInput = z.infer<typeof zNewHighlightSchema>;
export type UpdateHighlightInput = z.infer<typeof zUpdateHighlightSchema>;

async function client() {
  const api = await getApiClient();
  if (!api) {
    throw new Error("Karakeep is not configured (missing server/API key)");
  }
  return api;
}

export async function createHighlight(
  input: NewHighlightInput,
): Promise<ZHighlight> {
  return (await client()).highlights.create.mutate(input);
}

export async function updateHighlight(
  input: UpdateHighlightInput,
): Promise<ZHighlight> {
  return (await client()).highlights.update.mutate(input);
}

export async function deleteHighlight(
  highlightId: string,
): Promise<ZHighlight> {
  return (await client()).highlights.delete.mutate({ highlightId });
}

/**
 * Resolves a URL to a bookmark id, uncached. `utils/badgeCache.ts`'s
 * getBadgeStatus() also does this, but through a long-lived SWR cache
 * (default 1hr) meant for the toolbar badge count, where staleness is
 * harmless — reusing it here meant highlighting could get stuck with a
 * stale/deleted bookmarkId for up to an hour (e.g. after a bookmark is
 * deleted and re-saved for the same URL), 404ing on every subsequent
 * getBookmarkCrawledHtml/getHighlightsForBookmark/create call. Highlighting
 * needs the real current id every time, so it bypasses that cache.
 */
export async function checkBookmarkUrl(url: string): Promise<string | null> {
  const res = await (await client()).bookmarks.checkUrl.query({ url });
  return res.bookmarkId;
}

export async function getHighlightsForBookmark(
  bookmarkId: string,
): Promise<ZHighlight[]> {
  const res = await (
    await client()
  ).highlights.getForBookmark.query({ bookmarkId });
  return res.highlights;
}

/**
 * Fetches the bookmark's crawled HTML content — the coordinate system
 * Karakeep's own reader anchors highlight offsets to (see offsetMapping.ts).
 * Returns null if the bookmark hasn't finished crawling yet, isn't a link
 * bookmark, or crawling failed.
 */
export async function getBookmarkCrawledHtml(
  bookmarkId: string,
): Promise<string | null> {
  const bookmark = await (
    await client()
  ).bookmarks.getBookmark.query({ bookmarkId, includeContent: true });
  if (bookmark.content.type !== BookmarkTypes.LINK) {
    return null;
  }
  return bookmark.content.htmlContent ?? null;
}
