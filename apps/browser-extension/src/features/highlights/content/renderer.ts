/**
 * Paints highlights directly onto the live page's own DOM using the CSS
 * Custom Highlight API (https://developer.mozilla.org/en-US/docs/Web/API/CSS_custom_highlight_API):
 * a Range can be registered against a named highlight without inserting or
 * splitting any DOM nodes. Karakeep's own web reader instead splits text
 * nodes to insert <span data-highlight> marks (see
 * packages/shared-react/components/BookmarkHtmlHighlighter.tsx) — fine for a
 * container it fully controls, too invasive for an arbitrary third-party
 * page, so this ported the *offset* logic from that component
 * (offsetMapping.ts) but not its DOM-mutation rendering approach.
 */
import type { ZHighlightColor } from "@karakeep/shared/types/highlights";

// Same Tailwind *-200 shades as HIGHLIGHT_COLOR_MAP.bg in
// @karakeep/shared-react/components/highlights.ts.
const CSS_COLOR_VALUES: Record<ZHighlightColor, string> = {
  yellow: "#fef08a",
  red: "#fecaca",
  green: "#bbf7d0",
  blue: "#bfdbfe",
};

const HIGHLIGHT_COLORS = Object.keys(CSS_COLOR_VALUES) as ZHighlightColor[];

function cssHighlightName(color: ZHighlightColor): string {
  return `karakeep-highlight-${color}`;
}

const cssHighlightsByColor = new Map<ZHighlightColor, globalThis.Highlight>();
const activeHighlights = new Map<
  string,
  { range: Range; color: ZHighlightColor }
>();

let initialized = false;

export function initHighlightRendering(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  const style = document.createElement("style");
  style.textContent = HIGHLIGHT_COLORS.map(
    (color) =>
      `::highlight(${cssHighlightName(color)}) { background-color: ${CSS_COLOR_VALUES[color]}; color: inherit; }`,
  ).join("\n");
  document.documentElement.appendChild(style);

  for (const color of HIGHLIGHT_COLORS) {
    const highlight = new Highlight();
    cssHighlightsByColor.set(color, highlight);
    CSS.highlights.set(cssHighlightName(color), highlight);
  }
}

export function paintHighlight(
  id: string,
  range: Range,
  color: ZHighlightColor,
): void {
  removeHighlight(id);
  activeHighlights.set(id, { range, color });
  cssHighlightsByColor.get(color)?.add(range);
}

export function removeHighlight(id: string): void {
  const existing = activeHighlights.get(id);
  if (!existing) {
    return;
  }
  cssHighlightsByColor.get(existing.color)?.delete(existing.range);
  activeHighlights.delete(id);
}

export function repaintHighlightColor(
  id: string,
  color: ZHighlightColor,
): void {
  const existing = activeHighlights.get(id);
  if (!existing) {
    return;
  }
  cssHighlightsByColor.get(existing.color)?.delete(existing.range);
  activeHighlights.set(id, { range: existing.range, color });
  cssHighlightsByColor.get(color)?.add(existing.range);
}

/** Called once a pending highlight is confirmed by the server. */
export function renameHighlightId(oldId: string, newId: string): void {
  const existing = activeHighlights.get(oldId);
  if (!existing) {
    return;
  }
  activeHighlights.delete(oldId);
  activeHighlights.set(newId, existing);
}

/**
 * CSS Custom Highlights aren't real DOM nodes, so there's nothing to attach
 * a click listener to directly — hit-test by checking whether the point
 * under the pointer falls inside any tracked Range.
 */
export function getHighlightAtPoint(
  x: number,
  y: number,
): { id: string; range: Range; color: ZHighlightColor } | null {
  const caret = caretPositionFromPoint(x, y);
  if (!caret) {
    return null;
  }
  for (const [id, { range, color }] of activeHighlights) {
    try {
      if (range.isPointInRange(caret.node, caret.offset)) {
        return { id, range, color };
      }
    } catch {
      // Point's node isn't in the same tree as this range — not a match.
    }
  }
  return null;
}

function caretPositionFromPoint(
  x: number,
  y: number,
): { node: Node; offset: number } | null {
  // Firefox
  if (typeof document.caretPositionFromPoint === "function") {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) {
      return { node: pos.offsetNode, offset: pos.offset };
    }
    return null;
  }
  // Chrome/WebKit
  if (typeof document.caretRangeFromPoint === "function") {
    const range = document.caretRangeFromPoint(x, y);
    if (range) {
      return { node: range.startContainer, offset: range.startOffset };
    }
  }
  return null;
}
