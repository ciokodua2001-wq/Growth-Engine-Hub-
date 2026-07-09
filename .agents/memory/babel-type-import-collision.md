---
name: Babel mixed type import collision
description: Using `type X as Y` inside a mixed value+type import block causes Babel duplicate-identifier error in Vite; use a separate import type statement instead.
---

## Rule
Never put `type X as Y` inside a mixed value+type `import { ... }` block when that same name (`X`) appears as a value import from another package in the same file.

## Why
Vite uses `@babel/plugin-transform-typescript` (via `@vitejs/plugin-react`) to strip TypeScript syntax. Babel's parser — even with TypeScript support — can flag the original name in a `type X as Y` inline specifier as a duplicate identifier if another import in the same file uses `X` as a value (even aliased). TypeScript's own typechecker has no problem with this, so `tsc --noEmit` passes while Vite/Babel fails at runtime.

## How to apply
When you need a type-only import aliased to avoid a name collision, use a **separate** `import type` statement:

```typescript
// ✅ CORRECT — separate statement, no collision
import { Video as VideoIcon } from "lucide-react";
import type { Video as VideoModel } from "@workspace/api-client-react";

// ❌ WRONG — mixed block triggers Babel duplicate-identifier error
import {
  Video as VideoIcon,
  type Video as VideoModel, // Babel chokes here
} from "...";
```

This also applies when importing from separate packages — even if the `type` keyword is present, keep the type-only import in its own `import type` line.
