import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { Switch } from "./components/ui/switch";
import Logo from "./Logo";
import Spinner from "./Spinner";
import {
  hasHostPermission,
  isPopupContext,
  removeHostPermission,
  requestHostPermission,
} from "./utils/permissions";
import usePluginSettings, {
  DEFAULT_BADGE_CACHE_EXPIRE_MS,
} from "./utils/settings";
import { useTheme } from "./utils/ThemeProvider";
import { useTRPC } from "./utils/trpc";

type PermissionGrantIntent = "client-side-crawling" | "always-on";

// Opens the options page in a real tab pre-armed to finish a permission
// grant that can't complete from the popup (see isPopupContext's doc
// comment). The popup closing itself as focus moves to the new tab is
// expected here, not a bug.
function openPermissionGrantTab(intent: PermissionGrantIntent) {
  chrome.tabs.create({
    url: chrome.runtime.getURL(`index.html#/options?grantPermission=${intent}`),
  });
}

export default function OptionsPage() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { settings, setSettings } = usePluginSettings();
  const { setTheme, theme } = useTheme();

  // `<all_urls>` is an optional host permission that the user grants when they
  // opt in to client-side crawling. Keep the switch in sync with whether it's
  // actually granted (it can be revoked from the browser's extension settings).
  const [hostPermissionGranted, setHostPermissionGranted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    hasHostPermission().then((granted) => {
      if (!cancelled) setHostPermissionGranted(granted);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const clientSideCrawlingEnabled =
    settings.useSingleFile && hostPermissionGranted;

  const onToggleClientSideCrawling = async (checked: boolean) => {
    if (checked) {
      if (isPopupContext()) {
        openPermissionGrantTab("client-side-crawling");
        return;
      }
      // Must run synchronously off the user gesture — don't await anything else
      // before requesting the permission.
      const granted = await requestHostPermission();
      if (!granted) {
        return;
      }
      setHostPermissionGranted(true);
      await setSettings((s) => ({ ...s, useSingleFile: true }));
    } else {
      await setSettings((s) => ({ ...s, useSingleFile: false }));
      // Always-on highlighting shares the same <all_urls> permission —
      // don't yank it out from under that feature.
      if (settings.highlightingMode !== "always-on") {
        await removeHostPermission();
        setHostPermissionGranted(false);
      }
    }
  };

  // Selecting "always-on" requests the `<all_urls>` host permission, which
  // pops a native browser prompt the user has to answer. The Select is
  // controlled by `settings.highlightingMode`, so without a pending state it
  // just silently keeps showing the old value until the prompt is answered —
  // looking exactly like "the dropdown doesn't do anything" rather than
  // "waiting on you". From the popup specifically, that promise never
  // resolves at all (see isPopupContext), so we hand off to a real tab there
  // instead of showing a pending state that would never end.
  const [isChangingHighlightingMode, setIsChangingHighlightingMode] =
    useState(false);

  const onChangeHighlightingMode = async (
    mode: "off" | "on-demand" | "always-on",
  ) => {
    if (mode === "always-on" && isPopupContext()) {
      openPermissionGrantTab("always-on");
      return;
    }
    setIsChangingHighlightingMode(true);
    try {
      if (mode === "always-on") {
        const granted = await requestHostPermission();
        if (!granted) {
          return;
        }
        setHostPermissionGranted(true);
      }
      await setSettings((s) => ({ ...s, highlightingMode: mode }));
      if (mode !== "always-on" && !settings.useSingleFile) {
        await removeHostPermission();
        setHostPermissionGranted(false);
      }
    } finally {
      setIsChangingHighlightingMode(false);
    }
  };

  // Landing page for the tab opened by openPermissionGrantTab above. Requires
  // its own explicit button click (rather than firing automatically on
  // mount) because the permissions API needs a real user gesture in *this*
  // tab — the click that opened the tab doesn't carry over.
  const grantIntent = searchParams.get(
    "grantPermission",
  ) as PermissionGrantIntent | null;
  const [isGrantingPermission, setIsGrantingPermission] = useState(false);
  const [grantPermissionError, setGrantPermissionError] = useState(false);

  const onGrantPermission = async () => {
    setIsGrantingPermission(true);
    setGrantPermissionError(false);
    try {
      const granted = await requestHostPermission();
      if (!granted) {
        setGrantPermissionError(true);
        return;
      }
      setHostPermissionGranted(true);
      if (grantIntent === "always-on") {
        await setSettings((s) => ({ ...s, highlightingMode: "always-on" }));
      } else if (grantIntent === "client-side-crawling") {
        await setSettings((s) => ({ ...s, useSingleFile: true }));
      }
      setSearchParams({}, { replace: true });
    } finally {
      setIsGrantingPermission(false);
    }
  };

  const { data: whoami, error: whoAmIError } = useQuery(
    api.users.whoami.queryOptions(undefined, {
      enabled: settings.address != "",
    }),
  );

  const { mutate: deleteKey } = useMutation(
    api.apiKeys.revoke.mutationOptions(),
  );

  const invalidateWhoami = () => {
    queryClient.refetchQueries(api.users.whoami.queryFilter());
  };

  useEffect(() => {
    invalidateWhoami();
  }, [settings]);

  let loggedInMessage: React.ReactNode;
  if (whoAmIError) {
    if (whoAmIError.data?.code == "UNAUTHORIZED") {
      loggedInMessage = <span>Not logged in</span>;
    } else {
      loggedInMessage = (
        <span>Something went wrong: {whoAmIError.message}</span>
      );
    }
  } else if (whoami) {
    loggedInMessage = <span>{whoami.email}</span>;
  } else {
    loggedInMessage = <Spinner />;
  }

  const onLogout = () => {
    if (settings.apiKeyId) {
      deleteKey({ id: settings.apiKeyId });
    }
    setSettings((s) => ({ ...s, apiKey: "", apiKeyId: undefined }));
    invalidateWhoami();
    navigate("/notconfigured");
  };

  return (
    <div className="flex flex-col space-y-2">
      <Logo />
      <span className="text-lg">Settings</span>
      {grantIntent && (
        <div className="flex flex-col gap-2 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm dark:border-yellow-800 dark:bg-yellow-950">
          <p>
            Firefox can&apos;t show the permission prompt from the popup, so
            finish granting it here to enable{" "}
            {grantIntent === "always-on"
              ? "always-on highlighting"
              : "client-side crawling"}
            .
          </p>
          {grantPermissionError && (
            <p className="text-red-500">
              Permission wasn&apos;t granted. You can try again below.
            </p>
          )}
          <Button
            onClick={onGrantPermission}
            disabled={isGrantingPermission}
            className="w-fit"
          >
            {isGrantingPermission ? <Spinner /> : "Grant permission"}
          </Button>
        </div>
      )}
      <hr />
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Show count badge</span>
        <Switch
          checked={settings.showCountBadge}
          onCheckedChange={(checked) =>
            setSettings((s) => ({ ...s, showCountBadge: checked }))
          }
        />
      </div>
      {settings.showCountBadge && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Use badge cache</span>
            <Switch
              checked={settings.useBadgeCache}
              onCheckedChange={(checked) =>
                setSettings((s) => ({ ...s, useBadgeCache: checked }))
              }
            />
          </div>
          {settings.useBadgeCache && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  Badge cache expire time (second)
                </span>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={settings.badgeCacheExpireMs / 1000}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      badgeCacheExpireMs:
                        parseInt(e.target.value) * 1000 ||
                        DEFAULT_BADGE_CACHE_EXPIRE_MS,
                    }))
                  }
                  className="w-32"
                />
              </div>
            </>
          )}
        </>
      )}
      <hr />
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Client-side crawling</span>
            <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">
              Experimental
            </span>
          </div>
          <span className="text-xs text-gray-500">
            Captures the page in the browser instead of on the server. Slower,
            but captures the page more accurately as you see it. Enabling this
            asks for permission to read the content of pages you save.
          </span>
        </div>
        <Switch
          checked={clientSideCrawlingEnabled}
          onCheckedChange={onToggleClientSideCrawling}
        />
      </div>
      {clientSideCrawlingEnabled && (
        <div className="flex items-start justify-between gap-2 pl-4">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Include images</span>
            <span className="text-xs text-gray-500">
              Including images makes the upload slower.
            </span>
          </div>
          <Switch
            checked={settings.singleFileIncludeImages}
            onCheckedChange={(checked) =>
              setSettings((s) => ({ ...s, singleFileIncludeImages: checked }))
            }
          />
        </div>
      )}
      <hr />
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium">Highlighting</span>
          <span className="text-xs text-gray-500">
            On-demand activates highlighting when you open the Highlights panel
            for a page. Always-on makes it available on every page without
            opening the extension first, and asks for permission to read the
            content of pages you visit.
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isChangingHighlightingMode && <Spinner />}
          <Select
            value={settings.highlightingMode}
            onValueChange={onChangeHighlightingMode}
            disabled={isChangingHighlightingMode}
          >
            <SelectTrigger className="w-32 shrink-0">
              <SelectValue placeholder="Highlighting" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="on-demand">On-demand</SelectItem>
              <SelectItem value="always-on">Always-on</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {isChangingHighlightingMode && (
        <p className="text-xs text-muted-foreground">
          Check for a permission request from your browser (it may appear near
          the address bar or toolbar) and allow it to continue.
        </p>
      )}
      <hr />
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Auto-save on open</span>
        <Switch
          checked={settings.autoSave}
          onCheckedChange={(checked) =>
            setSettings((s) => ({ ...s, autoSave: checked }))
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">
        When disabled, you&apos;ll confirm before saving bookmarks.
      </p>
      <hr />
      <div className="flex gap-2">
        <span className="my-auto">Server Address:</span>
        {settings.address}
      </div>
      <div className="flex gap-2">
        <span className="my-auto">Logged in as:</span>
        {loggedInMessage}
      </div>
      <div className="flex gap-2">
        <span className="my-auto">Theme:</span>
        <Select value={theme} onValueChange={setTheme}>
          <SelectTrigger className="w-24">
            <SelectValue placeholder="Theme" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button onClick={onLogout}>Logout</Button>
    </div>
  );
}
