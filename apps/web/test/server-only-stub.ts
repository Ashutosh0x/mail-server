/**
 * Test stub for the `server-only` package.
 *
 * The real package throws on import to keep server modules out of client
 * bundles. That guard stays in the source; this replaces it under Vitest so
 * the guarded modules can be tested without weakening the production build.
 *
 * Aliased in vitest.config.ts. Deliberately empty.
 */
export {};
