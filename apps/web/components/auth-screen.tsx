"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon, icons } from "@mailserver/ui";
import { startAuthentication } from "@simplewebauthn/browser";
import { api, ApiError } from "@/lib/api";

/**
 * Sign in / create account.
 *
 * The password rule is stated up front rather than after a rejected submit —
 * telling someone their password is wrong only once they have chosen it is how
 * you get "Password1!" on the second attempt.
 */
export function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // WebAuthn needs a secure context, so on plain HTTP over anything but
  // localhost the API is simply absent. Detected rather than assumed, so the
  // button never appears where it could only fail.
  const [passkeysSupported, setPasskeysSupported] = useState(false);
  useEffect(() => {
    setPasskeysSupported(
      typeof window.PublicKeyCredential !== "undefined" && window.isSecureContext
    );
  }, []);

  const signInWithPasskey = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { options } = await api.passkeyLoginChallenge(email || undefined);
      const assertion = await startAuthentication({ optionsJSON: options });
      await api.passkeyLogin(assertion);
      onAuthenticated();
    } catch (err) {
      const name = (err as { name?: string })?.name;
      // Cancelling a prompt is a decision, not a failure to report.
      if (name === "NotAllowedError" || name === "AbortError") setError(null);
      else if (err instanceof ApiError) setError(err.message);
      else setError("No passkey was available for this site on this device.");
    } finally {
      setBusy(false);
    }
  }, [email, onAuthenticated]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") await api.register({ email, password, displayName });
      else await api.login({ email, password });
      await offerToSaveCredential(email, password);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <Icon icon={icons.mailbox.inbox} size="lg" className="text-primary" />
          <span className="text-xl font-semibold tracking-tight text-ink">Mail Server</span>
        </div>

        <h1 className="text-xl font-semibold text-ink">
          {mode === "login" ? "Sign in" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {mode === "login"
            ? "Use the address and password for this server."
            : "Your mailbox starts empty — nothing is pre-filled."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-3">
          {mode === "register" && (
            <Field label="Your name" htmlFor="name">
              <input
                id="name" name="name" required autoComplete="name" value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-primary"
              />
            </Field>
          )}

          <Field label="Email address" htmlFor="email">
            <input
              id="email" name="username" type="email" required autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-primary"
            />
          </Field>

          <Field
            label="Password"
            htmlFor="password"
            hint={mode === "register" ? "At least 12 characters." : undefined}
          >
            <input
              id="password" name="password" type="password" required minLength={mode === "register" ? 12 : undefined}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-primary"
            />
          </Field>

          {error && (
            <p role="alert" className="rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger-ink">
              {error}
            </p>
          )}

          <button
            type="submit" disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-ink hover:bg-primary-hover disabled:opacity-60"
          >
            {busy && <Icon icon={icons.status.loading} size="sm" className="animate-spin" />}
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        {mode === "login" && passkeysSupported && (
          <>
            <div className="my-4 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-ink-muted">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <button
              type="button"
              onClick={() => void signInWithPasskey()}
              disabled={busy}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken disabled:opacity-60"
            >
              <Icon icon={icons.security.passkey} size="sm" />
              Sign in with a passkey
            </button>
            <p className="mt-2 text-center text-xs text-ink-muted">
              Uses your fingerprint, face or device PIN. Leave the address blank to pick
              from the passkeys saved on this device.
            </p>
          </>
        )}

        <p className="mt-4 text-center text-sm text-ink-muted">
          {mode === "login" ? "No account on this server? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
            className="font-medium text-primary hover:underline"
          >
            {mode === "login" ? "Create one" : "Sign in"}
          </button>
        </p>
      </div>
    </main>
  );
}

function Field({ label, htmlFor, hint, children }: {
  label: string; htmlFor: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink-secondary">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/**
 * Ask the browser to remember this password.
 *
 * A single-page sign-in calls `preventDefault()` and posts with fetch, so the
 * navigation Chrome normally watches for never happens and the "Save
 * password?" prompt never appears. The Credential Management API is the
 * explicit way to ask, instead of hoping a heuristic fires.
 *
 * Progressive enhancement: Firefox and Safari do not implement
 * `PasswordCredential`, where this is a no-op and their own heuristics apply.
 * Nothing about signing in depends on it working.
 */
async function offerToSaveCredential(email: string, password: string): Promise<void> {
  try {
    const CredentialCtor = (window as unknown as {
      PasswordCredential?: new (data: { id: string; password: string }) => Credential;
    }).PasswordCredential;

    if (!CredentialCtor || !navigator.credentials?.store) return;
    await navigator.credentials.store(new CredentialCtor({ id: email, password }));
  } catch {
    // The user declining, or a browser refusing, must never fail the sign-in
    // that has already succeeded.
  }
}
