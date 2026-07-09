/**
 * Highlight content script entry point. Injected either on-demand (per tab,
 * when the user invokes highlighting) or always-on (registered dynamically
 * once the user opts in under Options), mirroring
 * ../../../content-scripts/singlefile-content-script.ts's re-injection guard.
 */
import type { ZHighlightColor } from "@karakeep/shared/types/highlights";

import { HIGHLIGHT_MESSAGE, newLocalHighlightId } from '../messages';
import type { CreateHighlightRequest, DeleteHighlightRequest, GetBookmarkStateRequest, GetBookmarkStateResponse, SyncedBroadcast, UpdateHighlightRequest } from '../messages';
import { describeSelection, findLiveRange } from "../liveRelocate";
import { mountHighlightOverlay } from "./ShadowRoot";
import { closeOverlayForm, openCreateForm, openEditForm } from "./overlayController";
import {
  getHighlightAtPoint,
  initHighlightRendering,
  paintHighlight,
  removeHighlight,
  renameHighlightId,
  repaintHighlightColor,
} from "./renderer";

declare global {
  interface Window {
    __karakeepHighlightsLoaded__?: boolean;
  }
}

if (window.__karakeepHighlightsLoaded__) {
  throw new Error("karakeep highlights content script already loaded");
}
window.__karakeepHighlightsLoaded__ = true;
console.log("[karakeep-highlights] content script loaded on", location.href);

const OVERLAY_HOST_ID = "karakeep-highlight-overlay-host";
// The popover renders `side="top"` of its anchor point, so nudging the
// anchor down by this much keeps the form from sitting flush against (or
// overlapping) the selection/highlight it's for.
const OVERLAY_Y_OFFSET = 10;

let currentBookmarkId: string | null = null;
// Notes aren't tracked by the renderer (it only needs range+color to paint),
// but the edit form needs to pre-fill them.
const notesById = new Map<string, string | null>();

async function init() {
  try {
    initHighlightRendering();
    console.log("[karakeep-highlights] CSS custom highlight rendering initialized");
  } catch (err) {
    console.error("[karakeep-highlights] initHighlightRendering failed", err);
  }
  try {
    mountHighlightOverlay();
    console.log("[karakeep-highlights] overlay shadow root mounted");
  } catch (err) {
    console.error("[karakeep-highlights] mountHighlightOverlay failed", err);
  }

  chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
    if (msg?.type === HIGHLIGHT_MESSAGE.SYNCED) {
      handleSynced(msg as SyncedBroadcast);
    }
    // HIGHLIGHT_PING (and anything else) needs no response — its purpose is
    // just to prove this script is already loaded, from inject.ts's side.
  });

  const state = await requestBookmarkState().catch((err) => {
    console.error("[karakeep-highlights] requestBookmarkState failed", err);
    return null;
  });
  console.log("[karakeep-highlights] bookmark state for", location.href, state);
  if (!state?.bookmarkId) {
    // Highlighting only works once the page is bookmarked — matches
    // Webtero's existing "annotate now, save races in the background" flow,
    // just scoped to this content script not re-triggering the save itself.
    console.log("[karakeep-highlights] no bookmarkId for this URL, highlighting disabled");
    return;
  }
  currentBookmarkId = state.bookmarkId;

  // Attach the selection handler FIRST, so creating new highlights works even
  // if restoring existing ones below throws (a single malformed stored
  // highlight must not disable the whole feature — that would present as
  // "nothing happens on selection", i.e. no paint and no popover).
  document.addEventListener("mouseup", handleMouseUp);
  console.log("[karakeep-highlights] init complete, mouseup listener attached");

  try {
    for (const h of state.highlights) {
      if (!h.text) continue;
      const range = findLiveRange(document.body, h.text, {
        context: h.context,
        occurrenceIndex: h.occurrenceIndex,
      });
      if (range) {
        paintHighlight(h.id, range, h.color);
        notesById.set(h.id, h.note);
      }
    }
    for (const p of state.pending) {
      const range = findLiveRange(document.body, p.text, {
        context: p.context,
        occurrenceIndex: p.occurrenceIndex,
      });
      if (range) {
        paintHighlight(p.localId, range, p.color);
        notesById.set(p.localId, p.note);
      }
    }
  } catch (err) {
    console.error("[karakeep-highlights] restoring existing highlights failed", err);
  }
}

async function requestBookmarkState(): Promise<GetBookmarkStateResponse> {
  const req: GetBookmarkStateRequest = {
    type: HIGHLIGHT_MESSAGE.GET_BOOKMARK_STATE,
    url: location.href,
  };
  return chrome.runtime.sendMessage(req) as Promise<GetBookmarkStateResponse>;
}

