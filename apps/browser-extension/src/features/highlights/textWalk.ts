/**
 * Low-level text-node walking shared by offsetMapping.ts (Karakeep's crawled-
 * content coordinate system) and liveRelocate.ts (the live page's DOM).
 */

// Text inside these elements is never part of the readable/crawled content
// (Karakeep's crawled HTML is Readability output, which strips them), yet a
// TreeWalker(SHOW_TEXT) still visits their text children. Counting them on the
// live page inflates character offsets and occurrence counts relative to the
// crawled coordinate system, which is the root cause of highlights anchoring
// to the wrong text (or not at all). Skip them so both sides agree.
const NON_CONTENT_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

export function walkTextNodes(container: Node): Text[] {
  const nodes: Text[] = [];
  const ownerDoc =
    (container.ownerDocument ?? (container as Document)) || document;
  const walker = ownerDoc.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const parent = (node as Text).parentElement;
      return parent && NON_CONTENT_TAGS.has(parent.tagName)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
  }
  return nodes;
}

export function getFullText(container: Node): string {
  let text = "";
  for (const node of walkTextNodes(container)) {
    text += node.data;
  }
  return text;
}

/**
 * Ported from BookmarkHtmlHighlighter.tsx's getRangeFromHighlight
 * (packages/shared-react/components/BookmarkHtmlHighlighter.tsx): given a
 * character-offset span, return the text nodes (with per-node start/end
 * offsets) it covers within `container`.
 */
export function textNodeRangesForOffsets(
  container: Node,
  startOffset: number,
  endOffset: number,
): { node: Text; start: number; end: number }[] {
  const ranges: { node: Text; start: number; end: number }[] = [];
  let currentOffset = 0;
  for (const node of walkTextNodes(container)) {
    const nodeLength = node.length;
    const nodeStart = currentOffset;
    const nodeEnd = nodeStart + nodeLength;
    if (nodeStart < endOffset && nodeEnd > startOffset) {
      ranges.push({
        node,
        start: Math.max(0, startOffset - nodeStart),
        end: Math.min(nodeLength, endOffset - nodeStart),
      });
    }
    currentOffset += nodeLength;
  }
  return ranges;
}

/** Nth (0-based) occurrence of `text` within `fullText`, or -1 if not found. */
export function findOccurrenceOffset(
  fullText: string,
  text: string,
  occurrenceIndex: number,
): number {
  let from = 0;
  let found = -1;
  for (let i = 0; i <= occurrenceIndex; i++) {
    found = fullText.indexOf(text, from);
    if (found === -1) return -1;
    from = found + 1;
  }
  return found;
}

/** All (0-based, ascending) offsets of `text` within `fullText`. */
export function allOccurrenceOffsets(fullText: string, text: string): number[] {
  const offsets: number[] = [];
  if (text.length === 0) {
    return offsets;
  }
  let from = 0;
  for (;;) {
    const idx = fullText.indexOf(text, from);
    if (idx === -1) break;
    offsets.push(idx);
    from = idx + 1;
  }
  return offsets;
}

export interface SelectionContext {
  prefix: string;
  suffix: string;
}

/** How many characters of surrounding context to capture for disambiguation. */
export const CONTEXT_WINDOW = 48;

/** Slices prefix/suffix context around a character offset in `fullText`. */
export function contextAround(
  fullText: string,
  startOffset: number,
  length: number,
): SelectionContext {
  const prefix = fullText.slice(
    Math.max(0, startOffset - CONTEXT_WINDOW),
    startOffset,
  );
  const suffixStart = startOffset + length;
  const suffix = fullText.slice(suffixStart, suffixStart + CONTEXT_WINDOW);
  return { prefix, suffix };
}

/**
 * Picks the offset of `text` within `fullText` that best matches the
 * surrounding context captured at selection time. This disambiguates repeated
 * occurrences robustly *across* two different coordinate systems (the live
 * page vs. the crawled article): a bare occurrence index breaks down because
 * the live page has navigation/boilerplate/scripts the crawled article does
 * not, so the Nth live occurrence is rarely the Nth crawled occurrence. The
 * immediate prefix/suffix text, by contrast, is local to the selection and
 * exists verbatim in both. Falls back to `fallbackIndex` when context is
 * absent or matches nothing (e.g. the crawl diverged from the live page).
 */
export function findContextMatchedOffset(
  fullText: string,
  text: string,
  context: SelectionContext | undefined,
  fallbackIndex: number,
): number {
  const offsets = allOccurrenceOffsets(fullText, text);
  if (offsets.length === 0) {
    return -1;
  }
  if (offsets.length === 1) {
    return offsets[0];
  }
  const prefix = context?.prefix ?? "";
  const suffix = context?.suffix ?? "";
  const clampedFallback = offsets[Math.min(fallbackIndex, offsets.length - 1)];
  if (prefix.length === 0 && suffix.length === 0) {
    return clampedFallback;
  }

  let best = -1;
  let bestScore = -1;
  for (const offset of offsets) {
    let p = 0;
    while (
      p < prefix.length &&
      offset - 1 - p >= 0 &&
      fullText[offset - 1 - p] === prefix[prefix.length - 1 - p]
    ) {
      p++;
    }
    const after = offset + text.length;
    let s = 0;
    while (
      s < suffix.length &&
      after + s < fullText.length &&
      fullText[after + s] === suffix[s]
    ) {
      s++;
    }
    const score = p + s;
    if (score > bestScore) {
      bestScore = score;
      best = offset;
    }
  }
  // No contextual signal at all — the crawl likely diverged; prefer the index.
  return bestScore > 0 ? best : clampedFallback;
}
