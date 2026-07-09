import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";

import { HIGHLIGHT_COLOR_MAP } from "@karakeep/shared-react/components/highlights";
import { useDeleteHighlight } from "@karakeep/shared-react/hooks/highlights";
import type { ZHighlight } from "@karakeep/shared/types/highlights";

import { Button } from "./components/ui/button";
import { ensureHighlightContentScript } from "./features/highlights/inject";
import Spinner from "./Spinner";
import { cn } from "./utils/css";
import usePluginSettings from "./utils/settings";
import { useTRPC } from "./utils/trpc";

export default function HighlightsPage() {
  const api = useTRPC();
  const { settings } = usePluginSettings();
  const [tabUrl, setTabUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => {
        setTabUrl(tab?.url);
        // Opening this page is what activates on-demand highlighting for
        // the current tab, mirroring how SavePage triggers SingleFile
        // capture on demand rather than the extension always running it.
        if (tab?.id !== undefined && settings.highlightingMode !== "off") {
          ensureHighlightContentScript(tab.id).catch(() => {
            // Best-effort — the always-on path (if enabled) covers this too.
          });
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: urlCheck } = useQuery(
    api.bookmarks.checkUrl.queryOptions(
      { url: tabUrl ?? "" },
      { enabled: !!tabUrl },
    ),
  );
  const bookmarkId = urlCheck?.bookmarkId ?? null;

  const { data, isPending } = useQuery(
    api.highlights.getForBookmark.queryOptions(
      { bookmarkId: bookmarkId ?? "" },
      { enabled: !!bookmarkId },
    ),
  );

  if (!tabUrl) {
    return (
      <div className="flex justify-between text-lg">
        <span>Loading</span>
        <Spinner />
      </div>
    );
  }

  if (!bookmarkId) {
    return (
      <p className="text-sm text-muted-foreground">
        Save this page to Karakeep first, then select text on the page to
        highlight it.
      </p>
    );
  }

  if (isPending) {
    return (
      <div className="flex justify-between text-lg">
        <span>Loading highlights</span>
        <Spinner />
      </div>
    );
  }

  const highlights = data?.highlights ?? [];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-lg">Highlights</p>
      {highlights.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Select text on the page to create a highlight.
        </p>
      )}
      {highlights.map((h) => (
        <HighlightRow key={h.id} highlight={h} />
      ))}
    </div>
  );
}

function HighlightRow({ highlight }: { highlight: ZHighlight }) {
  const { mutate: deleteHighlight, isPending } = useDeleteHighlight();
  return (
    <div className="flex items-start justify-between gap-2">
      <blockquote
        className={cn(
          "prose flex-1 border-l-[6px] p-2 pl-3 text-sm italic dark:prose-invert prose-p:text-sm",
          HIGHLIGHT_COLOR_MAP["border-l"][highlight.color],
        )}
      >
        <p>{highlight.text}</p>
        {highlight.note && (
          <p className="text-xs not-italic text-muted-foreground">
            {highlight.note}
          </p>
        )}
      </blockquote>
      <Button
        variant="link"
        size="sm"
        disabled={isPending}
        onClick={() => deleteHighlight({ highlightId: highlight.id })}
      >
        <Trash2 className="size-4 text-destructive" />
      </Button>
    </div>
  );
}
