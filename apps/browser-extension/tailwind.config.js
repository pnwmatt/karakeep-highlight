import web from "@karakeep/tailwind-config/web";

const config = {
  darkMode: "selector",
  // HIGHLIGHT_COLOR_MAP's literal `bg-{color}-200`/`border-l-{color}-200`
  // classes live in packages/shared-react, outside this app's own src/ — so
  // they need to be scanned explicitly, same as apps/web/tailwind.config.ts
  // already does, or Tailwind's JIT never generates that CSS at all.
  content: [
    ...web.content,
    "../../packages/shared-react/components/**/*.{ts,tsx}",
  ],
  presets: [web],
};

export default config;
