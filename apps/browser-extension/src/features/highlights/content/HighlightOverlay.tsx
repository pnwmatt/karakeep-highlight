/**
 * In-page color-picker form. Ported from HighlightForm in
 * packages/shared-react/components/BookmarkHtmlHighlighter.tsx (same swatch
 * row + note textarea + Save/Cancel/Delete layout, reusing the same
 * HIGHLIGHT_COLOR_MAP and Button/Textarea primitives), but using the raw
 * Radix Popover primitive instead of the shared `ui/popover.tsx` wrapper —
 * that wrapper's Portal always targets document.body, which would render
 * outside our Shadow DOM and lose its injected styles / collide with the
 * host page's CSS.
 */
import { useEffect, useState } from "react";
import { PopoverAnchor, Portal, Root } from "@radix-ui/react-popover";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, Trash2 } from "lucide-react";

import { Button } from "@karakeep/shared-react/components/ui/button";
import { Textarea } from "@karakeep/shared-react/components/ui/textarea";
import { HIGHLIGHT_COLOR_MAP } from "@karakeep/shared-react/components/highlights";
import {
  SUPPORTED_HIGHLIGHT_COLORS,
  ZHighlightColor,
} from "@karakeep/shared/types/highlights";

import { cn } from "../../../lib/utils";
import { registerOverlayImpl } from "./overlayController";
import type { OpenCreateFormArgs, OpenEditFormArgs } from "./overlayController";

type FormState =
  | { mode: "closed" }
  | ({ mode: "create" } & OpenCreateFormArgs)
  | ({ mode: "edit" } & OpenEditFormArgs);

export function HighlightOverlay({
  portalContainer,
}: {
  portalContainer: HTMLElement;
}) {
  const [state, setState] = useState<FormState>({ mode: "closed" });
  const [color, setColor] = useState<ZHighlightColor>("yellow");
  const [note, setNote] = useState("");

  useEffect(() => {
    console.log(
      "[karakeep-highlights] HighlightOverlay mounted, registering impl",
    );
    registerOverlayImpl({
      openCreateForm: (args) => {
        console.log("[karakeep-highlights] overlay: openCreateForm", args);
        setState({ mode: "create", ...args });
        setColor("yellow");
        setNote("");
      },
      openEditForm: (args) => {
        console.log("[karakeep-highlights] overlay: openEditForm", args);
        setState({ mode: "edit", ...args });
        setColor(args.color);
        setNote(args.note ?? "");
      },
      close: () => setState({ mode: "closed" }),
    });
  }, []);

  const close = () => {
    if (state.mode !== "closed") {
      state.onCancel();
    }
    setState({ mode: "closed" });
  };

  const handleSave = () => {
    if (state.mode === "closed") return;
    state.onSave(color, note.trim().length > 0 ? note.trim() : null);
    setState({ mode: "closed" });
  };

  const handleDelete = () => {
    if (state.mode !== "edit") return;
    state.onDelete();
    setState({ mode: "closed" });
  };

  const isOpen = state.mode !== "closed";

  return (
    <Root open={isOpen} onOpenChange={(open) => !open && close()}>
      <PopoverAnchor
        className="fixed"
        style={{ left: isOpen ? state.x : 0, top: isOpen ? state.y : 0 }}
      />
      <Portal container={portalContainer}>
        <PopoverPrimitive.Content
          side="top"
          sideOffset={8}
          className={cn(
            "z-50 w-80 space-y-3 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none",
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div>
            <label className="mb-2 block text-sm font-medium">Color</label>
            <div className="flex items-center gap-1">
              {SUPPORTED_HIGHLIGHT_COLORS.map((c) => (
                <Button
                  key={c}
                  size="none"
                  variant="none"
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-8 rounded-full hover:border focus-visible:ring-0",
                    HIGHLIGHT_COLOR_MAP.bg[c],
                  )}
                >
                  {color === c && <Check className="size-5 text-gray-600" />}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Note</label>
            <Textarea
              placeholder="Add a note (optional)..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-[80px] text-sm"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button onClick={handleSave} size="sm">
                Save
              </Button>
              <Button onClick={close} variant="outline" size="sm">
                Cancel
              </Button>
            </div>
            {state.mode === "edit" && (
              <Button
                size="sm"
                onClick={handleDelete}
                variant="ghost"
                title="Delete highlight"
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            )}
          </div>
        </PopoverPrimitive.Content>
      </Portal>
    </Root>
  );
}
