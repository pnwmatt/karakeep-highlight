/**
 * Imperative bridge between plain-DOM event handling in content/index.ts
 * (selection/click detection has to happen at the document level, outside
 * React) and the React tree mounted in the Shadow DOM (HighlightOverlay.tsx).
 */
import type { ZHighlightColor } from "@karakeep/shared/types/highlights";

export interface OpenCreateFormArgs {
  x: number;
  y: number;
  onSave: (color: ZHighlightColor, note: string | null) => void;
  onCancel: () => void;
}

export interface OpenEditFormArgs {
  x: number;
  y: number;
  color: ZHighlightColor;
  note: string | null;
  onSave: (color: ZHighlightColor, note: string | null) => void;
  onDelete: () => void;
  onCancel: () => void;
}

interface OverlayImpl {
  openCreateForm: (args: OpenCreateFormArgs) => void;
  openEditForm: (args: OpenEditFormArgs) => void;
  close: () => void;
}

let impl: OverlayImpl | null = null;

export function registerOverlayImpl(next: OverlayImpl): void {
  impl = next;
}

export function openCreateForm(args: OpenCreateFormArgs): void {
  if (!impl) {
    console.warn(
      "[karakeep-highlights] openCreateForm called before overlay impl registered",
    );
    return;
  }
  impl.openCreateForm(args);
}

export function openEditForm(args: OpenEditFormArgs): void {
  if (!impl) {
    console.warn(
      "[karakeep-highlights] openEditForm called before overlay impl registered",
    );
    return;
  }
  impl.openEditForm(args);
}

export function closeOverlayForm(): void {
  impl?.close();
}
