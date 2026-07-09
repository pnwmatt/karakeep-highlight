/**
 * Text-quote relocation on the *live* page DOM. Highlights are never
 * positioned on the live page using Karakeep's stored offsets directly
 * (those are computed against the crawled content snapshot — see
 * offsetMapping.ts) — instead we locate the highlight's own `text` within
 * the live DOM, disambiguating repeated occurrences by index. This is the
 * same class of problem Webtero's findTextRangeFromNode/createRangeFromTextNodes
 * solved for re-matching stored XPath highlights, adapted to not need XPath.
 */
import type { SelectionContext } from "./textWalk";
import {
  contextAround,
  findContextMatchedOffset,
  getFullText,
  walkTextNodes,
} from "./textWalk";

export interface LiveAnchor {
  /** Text before/after the target; primary disambiguator. */
  context?: SelectionContext;
  /** Occurrence index fallback when context is absent or matches nothing. */
  occurrenceIndex: number;
}

export interface SelectionDescriptor {
  /** Which occurrence of `text` on the live page (0-based). Fallback anchor. */
  occurrenceIndex: number;
  /** Text immediately before/after the selection, used as the primary anchor. */
  context: SelectionContext;
}

/**
 * Describes a live selection in a way that can be relocated against the
 * crawled article: an occurrence index (fallback) plus the immediate
 * surrounding text (primary anchor). Call this right after the user makes a
 * selection. The context is the robust part — the occurrence index is
 * computed over the whole live page (nav/boilerplate included) and so rarely
 * lines up with the crawled article, whereas the prefix/suffix are local to
 * the selection and appear verbatim in both.
 */
export function describeSelection(
  root: Node,
  range: Range,
  text: string,
): SelectionDescriptor {
  const nodes = walkTextNodes(root);
  let offset = 0;
  let rangeStart = -1;
  for (const node of nodes) {
    if (node === range.startContainer) {
      rangeStart = offset + range.startOffset;
      break;
    }
    offset += node.length;
  }
  const full = getFullText(root);
  if (rangeStart === -1) {
    // Selection didn't start in a walked text node (e.g. an element boundary).
    // Recover the offset by locating the selected text directly.
    rangeStart = full.indexOf(text);
    if (rangeStart === -1) {
      return { occurrenceIndex: 0, context: { prefix: "", suffix: "" } };
    }
  }

  let count = 0;
  let from = 0;
  for (;;) {
    const idx = full.indexOf(text, from);
    if (idx === -1 || idx >= rangeStart) break;
    count++;
    from = idx + 1;
  }

  return {
    occurrenceIndex: count,
    context: contextAround(full, rangeStart, text.length),
  };
}

/**
 * Finds `text` in `root`'s live DOM — disambiguating repeated occurrences by
 * surrounding context (with an occurrence-index fallback) — and returns it as
 * a single Range, possibly spanning multiple text nodes. CSS Custom Highlight
 * API ranges can span nodes without any DOM mutation — unlike Karakeep's own
 * reader, which splits text nodes to insert <span> marks (fine for a
 * container it fully controls, too invasive for an arbitrary third-party
 * page).
 */
export function findLiveRange(
  root: Node,
  text: string,
  anchor: LiveAnchor,
): Range | null {
  if (text.length === 0) {
    return null;
  }
  const full = getFullText(root);
  const start = findContextMatchedOffset(
    full,
    text,
    anchor.context,
    anchor.occurrenceIndex,
  );
  if (start === -1) {
    return null;
  }
  const end = start + text.length;

  let currentOffset = 0;
  let startNode: Text | null = null;
  let startNodeOffset = 0;
  let endNode: Text | null = null;
  let endNodeOffset = 0;
  for (const node of walkTextNodes(root)) {
    const nodeStart = currentOffset;
    const nodeEnd = nodeStart + node.length;
    if (startNode === null && nodeEnd > start) {
      startNode = node;
      startNodeOffset = start - nodeStart;
    }
    if (startNode !== null && nodeEnd >= end) {
      endNode = node;
      endNodeOffset = end - nodeStart;
      break;
    }
    currentOffset += node.length;
  }
  if (!startNode || !endNode) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startNode, startNodeOffset);
  range.setEnd(endNode, endNodeOffset);
  return range;
}
