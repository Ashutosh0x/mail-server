"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cn, duration, easing, haptics, Icon, icons } from "@mailserver/ui";
import { useMotion } from "@/lib/motion-preference";

/**
 * Toasts, including undo.
 *
 * The undo contract is the important part: the countdown bar is not decoration,
 * it is the remaining window in which `onUndo` can still be called. When it
 * reaches zero the toast leaves and the offer is genuinely gone. An undo button
 * that animates but no longer reverses anything is a lie told with CSS.
 *
 * `role="status"` with `aria-live="polite"` announces without stealing focus —
 * a toast that grabs focus interrupts whatever the user was typing.
 */

export type ToastTone = "success" | "info" | "warning" | "error";

export interface ToastOptions {
  tone?: ToastTone;
  /** Milliseconds. Undo toasts default longer, since a decision is required. */
  ttl?: number;
  /** Presence of this turns the toast into an undo offer. */
  onUndo?: () => void | Promise<void>;
}

interface Toast extends Required<Pick<ToastOptions, "tone">> {
  id: number;
  message: string;
  ttl: number;
  onUndo?: () => void | Promise<void>;
  createdAt: number;
}

interface ToastApi {
  show: (message: string, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const Context = createContext<ToastApi | null>(null);

const TONE_ICON = {
  success: icons.status.success,
  info: icons.status.info,
  warning: icons.status.warning,
  error: icons.status.error,
} as const;

const TONE_CLASS = {
  success: "text-success",
  info: "text-primary",
  warning: "text-warning",
  error: "text-danger",
} as const;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    const id = nextId.current++;
    const tone = options.tone ?? "info";
    setToasts((current) => [
      // Newest first, and capped: a stack taller than three hides the app
      // behind its own notifications.
      {
        id,
        message,
        tone,
        ttl: options.ttl ?? (options.onUndo ? 8000 : 4000),
        onUndo: options.onUndo,
        createdAt: Date.now(),
      },
      ...current.slice(0, 2),
    ]);
    if (tone === "error") haptics.error();
    else if (tone === "success") haptics.success();
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <Context.Provider value={api}>
      {children}
      <div
        // Above the list, clear of the composer dock at the bottom-right, and
        // never over the primary action.
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
        role="status"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </Context.Provider>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { reduced, ms } = useMotion();
  const [leaving, setLeaving] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [remaining, setRemaining] = useState(1);

  const close = useCallback(() => {
    setLeaving(true);
    window.setTimeout(onDismiss, ms(duration.fast));
  }, [onDismiss, ms]);

  // One rAF loop drives the countdown bar, so the visible progress and the
  // real expiry cannot drift apart.
  useEffect(() => {
    if (undoing) return undefined;
    let frame = 0;
    const tick = () => {
      const elapsed = Date.now() - toast.createdAt;
      const left = Math.max(0, 1 - elapsed / toast.ttl);
      setRemaining(left);
      if (left <= 0) close();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [toast.createdAt, toast.ttl, close, undoing]);

  const handleUndo = useCallback(async () => {
    if (!toast.onUndo) return;
    setUndoing(true);
    try {
      await toast.onUndo();
      close();
    } catch {
      // The reversal failed, so the toast must not claim it succeeded.
      setUndoing(false);
    }
  }, [toast, close]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full max-w-md items-center gap-3 overflow-hidden rounded-xl border border-border bg-surface-raised px-3.5 py-2.5 shadow-lg",
        "relative"
      )}
      style={{
        opacity: leaving ? 0 : 1,
        transform: leaving ? "translateY(8px) scale(0.98)" : "translateY(0) scale(1)",
        transition: reduced
          ? "none"
          : `opacity ${duration.fast}ms ${leaving ? easing.exit : easing.enter}, transform ${duration.fast}ms ${leaving ? easing.exit : easing.enter}`,
      }}
    >
      <Icon
        icon={undoing ? icons.status.loading : TONE_ICON[toast.tone]}
        size="md"
        className={cn("shrink-0", TONE_CLASS[toast.tone], undoing && "animate-spin")}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{toast.message}</span>

      {toast.onUndo && (
        <button
          type="button"
          disabled={undoing}
          onClick={() => void handleUndo()}
          className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-muted disabled:opacity-60"
        >
          {undoing ? "Undoing…" : "Undo"}
        </button>
      )}

      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="shrink-0 rounded-md p-1 text-ink-muted hover:bg-surface-sunken hover:text-ink"
      >
        <Icon icon={icons.chrome.close} size="sm" />
      </button>

      {/* The window in which Undo still works. Hidden under reduced motion,
          where a continuously moving bar is exactly what was opted out of —
          the toast still expires on the same schedule. */}
      {toast.onUndo && !reduced && !undoing && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary/40"
          style={{ transform: `scaleX(${remaining})` }}
        />
      )}
    </div>
  );
}

/** Falls back to a no-op outside a provider rather than throwing. */
export function useToast(): ToastApi {
  return useContext(Context) ?? { show: () => 0, dismiss: () => {} };
}
