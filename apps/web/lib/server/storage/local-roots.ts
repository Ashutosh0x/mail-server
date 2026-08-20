import "server-only";
import { resolve, sep } from "node:path";
import { pathListSeparator, pathListSeparatorName } from "../platform/platform";

/**
 * Which host paths may be turned into a storage connection.
 *
 * Without this, "use this detected disk" is a privilege escalation: any signed-in
 * user could create a connection rooted at `/` or `C:\` and get a file browser
 * over the entire server — configuration, other tenants' attachments, the
 * database file, the private keys. Detection listing a mount is not consent to
 * expose it.
 *
 * So the operator declares the permitted roots, server-side, in
 * `STORAGE_LOCAL_ROOTS`. Unset means local connections are refused entirely,
 * which is the right default for a mail server that has not been told
 * otherwise. The UI explains the variable rather than silently offering a
 * button that always fails.
 *
 * Separator is the platform's path delimiter — `;` on Windows, `:` on POSIX —
 * matching how PATH is written, because a Windows path contains a colon.
 */

export function configuredRoots(): string[] {
  const raw = process.env.STORAGE_LOCAL_ROOTS;
  if (!raw) return [];
  const separator = pathListSeparator();
  return raw
    .split(separator)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => resolve(entry));
}

export type RootVerdict =
  | { ok: true; root: string }
  | { ok: false; reason: string };

/**
 * Check a requested root against the configured allow-list.
 *
 * A path is permitted when it IS an allowed root or lies beneath one, so an
 * operator can allow `/mnt` and users may connect `/mnt/nas/photos`. The
 * comparison is on resolved paths and requires a separator boundary, so
 * `/mnt-secret` does not pass because it starts with `/mnt`.
 */
export function checkLocalRoot(requested: string): RootVerdict {
  const roots = configuredRoots();

  if (roots.length === 0) {
    return {
      ok: false,
      reason:
        "Local storage connections are disabled. Set STORAGE_LOCAL_ROOTS on the server to the paths " +
        "that may be used, separated by " +
        pathListSeparatorName() +
        ".",
    };
  }

  if (requested.includes("\0")) {
    return { ok: false, reason: "That path is not valid." };
  }

  const candidate = resolve(requested);
  const permitted = roots.some(
    (root) => candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep)
  );

  if (!permitted) {
    return {
      ok: false,
      reason: "That path is not one the server permits for storage connections.",
    };
  }

  return { ok: true, root: candidate };
}
