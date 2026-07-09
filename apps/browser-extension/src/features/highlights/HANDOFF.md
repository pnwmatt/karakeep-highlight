# Highlighting feature — handoff notes

Status as of 2026-07-09. Branch `feat/highlighting-browser-extension` in this
monorepo (`/Users/matt/workspace/karakeep`). This file is dev notes for
whoever (human or Claude Code) picks this up next — delete it once the
feature is stable and this is no longer useful, it's not meant to ship.

## What this is

Adds text highlighting to the browser extension (`apps/browser-extension`),
built as a self-contained module at `src/features/highlights/` so it can
plausibly be merged upstream into Karakeep's own extension someday. Full
design rationale (offset model, why CSS Custom Highlight API over Karakeep's
own DOM-splitting approach, the pending-queue design, etc.) is in the
original plan file: `/Users/matt/.claude/plans/melodic-whistling-diffie.md`
— read that first for the "why", this file is the "what's been happening
since."

Quick architecture summary: select text on a bookmarked page → content
script (`content/highlight-content-script.ts`) paints it immediately via the
CSS Custom Highlight API (`content/renderer.ts`) and opens a color/note
popover rendered in a Shadow DOM (`content/ShadowRoot.tsx` →
`HighlightOverlay.tsx`) → on save, sends a message to the background
(`backgroundHandlers.ts`) → written to a local pending queue
(`pendingQueue.ts`) → a `chrome.alarms`-driven pass (`background.ts`) waits
for the bookmark's crawl to finish, computes the real Karakeep
`startOffset`/`endOffset` against the crawled HTML (`offsetMapping.ts`,
ported from `packages/shared-react/components/BookmarkHtmlHighlighter.tsx`),
and calls the real `highlights.create` tRPC mutation (`api.ts`).

## ⚠️ Git state

**One commit already exists on this branch**: `ed60aa38 "feat:
browser-extension add in-browser highlighting"`. It contains the bulk of the
original module (everything under `src/features/highlights/`,
`HighlightsPage.tsx`, `justfile`, `src/lib/utils.ts`). It was made by a
debugging subagent that was explicitly instructed not to commit — it did
anyway. Nobody has reviewed/amended that commit message or squashed it yet.

Everything since that commit (all the bug fixes below) is **uncommitted**.
Check `git status`/`git diff HEAD -- apps/browser-extension` before assuming
you know the state of the tree.

## Bugs found and fixed so far (don't re-diagnose these)

1. **Firefox manifest lint errors** (`MISSING_DATA_COLLECTION_PERMISSIONS`,
   `MANIFEST_FIELD_UNSUPPORTED` on `service_worker`) — fixed by adding
   `browser_specific_settings.gecko.data_collection_permissions` to
   `manifest.json`, and fixing `justfile`'s `build` recipe (env var prefix
   `VITE_BUILD_FIREFOX=true` only applied to the `pnpm tsc` command, not the
   `pnpm vite build` after `&&` — shell semantics, not a code bug). Justfile
   now does `export VITE_BUILD_FIREFOX=true && ...`.

2. **Duplicate React instances in the popup bundle** (`ReactSharedInternals.H
   is null` / "can't access property useMemo") — `packages/shared-react` had
   its own nested `node_modules/react` at a different version (19.2.3) than
   the workspace root's (19.2.6), and this app's popup was the first thing in
   `apps/browser-extension` to ever import from `@karakeep/shared-react`, so
   it's the first time the mismatch mattered. Fixed with
   `resolve.dedupe: ["react", "react-dom"]` in `vite.config.ts`. Verified by
   grepping the built chunk for the `react.dev/errors` marker string — should
   appear in exactly one chunk, not two.

