import { AsyncLocalStorage } from "node:async_hooks";

// As Next's own server sets it before anything of its own loads (next/dist/server/node-environment-baseline.js):
// what Next keeps of a request, which src/i18n/server.ts reads a page's language from, needs it
(globalThis as { AsyncLocalStorage?: typeof AsyncLocalStorage }).AsyncLocalStorage ??= AsyncLocalStorage;
