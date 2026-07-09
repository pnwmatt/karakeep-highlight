/**
 * Content-script (in)jection for highlighting, mirroring ../../utils/singlefile.ts's
 * on-demand injection pattern. The script itself is declared in manifest.json
 * under content_scripts with an inert match (never auto-fires) purely so the
 * build tool bundles it — the same trick singlefile-content-script.ts uses.
 */

const ALWAYS_ON_REGISTRATION_ID = "karakeep-highlight-content-script";

function getHighlightContentScriptFiles(): string[] {
  const contentScripts = chrome.runtime.getManifest().content_scripts;
  const files = contentScripts?.find((cs) =>
    cs.js?.some((f) => f.includes("highlight-content-script")),
  )?.js;
  if (!files || files.length === 0) {
    throw new Error("Highlight content script not declared in manifest");
  }
  return files;
}

/** Injects the highlight content script into a single tab, if not already present. */
export async function ensureHighlightContentScript(
  tabId: number,
): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "HIGHLIGHT_PING" });
    return;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      !/Could not establish connection|Receiving end does not exist/i.test(msg)
    ) {
      throw e;
    }
  }

  const files = getHighlightContentScriptFiles();
  const urls = files.map((f) => chrome.runtime.getURL(f));
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (moduleUrls: string[]) => {
      try {
        for (const url of moduleUrls) {
          await import(/* @vite-ignore */ url);
        }
        return { ok: true as const };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    args: [urls],
  });
  const res = result?.result;
  if (!res || (!res.ok && !res.error?.includes("already loaded"))) {
    throw new Error(
      `Failed to inject highlight content script: ${res?.error ?? "unknown error"}`,
    );
  }
}

export async function registerAlwaysOnHighlightContentScript(): Promise<void> {
  const files = getHighlightContentScriptFiles();
  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [ALWAYS_ON_REGISTRATION_ID],
  });
  if (existing.length > 0) {
    return;
  }
  await chrome.scripting.registerContentScripts([
    {
      id: ALWAYS_ON_REGISTRATION_ID,
      js: files,
      matches: ["<all_urls>"],
      runAt: "document_idle",
    },
  ]);
}

export async function unregisterAlwaysOnHighlightContentScript(): Promise<void> {
  await chrome.scripting
    .unregisterContentScripts({ ids: [ALWAYS_ON_REGISTRATION_ID] })
    .catch(() => {
      // Not registered — fine.
    });
}

export async function isAlwaysOnHighlightContentScriptRegistered(): Promise<boolean> {
  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [ALWAYS_ON_REGISTRATION_ID],
  });
  return existing.length > 0;
}
