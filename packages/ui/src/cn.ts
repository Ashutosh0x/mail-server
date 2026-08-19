import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names, letting later Tailwind utilities win over earlier ones.
 *
 * `clsx` alone would emit `px-2 px-4` and leave the winner to CSS source order,
 * which is not the order the props were written in — so a component's own
 * padding could silently beat the caller's override. `twMerge` resolves the
 * conflict by utility group instead.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
