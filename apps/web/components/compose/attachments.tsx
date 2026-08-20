"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, cn, haptics, iconForMimeType, icons } from "@mailserver/ui";
import { api, ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";

/**
 * Composer attachments.
 *
 * Every state here reflects a real upload. Progress comes from
 * XMLHttpRequest's `upload.onprogress` — actual bytes on the wire, never a
 * timer pretending to be one — and a file is only "attached" once the server
 * has stored it and returned an id.
 *
 * The server independently re-checks size and determines the real content type
 * from magic bytes. Nothing enforced here is a security control; it exists so
 * a user learns about a problem before waiting for a 100MB upload to be
 * rejected.
 */

export interface AttachmentItem {
  /** Local id, stable across the upload's lifetime. */
  key: string;
  filename: string;
  size: number;
  /** Server id, present only once the upload has completed. */
  id?: string;
  contentType?: string;
  /** True when the browser's claimed type disagreed with the magic bytes. */
  typeMismatch?: boolean;
  status: "uploading" | "done" | "failed" | "cancelled";
  progress: number;
  error?: string;
  /** Kept so a failed upload can be retried without re-picking the file. */
  file?: File;
  abort?: () => void;
}

export function AttachmentPanel({
  items,
  onChange,
  maxBytes,
  maxOutboundBytes,
  registerOpen,
}: {
  items: AttachmentItem[];
  /**
   * A state setter, not a plain callback.
   *
   * Every mutation below is a FUNCTIONAL update against the current value.
   * Reading the list from a ref instead was a real race: `addFiles` added an
   * item and then synchronously started its upload, whose first progress write
   * read a ref that had not been refreshed yet — so it overwrote the pending
   * addition with the previous, empty array and the attachment vanished.
   */
  onChange: React.Dispatch<React.SetStateAction<AttachmentItem[]>>;
  maxBytes: number;
  maxOutboundBytes: number;
  /** Receives a function the toolbar can call to open the file picker. */
  registerOpen?: (open: () => void) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // Depth counter: dragenter/dragleave fire for every child element, so a
  // boolean flickers as the pointer crosses the panel's own contents.
  const dragDepth = useRef(0);

  // The toolbar button lives in the composer footer, not here, so the
  // parent is handed a way to open this panel's hidden input.
  useEffect(() => {
    registerOpen?.(() => inputRef.current?.click());
  }, [registerOpen]);

  const update = useCallback(
    (key: string, patch: Partial<AttachmentItem>) => {
      onChange((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    },
    [onChange]
  );

  const startUpload = useCallback(
    (item: AttachmentItem, file: File) => {
      const controller = new AbortController();
      update(item.key, {
        status: "uploading",
        progress: 0,
        error: undefined,
        abort: () => controller.abort(),
      });

      void api
        .upload(file, (fraction) => update(item.key, { progress: fraction }), controller.signal)
        .then((result) => {
          haptics.tap();
          update(item.key, {
            status: "done",
            progress: 1,
            id: result.attachment.id,
            contentType: result.attachment.contentType,
            typeMismatch: result.attachment.typeMismatch,
            abort: undefined,
          });
        })
        .catch((cause) => {
          if (cause instanceof ApiError && cause.code === "aborted") {
            // Cancelling is a decision, not a failure. Remove it outright.
            onChange((current) => current.filter((existing) => existing.key !== item.key));
            return;
          }
          haptics.error();
          update(item.key, {
            status: "failed",
            error: cause instanceof ApiError ? cause.message : "The upload failed.",
            abort: undefined,
          });
        });
    },
    [update, onChange]
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files);
      if (incoming.length === 0) return;

      const accepted: AttachmentItem[] = [];
      for (const file of incoming) {
        const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
        if (file.size > maxBytes) {
          // Rejected up front rather than after the whole file has uploaded.
          accepted.push({
            key,
            filename: file.name,
            size: file.size,
            status: "failed",
            progress: 0,
            error: `This file is ${formatBytes(file.size)}, over the ${formatBytes(maxBytes)} limit.`,
          });
          continue;
        }
        accepted.push({ key, filename: file.name, size: file.size, status: "uploading", progress: 0, file });
      }

      onChange((current) => [...current, ...accepted]);
      for (const item of accepted) {
        if (item.status === "uploading" && item.file) startUpload(item, item.file);
      }
    },
    [maxBytes, onChange, startUpload]
  );

  const remove = useCallback(
    (key: string) => {
      // Read the item for its abort handle from the CURRENT list, then
      // remove it — both inside one functional update so neither races an
      // in-flight upload.
      onChange((current) => {
        current.find((existing) => existing.key === key)?.abort?.();
        return current.filter((existing) => existing.key !== key);
      });
      haptics.impact();
    },
    [onChange]
  );

  const total = items.filter((i) => i.status === "done").reduce((sum, i) => sum + i.size, 0);
  const overOutboundLimit = total > maxOutboundBytes;

  return (
    <div
      onDragEnter={(event) => {
        // Only react to an actual file drag, not to text selection.
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        addFiles(event.dataTransfer.files);
      }}
      className={cn(
        "relative border-t border-border transition-colors",
        dragging && "bg-primary-muted"
      )}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-primary bg-primary-muted/80">
          <span className="text-sm font-medium text-primary">Drop files to attach</span>
        </div>
      )}

      {items.length > 0 && (
        <ul className="max-h-40 space-y-1.5 overflow-y-auto p-2">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-center gap-2.5 rounded-lg border border-border-muted bg-surface px-2.5 py-2"
            >
              <Icon
                icon={item.contentType ? iconForMimeType(item.contentType) : icons.fileType.generic}
                size="md"
                className="shrink-0 text-ink-secondary"
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm text-ink">{item.filename}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                    {formatBytes(item.size)}
                  </span>
                </div>

                {item.status === "uploading" && (
                  <div className="mt-1 flex items-center gap-2">
                    <div
                      role="progressbar"
                      aria-valuenow={Math.round(item.progress * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Uploading ${item.filename}`}
                      className="h-1 flex-1 overflow-hidden rounded-full bg-surface-sunken"
                    >
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-150"
                        style={{ width: `${item.progress * 100}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                      {Math.round(item.progress * 100)}%
                    </span>
                  </div>
                )}

                {item.status === "done" && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-success">
                    <Icon icon={icons.status.success} size="sm" />
                    Attached
                    {item.typeMismatch && (
                      <span
                        className="ml-1 text-warning"
                        title="The file's actual type differs from its extension."
                      >
                        · type differs from extension
                      </span>
                    )}
                  </span>
                )}

                {item.status === "failed" && (
                  <span className="mt-0.5 block text-xs text-danger">{item.error}</span>
                )}
              </div>

              {item.status === "failed" && item.file && (
                <button
                  type="button"
                  onClick={() => startUpload(item, item.file!)}
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-ink-secondary hover:bg-surface-sunken"
                >
                  Retry
                </button>
              )}

              <button
                type="button"
                onClick={() => remove(item.key)}
                aria-label={
                  item.status === "uploading"
                    ? `Cancel upload of ${item.filename}`
                    : `Remove ${item.filename}`
                }
                className="shrink-0 rounded-md p-1 text-ink-muted hover:bg-surface-sunken hover:text-ink"
              >
                <Icon icon={icons.chrome.close} size="sm" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {overOutboundLimit && (
        <p role="alert" className="mx-2 mb-2 rounded-lg bg-danger-muted px-2.5 py-1.5 text-xs text-danger-ink">
          Attachments total {formatBytes(total)}, over the {formatBytes(maxOutboundBytes)} limit for
          outgoing mail. The server will refuse this message.
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          // Reset so picking the same file twice still fires a change.
          event.target.value = "";
        }}
      />
    </div>
  );
}