3. **Wrong occurrence-index math dropping/misplacing every highlight** (found
   by an Opus subagent — see `SendMessage` history / agent id
   `a106879c4baf5f01c` if it's still resumable) — `occurrenceIndexOfRange()`
   counted text occurrences across the *entire live page* (nav/header/footer,
   even inside `<script>`/`<style>` — `TreeWalker(SHOW_TEXT)` visits those
   too), then that index was used against the *crawled article* (Readability
   output, no boilerplate) in `computeCrawledContentOffsets()`. Wrong
   coordinate spaces. This is why highlights that did get created showed up
   unanchored / "as notes" — the web reader couldn't place the quote. Fixed
   by switching disambiguation to prefix/suffix **context matching** instead
   of a raw occurrence count (`textWalk.ts`'s `findContextMatchedOffset`,
   `liveRelocate.ts`'s `describeSelection`/`findLiveRange`,
   `offsetMapping.ts`'s `crawledContextForOffset`). Occurrence index is now
   only a fallback. Verified with a jsdom repro (not committed — recreate if
   you need to re-check this class of bug).

4. **Nothing happened at all on selection — root cause** — `background.ts`
   had a pre-existing listener (unrelated to highlighting, for
   `BOOKMARK_REFRESH_BADGE`) declared as `async (msg) => {...}`. In the
   WebExtension messaging model, an `async` function listener *always*
   returns a `Promise` the instant it's invoked. When multiple
   `chrome.runtime.onMessage` listeners exist, the runtime uses whichever one
   settles first as the response — including for message types that listener
   doesn't own. Since this listener does nothing and returns instantly for
   unrelated message types, it was winning the race and resolving *every*
   `chrome.runtime.sendMessage` call (including the highlight content
   script's `GET_BOOKMARK_STATE`) with `undefined`, before our real handler's
   slower (network-involving) response ever arrived. Fixed by making that
   listener a plain non-async function with the actual work in a
   fire-and-forget async IIFE inside. **This was the big one** — it was
   silently breaking the entire feature, and would silently break any other
   future message-based feature added to this extension too. If you add
   another `chrome.runtime.onMessage.addListener` anywhere, make sure it is
   NOT declared `async` unless it truly intends to respond to every message
   type it might see.

5. **Invisible popover** — the Shadow DOM's injected stylesheet (compiled
   `index.css`, includes Tailwind's `:root { --popover: ...; }` variable
   definitions) was injected only inside the shadow root's own `<style>` tag.
   `:root` never matches anything inside a shadow tree, and the arbitrary
   host page's real `<html>` never gets these variables either — so every
   `bg-popover`/`text-popover-foreground` class resolved an undefined CSS
   variable and rendered transparent. Fixed in `content/ShadowRoot.tsx` by
   rewriting `:root` → `:root,:host` in the shadow-injected copy of the
   stylesheet only (`overlayStyles.replace(/:root/g, ":root,:host")`).

6. **Missing swatch colors** — `apps/browser-extension/tailwind.config.js`
   only scans this app's own `src/`. The literal `bg-yellow-200` /
   `border-l-red-200` etc. classes used by `HIGHLIGHT_COLOR_MAP` live in
   `packages/shared-react/components/highlights.ts`, a different package —
   Tailwind's JIT compiler never saw those literal strings and generated zero
   CSS for them. `apps/web/tailwind.config.ts` hit this exact same problem
   already and fixes it with an extra `content` glob; mirrored that fix here.

7. **Popover rendering flush against the selection** — cosmetic, added a
   10px `OVERLAY_Y_OFFSET` constant in `highlight-content-script.ts`.

8. **404s on `bookmarks.getBookmark`, bookmarkId mismatch vs
   `bookmarks.checkUrl`** — `handleGetBookmarkState` resolved the bookmark ID
   via `utils/badgeCache.ts`'s `getBadgeStatus()`, which goes through a
   long-lived SWR cache (`useBadgeCache`, default on, ~1hr expiry) meant for
   the toolbar badge count, where staleness is harmless. Reusing it for
   highlighting meant a stale/deleted bookmark ID (e.g. after deleting and
   re-saving the same URL) could stick around for up to an hour, 404ing on
   every `getBookmarkCrawledHtml`/`getHighlightsForBookmark`/create call.
   Fixed by adding `checkBookmarkUrl()` to `api.ts` (calls
   `bookmarks.checkUrl` directly, uncached) and switching
   `handleGetBookmarkState` to use it instead of `getBadgeStatus`.

## Bugs found and fixed so far (cont'd)

9. **Settings → Highlighting mode `<Select>` "doesn't toggle" — root-caused
   and fixed.** Not a Select/Radix bug, and not persistence-specific to this
   field. Reproduced live in real Firefox (temporary-addon install via
   `selenium-webdriver` + `geckodriver`, full-desktop screenshot via Python
   `mss` — headless agent sessions can't drive a real browser, but a
   `send_later`-scheduled full session with unlocked egress can). Root
   cause: selecting **"always-on"** calls `requestHostPermission()` →
   `chrome.permissions.request({origins: ["<all_urls>"]})`, which pops a
   *native* browser permission doorhanger ("New permissions: Access your
   data for all websites — Allow/Deny"). Firefox anchors this near the
   address bar/toolbar, not inside the popup, so it's easy to miss entirely.
   The `<Select>` is controlled by `settings.highlightingMode`, so until that
   promise resolves it just keeps showing the *old* value with zero visual
   feedback — looking exactly like "nothing happened" rather than "waiting
   on you to answer a prompt". Confirmed via console logs
   (`onChangeHighlightingMode called with always-on` fires, but
   `requestHostPermission ->` never logs until the doorhanger is answered)
   and via screenshot showing the doorhanger sitting there unanswered.
   Clicking "Allow" completes the flow correctly and it persists across
   reload — so "off"/"on-demand" were never affected (they don't touch
   permissions), matching what static analysis had already ruled out.
   **Fix**: `OptionsPage.tsx` now tracks `isChangingHighlightingMode`,
   disables the Select and shows a `<Spinner>` next to it plus a hint
   ("Check for a permission request from your browser…") while
   `onChangeHighlightingMode` is in flight, wrapped in `try/finally` so it
   always clears. The old ad-hoc `console.log` diagnostics were removed now
   that the root cause is known.

## Open issues (unresolved — pick these up)

### B. Existing highlights don't reappear after a page refresh

User-confirmed still broken as of the last round (refresh page → open
popup → highlights panel → nothing repaints), **but this was tested before
fix #8 (the bookmarkId caching bug) shipped** — it's quite possible this is
already resolved as a side effect, since `getHighlightsForBookmark(bookmarkId)`
in `handleGetBookmarkState` was using the same stale/wrong ID that caused the
404s, and its failure is silently swallowed (`.catch(() => [])`), which would
look exactly like "no highlights found" even when they exist under the
correct ID. **Retest this first before doing any new investigation** — it
may just be a "hasn't been tried against the fixed build yet" situation, not
a new bug.

If it's still broken after retesting against the current build: the restore
logic is in `highlight-content-script.ts`'s `init()` — it calls
`findLiveRange(document.body, h.text, { context: h.context, occurrenceIndex:
h.occurrenceIndex })` for each of `state.highlights` and `state.pending`.
Add logging there (how many highlights came back in `state`, whether
`findLiveRange` returned `null` for each) the same way the mouseup flow was
diagnosed earlier in this session — that pattern (simple, targeted
`console.log` at each branch point) is what cracked every other bug so far,
prefer it over speculating further.

## Build & verify

```
cd apps/browser-extension
just build                                  # builds dist-firefox/, zips to extensionjust.zip
pnpm dlx web-ext lint --source-dir=dist-firefox   # should be 0 errors (6 pre-existing innerHTML warnings from vendor bundles are fine)
```

Real Firefox *is* reachable from an agent session if egress is unlocked and
someone downloads it — `npx playwright install firefox` (needs
`cdn.playwright.dev`/`playwright.download.prss.microsoft.com` allowed
through the egress proxy) gets a real Firefox binary, which can then be
driven with `selenium-webdriver` + the `geckodriver` npm package (Playwright
itself can't attach to a WebExtension-loaded Firefox — only Chromium
supports `--load-extension` through Playwright). Install the addon
temporarily with `driver.installAddon(distDir, true)`, resolve its
`moz-extension://` UUID by switching to chrome context
(`driver.setContext(firefox.Context.CHROME)`) and reading the
`extensions.webextensions.uuids` pref, then navigate a normal tab there.
Full-desktop screenshots (to see *native browser chrome* like permission
doorhangers, which WebDriver's own `takeScreenshot()` won't show since it's
content-viewport-only) need something outside the trimmed
Playwright-bundled ffmpeg (no x11grab support) — Python's `mss` package
worked fine. This is how bug #9 above got root-caused. Absent that kind of
setup, fall back to build/typecheck/lint passing plus static inspection of
the built output (grepping compiled chunks/CSS for expected strings) — but
**that's a weaker signal**: every real bug found in this feature so far was
invisible to typecheck/lint/build and only showed up at runtime, so a live
browser (or a human pasting real console output) beats static analysis
whenever either is available.

Three separate devtools consoles matter here and it's easy to check the
wrong one:
- **Content script logs** (`[karakeep-highlights] ...` prefix, most of them)
  → the actual web page's own devtools console (F12 on the page).
- **Background/service-worker logs** → Firefox's `about:debugging` →
  "Debug Extension" for this extension specifically.
- **Popup logs** (e.g. `onChangeHighlightingMode`'s logs in
  `OptionsPage.tsx`) → the popup's own devtools, opened via undocked devtools
  + click the toolbar icon, or right-click → Inspect.
