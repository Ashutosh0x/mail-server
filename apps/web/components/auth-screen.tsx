"use client";

import { useState } from "react";
import { Icon, icons } from "@mailserver/ui";
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") await api.register({ email, password, displayName });
      else await api.login({ email, password });
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
                id="name" required autoComplete="name" value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-primary"
              />
            </Field>
          )}

          <Field label="Email address" htmlFor="email">
            <input
              id="email" type="email" required autoComplete="username" value={email}
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
              id="password" type="password" required minLength={mode === "register" ? 12 : undefined}
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