function handleSynced(msg: SyncedBroadcast) {
  if (msg.bookmarkId !== currentBookmarkId) {
    return;
  }
  renameHighlightId(msg.localId, msg.highlightId);
  const note = notesById.get(msg.localId);
  notesById.delete(msg.localId);
  notesById.set(msg.highlightId, note ?? null);
}

function handleMouseUp(e: MouseEvent) {
  console.log("[karakeep-highlights] mouseup", { bookmarkId: currentBookmarkId });

  const target = e.target as Element | null;
  if (target?.closest?.(`#${OVERLAY_HOST_ID}`)) {
    console.log("[karakeep-highlights] ignoring mouseup inside overlay");
    return;
  }

  const existing = getHighlightAtPoint(e.clientX, e.clientY);
  if (existing) {
    console.log("[karakeep-highlights] clicked existing highlight", existing.id);
    openEditForm({
      x: e.clientX,
      y: e.clientY + OVERLAY_Y_OFFSET,
      color: existing.color,
      note: notesById.get(existing.id) ?? null,
      onSave: (color, note) => saveExistingHighlight(existing.id, color, note),
      onDelete: () => deleteExistingHighlight(existing.id),
      onCancel: () => {
        // No visual change was made, nothing to revert.
      },
    });
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    console.log("[karakeep-highlights] no selection, ignoring");
    return;
  }
  const range = selection.getRangeAt(0);
  if (!document.body.contains(range.commonAncestorContainer)) {
    console.log("[karakeep-highlights] selection not inside document.body, ignoring");
    return;
  }
  const text = range.toString();
  if (!currentBookmarkId || text.trim().length === 0) {
    console.log("[karakeep-highlights] no bookmarkId or empty text, ignoring", {
      currentBookmarkId,
      text,
    });
    return;
  }

  console.log("[karakeep-highlights] selection captured, painting draft highlight", text);
  const { occurrenceIndex, context } = describeSelection(
    document.body,
    range,
    text,
  );
  const localId = newLocalHighlightId();
  const rect = range.getBoundingClientRect();
  const paintedRange = range.cloneRange();
  try {
    paintHighlight(localId, paintedRange, "yellow");
    console.log("[karakeep-highlights] paintHighlight succeeded", localId, rect);
  } catch (err) {
    console.error("[karakeep-highlights] paintHighlight threw", err);
  }
  notesById.set(localId, null);

  console.log(
    "[karakeep-highlights] opening create form at",
    rect.left + rect.width / 2,
    rect.top + OVERLAY_Y_OFFSET,
  );
  openCreateForm({
    x: rect.left + rect.width / 2,
    y: rect.top + OVERLAY_Y_OFFSET,
    onSave: (color, note) =>
      createHighlight(localId, text, occurrenceIndex, context, color, note, selection),
    onCancel: () => {
      removeHighlight(localId);
      notesById.delete(localId);
    },
  });
}

function createHighlight(
  localId: string,
  text: string,
  occurrenceIndex: number,
  context: { prefix: string; suffix: string },
  color: ZHighlightColor,
  note: string | null,
  selection: Selection,
) {
  if (!currentBookmarkId) {
    return;
  }
  repaintHighlightColor(localId, color);
  notesById.set(localId, note);
  selection.removeAllRanges();
  closeOverlayForm();

  const req: CreateHighlightRequest = {
    type: HIGHLIGHT_MESSAGE.CREATE,
    localId,
    bookmarkId: currentBookmarkId,
    text,
    note,
    color,
    occurrenceIndex,
    context,
  };
  chrome.runtime
    .sendMessage(req)
    .then((res) => console.log("[karakeep-highlights] create response", res))
    .catch((err) => {
      // The pending queue already has it locally rendered; the alarm-driven
      // sync pass in the background will retry.
      console.log("[karakeep-highlights] create message failed", err);
    });
}

function saveExistingHighlight(
  highlightId: string,
  color: ZHighlightColor,
  note: string | null,
) {
  repaintHighlightColor(highlightId, color);
  notesById.set(highlightId, note);
  const req: UpdateHighlightRequest = {
    type: HIGHLIGHT_MESSAGE.UPDATE,
    highlightId,
    color,
    note,
  };
  chrome.runtime.sendMessage(req).catch(() => {
    // Best-effort — the visual state already reflects the intended change.
  });
}

function deleteExistingHighlight(highlightId: string) {
  removeHighlight(highlightId);
  notesById.delete(highlightId);
  const req: DeleteHighlightRequest = {
    type: HIGHLIGHT_MESSAGE.DELETE,
    highlightId,
  };
  chrome.runtime.sendMessage(req).catch(() => {
    // Best-effort — already removed from the live view.
  });
}

init().catch((err) => console.error("[karakeep-highlights] init failed", err));
