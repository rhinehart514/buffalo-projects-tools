import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node18",
  // Inline the internal @buffalo/* workspace libs; keep the MCP SDK and zod
  // external so they install as normal dependencies.
  noExternal: [/^@buffalo\//],
  // Shebang first, then a real `require` via createRequire so any bundled
  // CJS dep can require() node builtins from an ESM bundle. The source no
  // longer carries its own shebang.
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
