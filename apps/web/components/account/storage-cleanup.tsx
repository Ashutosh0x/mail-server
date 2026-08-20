"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon, icons } from "@mailserver/ui";
import { api, ApiError } from "@/lib/api";
import type { CleanupAction, CleanupReport, Orphans } from "@/lib/cleanup-types";
import { formatBytes } from "@/lib/format";

/**
 * Storage cleanup.
 *
 * Every button here permanently deletes something, so the design is built
 * around one rule: NOTHING IS DELETED THAT THE USER HAS NOT SEEN NAMED.
 *
 * There is no "clean up 2.3 GB" button. The user picks specific attachments
 * and specific messages from real lists, and the confirmation repeats exactly
 * what is about to go and how much it frees. Emptying Trash and Spam is the
 * one wholesale action, and it states the count and size first.
 *
 * The result is reported from what the server actually removed. A partial
 * failure shows the failures — it never rounds up to success.
 */

type Pending = {
  action: CleanupAction;
  title: string;
  body: string;
  ids?: string[];
};

export function StorageCleanup({ onChanged }: { onChanged: () => void }) {
  const [report, setReport] = useState<CleanupReport | null>(null);
  const [orphans, setOrphans] = useState<Orphans | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedAttachments, setSelectedAttachments] = useState<Set<string>>(new Set());
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());

  const [pending, setPending] = useState<Pending | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    deleted: number;
    freedBytes: number;
    failures: { id: string; reason: string }[];
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.cleanupReport();
      setReport(data.report);
      setOrphans(data.orphans);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not read storage details.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(async () => {
    if (!pending) return;
    setRunning(true);
    try {
      const outcome = await api.runCleanup(pending.action, pending.ids);
      setResult({
        deleted: outcome.deleted,
        freedBytes: outcome.freedBytes,
        failures: outcome.failures,
      });
      // The totals above are re-read from the server rather than adjusted
      // locally, so what is shown is what the database holds.
      onChanged();
      setSelectedAttachments(new Set());
      setSelectedMessages(new Set());
      await load();
    } catch (cause) {
      setResult({
        deleted: 0,
        freedBytes: 0,
        failures: [
          { id: "request", reason: cause instanceof ApiError ? cause.message : "The request failed." },
        ],
      });
    } finally {
      setRunning(false);
      setPending(null);
    }
  }, [pending, load, onChanged]);

  if (loading && !report) {
    return (
      <p className="text-sm text-ink-muted" role="status">
        Measuring what is using space…
      </p>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger-ink">
        {error}{" "}
        <button type="button" onClick={() => void load()} className="font-medium underline">
          Try again
        </button>
      </div>
    );
  }

  if (!report) return null;

  const trash = report.buckets.find((b) => b.role === "trash");
  const spam = report.buckets.find((b) => b.role === "junk");
  const selectedAttachmentBytes = report.largestAttachments
    .filter((a) => selectedAttachments.has(a.id))
    .reduce((sum, a) => sum + a.size, 0);
  const selectedMessageBytes = [...report.largestMessages, ...report.oldMessages]
    .filter((m, index, all) => all.findIndex((x) => x.id === m.id) === index)
    .filter((m) => selectedMessages.has(m.id))
    .reduce((sum, m) => sum + m.totalBytes, 0);

  return (
    <div className="space-y-4">
      {result && (
        <div
          role="status"
          className={
            result.failures.length > 0
              ? "rounded-lg bg-warning-muted px-3 py-2 text-sm text-warning-ink"
              : "rounded-lg bg-success-muted px-3 py-2 text-sm text-success-ink"
          }
        >
          <p>
            <strong className="font-medium">
              {result.deleted} item{result.deleted === 1 ? "" : "s"} deleted
            </strong>{" "}
            · {formatBytes(result.freedBytes)} freed.
          </p>
          {result.failures.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {result.failures.slice(0, 5).map((failure) => (
                <li key={failure.id}>{failure.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Wholesale: only the two mailboxes where it is safe ── */}
      <div className="grid gap-2 sm:grid-cols-2">
        <BucketCard
          label="Trash"
          bucket={trash}
          onEmpty={() =>
            setPending({
              action: "emptyTrash",
              title: "Empty Trash?",
              body: `This permanently deletes ${trash?.messages ?? 0} message${
                (trash?.messages ?? 0) === 1 ? "" : "s"
              } and frees about ${formatBytes(trash?.bytes ?? 0)}. It cannot be undone.`,
            })
          }
        />
        <BucketCard
          label="Spam"
          bucket={spam}
          onEmpty={() =>
            setPending({
              action: "emptySpam",
              title: "Empty Spam?",
              body: `This permanently deletes ${spam?.messages ?? 0} message${
                (spam?.messages ?? 0) === 1 ? "" : "s"
              } and frees about ${formatBytes(spam?.bytes ?? 0)}. It cannot be undone.`,
            })
          }
        />
      </div>

      {orphans && orphans.count > 0 && (
        <section className="rounded-lg border border-border bg-surface-raised p-3">
          <h4 className="text-sm font-medium text-ink">Unattached uploads</h4>
          <p className="mt-1 text-xs text-ink-muted">
            {orphans.count} file{orphans.count === 1 ? "" : "s"} totalling {formatBytes(orphans.bytes)}{" "}
            were uploaded but never attached to a message. They do not appear anywhere in your mail
            and still count against your quota.
          </p>
          <button
            type="button"
            onClick={() =>
              setPending({
                action: "deleteOrphans",
                title: "Delete unattached uploads?",
                body: `This permanently deletes ${orphans.count} file${
                  orphans.count === 1 ? "" : "s"
                } and frees ${formatBytes(orphans.bytes)}. No message references them.`,
              })
            }
            className="mt-2 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-sunken"
          >
            Delete {orphans.count} file{orphans.count === 1 ? "" : "s"}
          </button>
        </section>
      )}

      {/* ── Named items, chosen individually ── */}
      <AttachmentList
        attachments={report.largestAttachments}
        selected={selectedAttachments}
        onToggle={(id) =>
          setSelectedAttachments((current) => {
            const next = new Set(current);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
          })
        }
        onDelete={() =>
          setPending({
            action: "deleteAttachments",
            ids: [...selectedAttachments],
            title: `Delete ${selectedAttachments.size} attachment${
              selectedAttachments.size === 1 ? "" : "s"
            }?`,
            body: `This frees ${formatBytes(
              selectedAttachmentBytes
            )}. The messages stay; only the attached files are removed, and they cannot be recovered.`,
          })
        }
        selectedBytes={selectedAttachmentBytes}
      />

      <MessageList
        title="Largest messages"
        description="Message size including everything attached to it."
        messages={report.largestMessages}
        selected={selectedMessages}
        onToggle={(id) =>
          setSelectedMessages((current) => {
            const next = new Set(current);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
          })
        }
      />

      <MessageList
        title="Old messages"
        description={`Received before ${new Date(report.olderThan).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}.`}
        messages={report.oldMessages}
        selected={selectedMessages}
        onToggle={(id) =>
          setSelectedMessages((current) => {
            const next = new Set(current);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
          })
        }
      />

      {selectedMessages.size > 0 && (
        <button
          type="button"
          onClick={() =>
            setPending({
              action: "deleteMessages",
              ids: [...selectedMessages],
              title: `Permanently delete ${selectedMessages.size} message${
                selectedMessages.size === 1 ? "" : "s"
              }?`,
              body: `This frees ${formatBytes(
                selectedMessageBytes
              )}. The messages and their attachments are removed for good — this is not Trash, and there is no undo.`,
            })
          }
          className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Delete {selectedMessages.size} selected message{selectedMessages.size === 1 ? "" : "s"}
        </button>
      )}

      {pending && (
        <ConfirmDialog
          pending={pending}
          running={running}
          onCancel={() => setPending(null)}
          onConfirm={() => void run()}
        />
      )}
    </div>
  );
}

function BucketCard({
  label,
  bucket,
  onEmpty,
}: {
  label: string;
  bucket: { messages: number; bytes: number } | undefined;
  onEmpty: () => void;
}) {
  const count = bucket?.messages ?? 0;
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3">
      <h4 className="text-sm font-medium text-ink">{label}</h4>
      <p className="mt-1 text-xs text-ink-muted">
        {count} message{count === 1 ? "" : "s"} · {formatBytes(bucket?.bytes ?? 0)}
      </p>
      <button
        type="button"
        onClick={onEmpty}
        disabled={count === 0}
        className="mt-2 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
      >
        {/* Disabled rather than hidden when empty: the control staying put is
            how someone learns it exists. */}
        Empty {label}
      </button>
    </div>
  );
}

function AttachmentList({
  attachments,
  selected,
  onToggle,
  onDelete,
  selectedBytes,
}: {
  attachments: CleanupReport["largestAttachments"];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onDelete: () => void;
  selectedBytes: number;
}) {
  if (attachments.length === 0) {
    return (
      <section>
        <h4 className="text-sm font-medium text-ink">Largest attachments</h4>
        <p className="mt-1 text-xs text-ink-muted">No attachments stored.</p>
      </section>
    );
  }

  return (
    <section>
      <h4 className="text-sm font-medium text-ink">Largest attachments</h4>
      <ul className="mt-2 divide-y divide-border-muted rounded-lg border border-border">
        {attachments.map((file) => (
          <li key={file.id} className="flex items-center gap-3 px-3 py-2">
            <input
              type="checkbox"
              checked={selected.has(file.id)}
              onChange={() => onToggle(file.id)}
              aria-label={`Select ${file.filename}`}
              className="size-4 shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{file.filename}</span>
              <span className="block truncate text-xs text-ink-muted">
                {file.subject ? `in "${file.subject}"` : "not attached to any message"}
              </span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-ink-secondary">
              {formatBytes(file.size)}
            </span>
          </li>
        ))}
      </ul>
      {selected.size > 0 && (
        <button
          type="button"
          onClick={onDelete}
          className="mt-2 rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Delete {selected.size} attachment{selected.size === 1 ? "" : "s"} ·{" "}
          {formatBytes(selectedBytes)}
        </button>
      )}
    </section>
  );
}

function MessageList({
  title,
  description,
  messages,
  selected,
  onToggle,
}: {
  title: string;
  description: string;
  messages: CleanupReport["largestMessages"];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <section>
      <h4 className="text-sm font-medium text-ink">{title}</h4>
      <p className="mt-0.5 text-xs text-ink-muted">{description}</p>
      {messages.length === 0 ? (
        <p className="mt-1 text-xs text-ink-muted">Nothing here.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border-muted rounded-lg border border-border">
          {messages.map((message) => (
            <li key={message.id} className="flex items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                checked={selected.has(message.id)}
                onChange={() => onToggle(message.id)}
                aria-label={`Select ${message.subject}`}
                className="size-4 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{message.subject}</span>
                <span className="block truncate text-xs text-ink-muted">
                  {message.from} ·{" "}
                  {new Date(message.receivedAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                  {message.attachmentCount > 0 &&
                    ` · ${message.attachmentCount} attachment${message.attachmentCount === 1 ? "" : "s"}`}
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-ink-secondary">
                {formatBytes(message.totalBytes)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The confirmation.
 *
 * States what is going and what it frees, in the words of the thing being
 * deleted rather than "Are you sure?". Cancel takes the focus, so Enter on a
 * dialog nobody read does nothing.
 */
function ConfirmDialog({
  pending,
  running,
  onCancel,
  onConfirm,
}: {
  pending: Pending;
  running: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cleanup-confirm-title"
        aria-describedby="cleanup-confirm-body"
        className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-5 shadow-lg"
      >
        <div className="flex items-start gap-3">
          <Icon icon={icons.status.warning} size="md" className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <h3 id="cleanup-confirm-title" className="text-base font-semibold text-ink">
              {pending.title}
            </h3>
            <p id="cleanup-confirm-body" className="mt-1 text-sm text-ink-secondary">
              {pending.body}
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            disabled={running}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={running}
            className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {running ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
