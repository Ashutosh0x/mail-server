"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon, icons } from "@mailserver/ui";
import { api, ApiError, type SessionInfo } from "@/lib/api";
import { MailClient } from "@/components/mail-client";
import { AuthScreen } from "@/components/auth-screen";
import { ToastProvider } from "@/components/interaction/toast";
import { MotionProvider } from "@/lib/motion-preference";

/**
 * Composition root.
 *
 * The session is resolved before anything mail-shaped renders, so there is no
 * moment where the UI shows a mailbox it has not confirmed belongs to someone.
 */
export default function Page() {
  const [user, setUser] = useState<SessionInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { user: session } = await api.session();
      setUser(session);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The account's own reduced-motion setting, fetched once signed in. Failure
  // is not fatal: motion stays on and the OS media query still applies.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void api
      .preferences()
      .then(({ preferences }) => {
        if (!cancelled) setReducedMotion(preferences.appearance.reducedMotion);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user]);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  }, []);

  if (checking) {
    return (
      <main className="flex h-dvh items-center justify-center bg-canvas">
        <Icon icon={icons.status.loading} size="lg" className="animate-spin text-ink-muted" />
      </main>
    );
  }

  if (error && !user) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-3 bg-canvas p-8 text-center">
        <Icon icon={icons.status.offline} size="hero" className="text-danger" />
        <h1 className="text-lg font-semibold text-ink">Cannot reach Mail Server</h1>
        <p className="max-w-md text-sm text-ink-secondary">{error}</p>
        <button
          type="button"
          onClick={() => { setChecking(true); void refresh(); }}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-ink hover:bg-primary-hover"
        >
          Try again
        </button>
      </main>
    );
  }

  if (!user) return <AuthScreen onAuthenticated={refresh} />;

  return (
    // MotionProvider outermost: the toast layer animates too, and both need
    // the same answer to "should anything move?".
    <MotionProvider appReduced={reducedMotion} onAppReducedChange={setReducedMotion}>
      <ToastProvider>
        <MailClient user={user} onSignOut={signOut} />
      </ToastProvider>
    </MotionProvider>
  );
}
