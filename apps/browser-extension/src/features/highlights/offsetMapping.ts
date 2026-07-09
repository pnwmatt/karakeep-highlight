/**
 * Karakeep's highlight offset model: a character offset computed by a
 * TreeWalker(SHOW_TEXT) walk over the bookmark's own crawled content
 * (content.htmlContent), NOT the live page's DOM — see
 * packages/shared-react/components/BookmarkHtmlHighlighter.tsx's
 * getTextNodeOffset/getRangeFromHighlight, which the web reader uses to
 * place highlight spans. The server does no independent validation
 * (packages/trpc/routers/highlights.ts just stores what it's given), so
 * offsets computed against anything other than the crawled content will
 * render in the wrong place — or not at all — in Karakeep's own reader.
 *
 * This module computes offsets in that same coordinate system, but against
 * a detached document parsed from the crawled HTML (fetched separately via
 * api.getBookmarkCrawledHtml), since the extension highlights the live page,
 * not a copy of the crawled content rendered into its own container.
 */
import type { SelectionContext } from "./textWalk";
import {
  contextAround,
  findContextMatchedOffset,
  getFullText,
  textNodeRangesForOffsets,
} from "./textWalk";

export interface HighlightOffsets {
  startOffset: number;
  endOffset: number;
}

export function parseCrawledHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/**
 * Finds the occurrence of `text` within crawled `html` that best matches the
 * `context` captured at selection time (liveRelocate.describeSelection),
 * falling back to `occurrenceIndex`, and returns Karakeep-coordinate offsets.
 * Context matching is what makes this robust across the live-page vs.
 * crawled-article coordinate mismatch (see textWalk.findContextMatchedOffset).
 */
export function computeCrawledContentOffsets(
  html: string,
  text: string,
  occurrenceIndex: number,
  context?: SelectionContext,
): HighlightOffsets | null {
  const doc = parseCrawledHtml(html);
  const full = getFullText(doc.body);
  const start = findContextMatchedOffset(full, text, context, occurrenceIndex);
  if (start === -1) {
    return null;
  }
  return { startOffset: start, endOffset: start + text.length };
}

/**
 * Reverse direction: given crawled `html` and known Karakeep-coordinate
 * offsets, return the text-node ranges they cover. Not needed for the live
 * render path (liveRelocate.ts handles that independently), but useful for
 * verifying computeCrawledContentOffsets against BookmarkHtmlHighlighter's
 * own algorithm during development.
 */
export function textNodeRangesForCrawledOffsets(
  html: string,
  offsets: HighlightOffsets,
) {
  const doc = parseCrawledHtml(html);
  return textNodeRangesForOffsets(
    doc.body,
    offsets.startOffset,
    offsets.endOffset,
  );
}

/**
 * Prefix/suffix text around a crawled-content offset, so the content script
 * can relocate a server highlight onto the live page by matching context
 * rather than an occurrence index (which doesn't survive the jump between the
 * crawled article's coordinate system and the live page's). Mirrors the
 * context captured at selection time in liveRelocate.describeSelection.
 */
export function crawledContextForOffset(
  html: string,
  startOffset: number,
  textLength: number,
): SelectionContext {
  const doc = parseCrawledHtml(html);
  const full = getFullText(doc.body);
  return contextAround(full, startOffset, textLength);
}

/**
 * Which occurrence (0-based) of `text` within the crawled content does
 * `startOffset` correspond to? Used to relocate a server-sourced highlight
 * (which only carries a crawled-content offset) onto the live page: the
 * live page's own Nth occurrence of the same text is assumed to be the same
 * highlight (see liveRelocate.findLiveRange). Falls back to the
 * last-seen count if the exact offset isn't found (crawled content changed
 * since the highlight was created).
 */
export function occurrenceIndexForCrawledOffset(
  html: string,
  text: string,
  startOffset: number,
): number {
  const doc = parseCrawledHtml(html);
  const full = getFullText(doc.body);
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = full.indexOf(text, from);
    if (idx === -1 || idx === startOffset) {
      return count;
    }
    count++;
    from = idx + 1;
  }
}
