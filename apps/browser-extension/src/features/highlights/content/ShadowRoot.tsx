/**
 * Mounts the highlight toolbar's React tree inside a Shadow DOM root, so
 * neither the host page's CSS nor ours can collide. `?inline` runs
 * src/index.css through the normal Vite/PostCSS/Tailwind pipeline and
 * hands back the compiled CSS as a string instead of injecting a <link> —
 * we need the text so it can go inside the shadow root instead of the
 * page's <head>.
 */
import { createRoot } from "react-dom/client";

import overlayStyles from "../../../index.css?inline";
import { HighlightOverlay } from "./HighlightOverlay";

export function mountHighlightOverlay(): void {
  const host = document.createElement("div");
  host.id = "karakeep-highlight-overlay-host";
  host.style.cssText =
    "position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  // `:root` (where Tailwind's CSS variables — `--popover`, `--background`,
  // etc. — are defined) never matches anything inside a shadow tree, and
  // this stylesheet only ever lives inside this shadow root, never on the
  // host page's real <html>. Without also targeting `:host`, every
  // `bg-popover`-style utility resolves an undefined variable and renders
  // transparent — the popover mounts but is invisible.
  style.textContent = overlayStyles.replace(/:root/g, ":root,:host");
  shadow.appendChild(style);

  const portalContainer = document.createElement("div");
  shadow.appendChild(portalContainer);

  const reactRoot = document.createElement("div");
  shadow.appendChild(reactRoot);

  createRoot(reactRoot).render(
    <HighlightOverlay portalContainer={portalContainer} />,
  );
}
