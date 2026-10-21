import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./vitest.global-setup.mts";

const local = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": local("./src"),
      // the marker package throws outside a React server bundle
      "server-only": local("./node_modules/server-only/empty.js"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["./vitest.global-setup.mts"],
    env: { DATABASE_URL: TEST_DATABASE_URL, AUTH_SECRET: "test-only-secret-0123456789" },
    // the server tests share one database
    fileParallelism: false,
  },
});
