import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest configuration.
 *
 * Two aliases, both load-bearing:
 *
 * `server-only` throws on import outside a React Server Component. That guard
 * is genuinely valuable — it is what stops a module holding database access or
 * secrets from being pulled into a client bundle — so it stays in the source.
 * Stubbing it HERE means the guard keeps protecting the build while the
 * modules it protects remain testable. The alternative, which this repository
 * has reached for twice before, is deleting the import to make a test pass:
 * that trades a real safety property for test convenience.
 *
 * `@/` mirrors the `paths` mapping in tsconfig.json, which Vitest does not
 * read on its own.
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.spec.ts", "**/*.spec.tsx"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
