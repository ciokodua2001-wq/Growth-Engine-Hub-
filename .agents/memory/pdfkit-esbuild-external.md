---
name: pdfkit esbuild externalization
description: pdfkit and fontkit crash when bundled by esbuild due to @swc/helpers CJS dependency resolution issues
---

**Rule:** Always add `"pdfkit"` and `"fontkit"` to the `external` array in `artifacts/api-server/build.mjs` before using pdfkit in server code.

**Why:** pdfkit depends on fontkit, which uses `@swc/helpers/cjs/_define_property.cjs` internally via CJS `require()`. When esbuild bundles the whole chain into a single ESM output file, the runtime `require()` call inside fontkit's CJS module cannot resolve the `@swc/helpers` package path, crashing the server on startup with `MODULE_NOT_FOUND`. Making pdfkit (and fontkit) external causes them to load from `node_modules` at runtime, where CJS resolution works correctly.

**How to apply:** Any time you `pnpm add pdfkit` to the api-server, immediately also add `"pdfkit"` and `"fontkit"` to the `external` array in `build.mjs` (around line 55, alongside `"nodemailer"`).

`nodemailer` was already pre-listed as external in build.mjs for the same class of reasons.
