"use client";

import { useCallback, useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { Icon, cn, haptics, icons } from "@mailserver/ui";
import { api, ApiError } from "@/lib/api";
import type { PasskeyRecord } from "@/lib/account-types";

/**
 * Passkey management.
 *
 * The whole ceremony is: ask the server for a challenge, hand it to the
 * platform authenticator, send back what it signs. The browser owns the
 * biometric prompt — this code never sees a fingerprint, a face or a PIN, and
 * the private key never leaves the device.
 *
 * Capability is detected rather than assumed. WebAuthn needs a secure context,
 * so on plain HTTP over anything but localhost `window.PublicKeyCredential` is
 * undefined, and the honest response is to say so rather than to render a
 * button that throws.
 */
export function PasskeyManager({ onChanged }: { onChanged?: () => void }) {
  const [passkeys, setPasskeys] = useState<PasskeyRecord[] | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [platformAvailable, setPlatformAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const hasApi =
      typeof window !== "undefined" &&
      typeof window.PublicKeyCredential !== "undefined" &&
      window.isSecureContext;
    setSupported(hasApi);

    if (!hasApi) {
      setPlatformAvailable(false);
      return;
    }
    // A built-in authenticator (Touch ID, Windows Hello, Android screen lock).
    // Its absence is not fatal — a security key still works — but it changes
    // what to tell the user.
    void window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()
      .then(setPlatformAvailable)
      .catch(() => setPlatformAvailable(false));
  }, []);

  const load = useCallback(async () => {
    try {
      setPasskeys((await api.passkeys()).passkeys);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not load your passkeys.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { options } = await api.passkeyRegisterChallenge();
      // The browser takes over here: it prompts, generates the key pair, and
      // returns only the public half plus a signature.
      const attestation = await startRegistration({ optionsJSON: options });

      const name = defaultPasskeyName();
      const result = await api.passkeyRegister(attestation, name);
      setPasskeys(result.passkeys);
      haptics.success();
      setNotice(`Passkey added. You can now sign in with ${name}.`);
      onChanged?.();
    } catch (cause) {
      haptics.error();
      // A cancelled prompt is not an error worth shouting about — the user
      // changed their mind, which is a normal thing to do.
      const name = (cause as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "AbortError") {
        setError(null);
      } else if (name === "InvalidStateError") {
        setError("This device already has a passkey for this account.");
      } else {
        setError(cause instanceof ApiError ? cause.message : "That passkey could not be added.");
      }
    } finally {
      setBusy(false);
    }
  }, [onChanged]);

  const remove = useCallback(
    async (id: string, name: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await api.revokePasskey(id);
        setPasskeys((current) => (current ?? []).filter((key) => key.id !== id));
        haptics.success();
        setNotice(`${name} removed.`);
        onChanged?.();
      } catch (cause) {
        haptics.error();
        setError(cause instanceof ApiError ? cause.message : "That passkey could not be removed.");
      } finally {
        setBusy(false);
      }
    },
    [onChanged]
  );

  if (supported === false) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-4">
        <div className="flex items-start gap-3">
          <Icon icon={icons.status.info} size="md" className="mt-0.5 shrink-0 text-ink-muted" />
          <div>
            <div className="text-sm font-medium text-ink">Passkeys unavailable in this browser</div>
            <p className="mt-1 text-sm text-ink-secondary">
              Passkeys need a secure connection (HTTPS or localhost) and a browser that
              supports WebAuthn. Everything else on this page still works.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">Passkeys</div>
          <p className="mt-0.5 text-sm text-ink-secondary">
            Sign in with your fingerprint, face or device PIN. Nothing to remember and
            nothing to phish — a passkey only works on this site.
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
            passkeys && passkeys.length > 0
              ? "bg-success-muted text-success-ink"
              : "bg-warning-muted text-warning-ink"
          )}
        >
          <Icon
            icon={passkeys && passkeys.length > 0 ? icons.status.success : icons.status.warning}
            size="sm"
          />
          {passkeys && passkeys.length > 0 ? "Active" : "Not set up"}
        </span>
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger-ink">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mt-3 rounded-lg bg-success-muted px-3 py-2 text-sm text-success-ink">
          {notice}
        </div>
      )}

      {passkeys && passkeys.length > 0 && (
        <ul className="mt-3 space-y-2">
          {passkeys.map((key) => (
            <li
              key={key.id}
              className="flex items-center gap-3 rounded-lg border border-border-muted p-3"
            >
              <Icon icon={icons.security.passkey} size="md" className="shrink-0 text-ink-secondary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{key.name}</div>
                <div className="text-xs text-ink-muted">
                  Added {new Date(key.createdAt).toLocaleDateString()}
                  {" · "}
                  {key.lastUsedAt
                    ? `Last used ${new Date(key.lastUsedAt).toLocaleString()}`
                    : "Never used"}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(key.id, key.name)}
                className="min-h-11 shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || supported === null}
          onClick={() => void add()}
          className="min-h-11 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-ink transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {busy ? "Waiting for your device…" : "Add passkey"}
        </button>
        {platformAvailable === false && supported && (
          <span className="text-xs text-ink-muted">
            No built-in authenticator detected — a security key will still work.
          </span>
        )}
      </div>

      {passkeys && passkeys.length === 1 && (
        <p className="mt-2 text-xs text-ink-muted">
          This is your only passkey. If it lives on one device and that device is lost,
          you will need your password to sign in.
        </p>
      )}
    </div>
  );
}

/**
 * A name the user will recognise in a list later.
 *
 * Derived from the user agent, which is a hint rather than a fact — so it is
 * only ever a default, and the value is stored as plain text the user can
 * recognise, not as anything the server trusts.
 */
function defaultPasskeyName(): string {
  if (typeof navigator === "undefined") return "Passkey";
  const ua = navigator.userAgent;
  const os =
    /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : null;

  if (os === "Windows") return "Windows Hello";
  if (os === "macOS" || os === "iOS") return "iCloud Keychain";
  if (os === "Android") return "Android";
  return os ? `${os} passkey` : "Passkey";
}
