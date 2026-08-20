import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mail Server",
  description: "Self-hosted email that behaves like a product, not a server.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfc" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` on <html> and <body> only.
    //
    // Browser extensions inject attributes into these two elements before React
    // hydrates — ColorZilla adds `cz-shortcut-listen`, password managers and
    // dark-mode extensions add their own. The server cannot know about them, so
    // React reports a mismatch for markup we never wrote and cannot control.
    //
    // The suppression is deliberately narrow: it covers the element's own
    // attributes and text, NOT its children, so a genuine hydration mismatch
    // anywhere inside the app is still reported. Applying it any wider would
    // hide real bugs.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
