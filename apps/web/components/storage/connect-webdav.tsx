"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

/**
 * Connect a WebDAV server.
 *
 * The form submits once and the SERVER probes before storing anything: there
 * is no separate "Test connection" that could succeed while the save fails, or
 * a save that reports success without a probe. A failure leaves no record at
 * all, so the list never shows a connection that has never worked.
 */
export function ConnectWebDav({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [url, setUrl] = useState("https://");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.connectStorage({ provider: "webdav", displayName, url, username, password });
      onConnected();
    } catch (cause) {
      // The server's category, verbatim: "rejected those credentials" and
      // "could not be reached" are different problems with different fixes.
      setError(cause instanceof ApiError ? cause.message : "That server could not be connected.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-webdav-title"
        className="w-full max-w-md rounded-xl border border-border bg-surface-raised p-5 shadow-lg"
      >
        <h2 id="connect-webdav-title" className="text-base font-semibold text-ink">
          Connect WebDAV
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          The server tests these details before saving anything. Credentials are encrypted and are
          never sent back to the browser.
        </p>

        <div className="mt-4 space-y-3">
          <Field label="Name" value={displayName} onChange={setDisplayName} placeholder="Office NAS" />
          <Field label="URL" value={url} onChange={setUrl} placeholder="https://dav.example.com/remote.php/dav" />
          <Field label="Username" value={username} onChange={setUsername} autoComplete="username" />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete="current-password"
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-md bg-danger-muted px-3 py-2 text-sm text-danger-ink">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !displayName || !url || !username || !password}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Testing…" : "Test and connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-secondary">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-primary"
      />
    </label>
  );
}
