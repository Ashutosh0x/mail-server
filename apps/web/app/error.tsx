"use client";

/**
 * What a mail client owes the user when the server is unreachable: the truth.
 * Not a cached inbox, not an empty state that reads like "no new mail".
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-3 bg-canvas p-8 text-center">
      <h1 className="text-xl font-semibold text-ink">Mail is unavailable</h1>
      <p className="max-w-md text-sm text-ink-secondary">{error.message}</p>
      <p className="max-w-md text-sm text-ink-muted">
        Your messages are on the server and have not been lost. Nothing is shown here because nothing
        could be fetched — this screen never displays cached or placeholder mail.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-ink hover:bg-primary-hover"
      >
        Try again
      </button>
    </main>
  );
}
