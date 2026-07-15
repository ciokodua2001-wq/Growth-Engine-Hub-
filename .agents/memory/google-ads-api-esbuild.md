---
name: google-ads-api esbuild externalization
description: How to bundle google-ads-api (gRPC-based) in the esbuild api-server without "Cannot find module" errors at runtime.
---

## Rule

Add `google-ads-api`, `google-gax`, `google-auth-library`, and `protobufjs` to the esbuild `external` list in `build.mjs`. Also install `@grpc/grpc-js` and `@grpc/proto-loader` as direct dependencies in `artifacts/api-server`.

**Why:** `google-gax` loads `.proto` files from its own package directory at runtime (path traversal), so it cannot be bundled. When bundled, its `require('protobufjs')` call resolves from the bundle's `dist/` directory instead of `google-gax`'s own `node_modules`, causing "Cannot find module 'protobufjs'" at startup. Externalizing the entire chain lets pnpm handle the transitive resolution correctly.

**How to apply:** Whenever adding any Google Ads API SDK usage to the api-server, ensure these four are in the `external` array in `build.mjs` and `@grpc/grpc-js` + `@grpc/proto-loader` are in `package.json` dependencies.

## Why the REST API approach failed

All versions of `googleads.googleapis.com` REST endpoints (v17, v18, v19) return HTML 404 pages from Replit's environment. Root cause unknown (possibly IP-based routing or the REST surface for Google Ads is not exposed at those paths in some environments). Switch to the `google-ads-api` npm SDK (gRPC) which is the transport Google Ads API is designed for.
