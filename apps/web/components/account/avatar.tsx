"use client";

import { cn } from "@mailserver/ui";
import { initialsOf } from "@/lib/format";

/**
 * User avatar with an initials fallback.
 *
 * There is no image upload yet, so `src` is always absent today — but the
 * prop exists because the fallback logic is the part that needs to be right
 * first. The colour is derived from the identity rather than stored, which
 * means two people never share a swatch by accident and nothing has to be
 * migrated when uploads arrive.
 */

const SIZES = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
  lg: "h-14 w-14 text-lg",
} as const;

/**
 * Twelve hues at fixed lightness and chroma, matching the label palette in
 * `theme.css`. OKLCH is what makes that work: no swatch reads louder than
 * another, so an avatar never fights the message list for attention.
 */
function hueFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  return hash;
}

export function Avatar({
  name,
  email,
  src,
  size = "md",
  className,
}: {
  name: string;
  email: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  // Seeded on the address, not the display name: a rename should not change
  // the colour someone has learned to recognise.
  const hue = hueFor(email || name);

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", SIZES[size], className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
        SIZES[size],
        className
      )}
      style={{
        backgroundColor: `oklch(0.88 0.06 ${hue})`,
        color: `oklch(0.38 0.10 ${hue})`,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
