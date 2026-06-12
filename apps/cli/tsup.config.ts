import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node18",
  // Inline the internal @buffalo/* workspace libs so the published CLI is
  // self-contained on a stranger's machine; real npm deps (@clack/prompts)
  // stay external and install normally.
  noExternal: [/^@buffalo\//],
  // Code-split so the lazy `import("@buffalo/ui")` in `buffalo preview`
  // becomes a separate chunk — react-dom stays out of the main bin.
  splitting: true,
  // Shebang first, then a real `require` via createRequire so bundled CJS
  // deps (react-dom/server inside @buffalo/ui) can require() node builtins
  // from an ESM bundle. The source no longer carries its own shebang.
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire } from "node:module";',
      "const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
  clean: true,
  dts: false,
  sourcemap: false,
});
