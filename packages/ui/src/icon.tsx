import type { SVGAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "./cn";

/**
 * Optical sizing.
 *
 * Stroke width goes DOWN as the icon goes up. A 2px stroke that reads correctly
 * at 16px looks clumsy at 48px, because the stroke is a fixed fraction of the
 * glyph rather than of the eye — so each step trades a little weight for size,
 * and a 14px badge and a 48px empty-state illustration end up looking like they
 * belong to the same family.
 */
const SIZES = {
  xs: { px: 14, stroke: 2.25 },
  sm: { px: 16, stroke: 2 },
  md: { px: 20, stroke: 1.8 },
  lg: { px: 24, stroke: 1.75 },
  xl: { px: 32, stroke: 1.5 },
  hero: { px: 48, stroke: 1.25 },
} as const;

export type IconSize = keyof typeof SIZES;

export interface IconProps extends Omit<SVGAttributes<SVGElement>, "ref"> {
  icon: LucideIcon;
  size?: IconSize;
  /**
   * Accessible name. Omit it and the icon is hidden from assistive tech, which
   * is the right default: most icons in this app sit beside their own label,
   * and announcing both makes a screen reader say everything twice.
   */
  label?: string;
  /** Fill the glyph — the convention for an active star, pin or bookmark. */
  filled?: boolean;
}

export function Icon({ icon: Glyph, size = "md", label, filled, className, ...rest }: IconProps) {
  const { px, stroke } = SIZES[size];
  return (
    <Glyph
      width={px}
      height={px}
      strokeWidth={stroke}
      className={cn("inline-flex shrink-0", filled && "fill-current", className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      focusable="false"
      {...rest}
    />
  );
}

export { SIZES as ICON_SIZES };
