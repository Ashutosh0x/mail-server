const isDev = process.env.NODE_ENV !== "production";

/**
 * React's development build uses `eval()` to reconstruct callstacks across the
 * server/client boundary, so a dev CSP without `'unsafe-eval'` breaks the app
 * with a console error. It is added in DEVELOPMENT ONLY — the production bundle
 * never calls eval, and permitting it there would hand any injected string a
 * way to become code.
 */
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The workspace packages ship TypeScript source rather than a build step.
  transpilePackages: ["@mailserver/ui", "@mailserver/types"],
  // Next 16 writes AGENTS.md/CLAUDE.md into the app on every dev start; this
  // repo keeps its guidance in docs/, so the generated copies are noise.
  agentRules: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Section D: the webmail renders untrusted HTML. The email itself is
          // isolated in a sandboxed iframe with its own srcdoc CSP; this is the
          // outer shell's policy.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
    ];
  },
};
export default nextConfig;
