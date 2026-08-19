"use client";

import { cn } from "@mailserver/ui";
import { useMotion } from "@/lib/motion-preference";
import { ROW_HEIGHT, type Density } from "../mail-list-item";

/**
 * Skeletons.
 *
 * A skeleton beats a spinner when the shape of what is coming is known, because
 * it reserves the layout and the content lands without shifting anything. It is
 * worse than a spinner when the shape is unknown, so these mirror real rows
 * exactly — including row height per density, so the list does not resize when
 * data arrives.
 *
 * The shimmer is a single background-position animation on the container, not
 * one per bar. Fifteen independently animating elements is fifteen composited
 * layers for something the user sees for 200ms.
 *
 * Under reduced motion the shimmer stops entirely and the bars stay flat: the
 * information ("content is loading, here is its shape") survives without any
 * movement at all.
 */

function Bar({ className }: { className?: string }) {
  return <div className={cn("rounded bg-border-muted", className)} />;
}

function Shimmer({ children, className }: { children: React.ReactNode; className?: string }) {
  const { reduced } = useMotion();
  return (
    <div
      aria-hidden="true"
      className={cn(!reduced && "animate-[shimmer_1.6s_ease-in-out_infinite]", className)}
    >
      {children}
    </div>
  );
}

export function MailListSkeleton({ density, rows = 8 }: { density: Density; rows?: number }) {
  return (
    <Shimmer>
      <div role="presentation">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 border-b border-border px-4"
            style={{ height: ROW_HEIGHT[density] }}
          >
            {density !== "compact" && <Bar className="h-8 w-8 shrink-0 rounded-full" />}
            <div className="min-w-0 flex-1 space-y-1.5">
              <Bar className="h-3 w-1/4" />
              {density !== "compact" && <Bar className="h-2.5 w-2/3" />}
            </div>
            <Bar className="h-2.5 w-10 shrink-0" />
          </div>
        ))}
      </div>
    </Shimmer>
  );
}

export function MessageSkeleton() {
  return (
    <Shimmer className="space-y-4 p-6">
      <Bar className="h-5 w-2/3" />
      <div className="flex items-center gap-3">
        <Bar className="h-9 w-9 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Bar className="h-3 w-40" />
          <Bar className="h-2.5 w-56" />
        </div>
      </div>
      <div className="space-y-2 pt-2">
        <Bar className="h-3 w-full" />
        <Bar className="h-3 w-full" />
        <Bar className="h-3 w-4/5" />
        <Bar className="h-3 w-3/5" />
      </div>
    </Shimmer>
  );
}

export function AccountSkeleton() {
  return (
    <Shimmer className="flex flex-col items-center gap-2 px-4 py-4">
      <Bar className="h-14 w-14 rounded-full" />
      <Bar className="h-3.5 w-32" />
      <Bar className="h-3 w-44" />
    </Shimmer>
  );
}

export function SettingsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Shimmer className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="rounded-xl border border-border p-4">
          <Bar className="mb-2 h-3.5 w-32" />
          <Bar className="h-2.5 w-3/4" />
        </div>
      ))}
    </Shimmer>
  );
}
