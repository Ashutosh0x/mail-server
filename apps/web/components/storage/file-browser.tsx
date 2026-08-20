"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, icons } from "@mailserver/ui";
import { ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { StorageEntry, ConnectorCapabilities } from "@/lib/storage-types";

/**
 * The file browser.
 *
 * Every listing, transfer and mutation is a real request against the
 * connection's connector. There is no local cache pretending to be a
 * filesystem: after a rename the directory is re-listed, because the server is
 * the only thing that knows whether the rename happened.
 *
 * Read-only storage disables the write controls rather than letting the user
 * discover the limitation by hitting an error.
 */

type SortKey = "name" | "size" | "modified";

interface Transfer {
  id: string;
  name: string;
  bytes: number;
  total: number;
  state: "uploading" | "done" | "failed" | "cancelled";
  error?: string;
  abort?: () => void;
}

export function FileBrowser({ connectionId }: { connectionId: string }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<StorageEntry[] | null>(null);
  const [capabilities, setCapabilities] = useState<ConnectorCapabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<StorageEntry | null>(null);

  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (target: string) => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/storage/connections/${connectionId}/files?path=${encodeURIComponent(target)}`
        );
        const body = await response.json();
        if (!response.ok) throw new ApiError(response.status, body?.error?.code ?? "", body?.error?.message ?? "Could not open that folder.");
        setEntries(body.entries);
        setCapabilities(body.capabilities);
        setError(null);
      } catch (cause) {
        setEntries(null);
        setError(cause instanceof ApiError ? cause.message : "Could not open that folder.");
      } finally {
        setLoading(false);
      }
    },
    [connectionId]
  );

  useEffect(() => {
    void load(path);
  }, [load, path]);

  const operate = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const response = await fetch(`/api/storage/connections/${connectionId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok) throw new ApiError(response.status, "", result?.error?.message ?? "That failed.");
        // Re-listed from the server: it is the only thing that knows whether
        // the operation actually happened.
        await load(path);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "That operation failed.");
      } finally {
        setBusy(false);
      }
    },
    [connectionId, load, path]
  );

  /**
   * Upload with real progress.
   *
   * XMLHttpRequest because `fetch` still has no upload-progress event, and a
   * progress bar that is not driven by bytes actually sent is a lie.
   */
  const upload = useCallback(
    (file: File) => {
      const id = `${file.name}-${Date.now()}`;
      const target = [path, file.name].filter(Boolean).join("/");
      const xhr = new XMLHttpRequest();

      setTransfers((current) => [
        ...current,
        { id, name: file.name, bytes: 0, total: file.size, state: "uploading", abort: () => xhr.abort() },
      ]);

      const update = (patch: Partial<Transfer>) =>
        setTransfers((current) => current.map((t) => (t.id === id ? { ...t, ...patch } : t)));

      xhr.open("PUT", `/api/storage/connections/${connectionId}/content?path=${encodeURIComponent(target)}`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) update({ bytes: event.loaded, total: event.total });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          update({ state: "done", bytes: file.size });
          void load(path);
        } else {
          const parsed = (() => {
            try {
              return JSON.parse(xhr.responseText);
            } catch {
              return null;
            }
          })();
          update({ state: "failed", error: parsed?.error?.message ?? `Upload failed (${xhr.status}).` });
        }
      };
      xhr.onerror = () => update({ state: "failed", error: "The upload could not reach the server." });
      xhr.onabort = () => update({ state: "cancelled" });
      xhr.send(file);
    },
    [connectionId, load, path]
  );

  const segments = path.split("/").filter(Boolean);
  const writable = capabilities?.write === true;

  const visible = (entries ?? [])
    .filter((entry) => entry.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      if (sortKey === "size") return (b.size ?? 0) - (a.size ?? 0);
      if (sortKey === "modified") {
        return (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? "");
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Breadcrumbs and controls ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <nav aria-label="Folder path" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => setPath("")}
            className="rounded px-1.5 py-0.5 text-ink-secondary hover:bg-surface-sunken hover:text-ink"
          >
            Root
          </button>
          {segments.map((segment, index) => (
            <span key={`${segment}-${index}`} className="flex min-w-0 items-center gap-1">
              <span aria-hidden className="text-ink-muted">
                /
              </span>
              <button
                type="button"
                onClick={() => setPath(segments.slice(0, index + 1).join("/"))}
                className="truncate rounded px-1.5 py-0.5 text-ink-secondary hover:bg-surface-sunken hover:text-ink"
              >
                {segment}
              </button>
            </span>
          ))}
        </nav>

        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter this folder"
          aria-label="Filter files in this folder"
          className="w-44 rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-primary"
        />

        <label className="sr-only" htmlFor="storage-sort">
          Sort by
        </label>
        <select
          id="storage-sort"
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink"
        >
          <option value="name">Name</option>
          <option value="size">Size</option>
          <option value="modified">Modified</option>
        </select>

        {writable ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const name = window.prompt("Folder name");
                if (name) void operate({ operation: "mkdir", path, name });
              }}
              className="rounded-md border border-border px-2.5 py-1 text-sm font-medium text-ink hover:bg-surface-sunken disabled:opacity-60"
            >
              New folder
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => picker.current?.click()}
              className="rounded-md bg-primary px-2.5 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              Upload
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                for (const file of Array.from(event.target.files ?? [])) upload(file);
                event.target.value = "";
              }}
            />
          </>
        ) : (
          <span className="rounded border border-border px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
            Read-only storage
          </span>
        )}
      </div>

      {/* ── Transfers, driven by real bytes ── */}
      {transfers.length > 0 && (
        <ul className="border-b border-border px-4 py-2 text-sm">
          {transfers.map((transfer) => (
            <li key={transfer.id} className="flex items-center gap-3 py-1">
              <span className="min-w-0 flex-1 truncate text-ink-secondary">{transfer.name}</span>
              {transfer.state === "uploading" && (
                <>
                  <span className="w-32 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                    <span
                      className="block h-1.5 rounded-full bg-primary"
                      style={{ width: `${Math.round((transfer.bytes / Math.max(1, transfer.total)) * 100)}%` }}
                    />
                  </span>
                  <span className="tabular-nums text-xs text-ink-muted">
                    {formatBytes(transfer.bytes)} / {formatBytes(transfer.total)}
                  </span>
                  <button
                    type="button"
                    onClick={() => transfer.abort?.()}
                    className="text-xs font-medium text-ink-secondary underline"
                  >
                    Cancel
                  </button>
                </>
              )}
              {transfer.state === "done" && <span className="text-xs text-success">Uploaded</span>}
              {transfer.state === "cancelled" && <span className="text-xs text-ink-muted">Cancelled</span>}
              {transfer.state === "failed" && (
                <span className="text-xs text-danger">{transfer.error ?? "Failed"}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ── Listing ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div role="alert" className="m-4 rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger-ink">
            {error}{" "}
            <button type="button" onClick={() => void load(path)} className="font-medium underline">
              Try again
            </button>
          </div>
        )}

        {loading && !entries && (
          <p className="p-4 text-sm text-ink-muted" role="status">
            Opening…
          </p>
        )}

        {entries && visible.length === 0 && (
          <p className="p-6 text-center text-sm text-ink-muted">
            {filter ? "Nothing matches that filter." : "This folder is empty."}
          </p>
        )}

        {visible.length > 0 && (
          <ul className="divide-y divide-border-muted">
            {visible.map((entry) => (
              <li key={entry.path} className="flex items-center gap-3 px-4 py-2">
                <Icon
                  icon={entry.isDirectory ? icons.mailbox.folder : icons.fileType.generic}
                  size="md"
                  className="shrink-0 text-ink-secondary"
                />
                {entry.isDirectory ? (
                  <button
                    type="button"
                    onClick={() => setPath(entry.path)}
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium text-ink hover:underline"
                  >
                    {entry.name}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{entry.name}</span>
                )}

                <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                  {entry.size === null ? "—" : formatBytes(entry.size)}
                </span>
                <span className="hidden shrink-0 text-xs text-ink-muted sm:block">
                  {entry.modifiedAt
                    ? new Date(entry.modifiedAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                    : "—"}
                </span>

                <span className="flex shrink-0 items-center gap-1">
                  {!entry.isDirectory && (
                    <a
                      href={`/api/storage/connections/${connectionId}/content?path=${encodeURIComponent(entry.path)}`}
                      download={entry.name}
                      className="rounded px-2 py-0.5 text-xs font-medium text-ink-secondary hover:bg-surface-sunken hover:text-ink"
                    >
                      Download
                    </a>
                  )}
                  {writable && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const name = window.prompt("New name", entry.name);
                          if (name && name !== entry.name) {
                            void operate({ operation: "rename", path: entry.path, name });
                          }
                        }}
                        className="rounded px-2 py-0.5 text-xs font-medium text-ink-secondary hover:bg-surface-sunken hover:text-ink"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirming(entry)}
                        className="rounded px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger-muted"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Destructive operations are confirmed, and the confirmation names the
          thing being deleted rather than asking "are you sure?". */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-5 shadow-lg"
          >
            <h3 id="delete-title" className="text-base font-semibold text-ink">
              Delete {confirming.name}?
            </h3>
            <p className="mt-1 text-sm text-ink-secondary">
              {confirming.isDirectory
                ? "This deletes the folder and everything inside it on the storage device. It cannot be undone."
                : "This deletes the file on the storage device. It cannot be undone."}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirming(null)}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void operate({
                    operation: "delete",
                    path: confirming.path,
                    recursive: confirming.isDirectory,
                  });
                  setConfirming(null);
                }}
                className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
