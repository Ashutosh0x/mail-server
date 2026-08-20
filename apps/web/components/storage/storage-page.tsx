"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon, icons } from "@mailserver/ui";
import { api, ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { DiscoveryResult, DiscoveredResource } from "@/lib/storage-types";

/**
 * The Storage page.
 *
 * Shows what the SERVER can actually see. Two things this deliberately does
 * not do:
 *
 *   - It does not list devices nobody has connected. Finding an unmounted NAS
 *     needs mDNS or SSDP, neither of which is implemented, so the page says so
 *     and offers manual connection instead of inventing a "Synology NAS" row.
 *
 *   - It does not show a capacity the provider did not report. A mount that
 *     cannot be measured reads "Capacity unavailable", never 0 B or an
 *     estimate.
 */

const TYPE_LABEL: Record<DiscoveredResource["type"], string> = {
  local: "Local disk",
  usb: "Removable",
  smb: "SMB share",
  nfs: "NFS export",
  webdav: "WebDAV",
  unknown: "Filesystem",
};

export function StoragePage() {
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ usedBytes: number; quotaBytes: number } | null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const [found, account] = await Promise.all([api.discoverStorage(), api.storage()]);
      setDiscovery(found);
      setUsage({
        usedBytes: account.storage.usedBytes,
        quotaBytes: account.storage.quotaBytes,
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not scan for storage.");
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  return (
    <section aria-label="Storage" className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-canvas">
      <header className="flex items-start gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-ink">Storage</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            Storage available to the server running Mail Server.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void scan()}
          disabled={scanning}
          className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken disabled:opacity-60"
        >
          {scanning ? "Scanning…" : "Scan again"}
        </button>
      </header>

      <div className="space-y-6 p-5">
        {/* ── My storage: the account's own quota, already live ── */}
        <section>
          <h2 className="text-sm font-semibold text-ink">My storage</h2>
          {usage ? (
            <div className="mt-2 rounded-lg border border-border bg-surface-raised p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-ink-secondary">
                  {formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)} used
                </span>
                <span className="text-sm tabular-nums text-ink-muted">
                  {formatBytes(Math.max(0, usage.quotaBytes - usage.usedBytes))} free
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={Math.round((usage.usedBytes / Math.max(1, usage.quotaBytes)) * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Storage used"
                className="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken"
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.min(100, (usage.usedBytes / Math.max(1, usage.quotaBytes)) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                Summed from your messages and attachments on every request, not from a cached counter.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">Reading usage…</p>
          )}
        </section>

        {/* ── Detected: real mounts, or an honest empty state ── */}
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-ink">Detected storage</h2>
            {discovery && (
              <span className="text-xs text-ink-muted">
                {discovery.resources.length} found on {discovery.capabilities.platform}
              </span>
            )}
          </div>

          {error && (
            <div role="alert" className="mt-2 rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger-ink">
              {error}{" "}
              <button type="button" onClick={() => void scan()} className="font-medium underline">
                Try again
              </button>
            </div>
          )}

          {scanning && !discovery && (
            <p className="mt-2 text-sm text-ink-muted" role="status">
              Scanning for available storage…
            </p>
          )}

          {discovery?.errors.map((message) => (
            <p key={message} className="mt-2 rounded-lg bg-warning-muted px-3 py-2 text-sm text-warning-ink">
              {message}
            </p>
          ))}

          {discovery && discovery.resources.length === 0 && discovery.errors.length === 0 && (
            <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-ink-muted">
              No storage devices detected.
            </p>
          )}

          {discovery && discovery.resources.length > 0 && (
            <ul className="mt-2 space-y-2">
              {discovery.resources.map((resource) => (
                <li
                  key={resource.id}
                  className="flex items-start gap-3 rounded-lg border border-border bg-surface-raised p-3"
                >
                  <Icon
                    icon={resource.type === "usb" ? icons.account.devices : icons.account.storage}
                    size="md"
                    className="mt-0.5 shrink-0 text-ink-secondary"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-ink">{resource.name}</span>
                      <span className="rounded border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                        {TYPE_LABEL[resource.type]}
                      </span>
                      {resource.readOnly === true && (
                        <span className="text-xs text-ink-muted">read-only</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-ink-muted">
                      {resource.source ?? resource.path}
                      {resource.hostname && ` · ${resource.hostname}`}
                      {` · ${resource.protocol}`}
                    </p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {resource.capacity.totalBytes === null ? (
                        // Never a computed or assumed figure.
                        "Capacity unavailable"
                      ) : (
                        <>
                          {formatBytes(resource.capacity.usedBytes ?? 0)} of{" "}
                          {formatBytes(resource.capacity.totalBytes)} used ·{" "}
                          {formatBytes(resource.capacity.freeBytes ?? 0)} free
                        </>
                      )}
                    </p>
                  </div>
                  <span
                    className={
                      resource.connectionStatus === "available"
                        ? "shrink-0 rounded px-2 py-0.5 text-xs font-medium text-success-ink bg-success-muted"
                        : "shrink-0 rounded px-2 py-0.5 text-xs font-medium text-warning-ink bg-warning-muted"
                    }
                  >
                    {resource.connectionStatus === "available" ? "Available" : "Unreachable"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── What this build can and cannot do, said plainly ── */}
        <section>
          <h2 className="text-sm font-semibold text-ink">Connect storage</h2>
          <div className="mt-2 space-y-2">
            <ConnectorRow
              title="WebDAV"
              state="ready"
              detail="Implemented and tested against a real WebDAV server: list, upload, download, move, copy, delete, and RFC 4331 quota where the server publishes it. HTTPS is required unless the server sets WEBDAV_ALLOW_INSECURE."
            />
            <ConnectorRow
              title="Mounted filesystems"
              state="ready"
              detail="Local disks, removable drives, and network shares already mounted on the host are detected above with real capacity from the operating system."
            />
            <ConnectorRow
              title="SMB / CIFS"
              state="unbuilt"
              detail="Shares already mounted by the host are detected above. Connecting to an unmounted share from inside the app needs an SMB client library, which is not installed. Mount it on the host and it appears here."
            />
            <ConnectorRow
              title="NFS"
              state="unbuilt"
              detail="Exports already mounted on the host are detected above. Mounting one from the app requires an operating-system mount and privileges the server does not hold."
            />
            <ConnectorRow
              title="S3-compatible object storage"
              state="unbuilt"
              detail="Not implemented. It needs SigV4 request signing, which has not been written or verified against a real endpoint."
            />
            <ConnectorRow
              title="Network discovery (mDNS / SSDP)"
              state="unbuilt"
              detail="Devices that are not already mounted are not discovered. Scanning IP ranges is deliberately not done: it is slow, hostile on shared networks, and hard to distinguish from an attack."
            />
          </div>
        </section>
      </div>
    </section>
  );
}

/**
 * One connector, with its real state.
 *
 * `unbuilt` rows carry no Connect button. A button that opens a form leading
 * to a 501 is worse than an explanation.
 */
function ConnectorRow({
  title,
  state,
  detail,
}: {
  title: string;
  state: "ready" | "unbuilt";
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-raised p-3">
      <Icon
        icon={state === "ready" ? icons.status.success : icons.status.info}
        size="md"
        className={state === "ready" ? "mt-0.5 shrink-0 text-success" : "mt-0.5 shrink-0 text-ink-muted"}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">{title}</span>
          <span className="rounded border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-ink-muted">
            {state === "ready" ? "Available" : "Not built"}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-ink-muted">{detail}</p>
      </div>
    </div>
  );
}
