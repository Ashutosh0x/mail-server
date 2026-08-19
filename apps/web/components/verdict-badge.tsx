import type { AuthenticationSummary, SecurityVerdict } from "@mailserver/types";
import { Icon, cn, icons } from "@mailserver/ui";

/**
 * The authentication verdict, as an icon-plus-text badge.
 *
 * Never colour alone (WCAG 1.4.1): each verdict has a distinct glyph and an
 * accessible name, so it survives greyscale, colour blindness and a screen
 * reader. That matters more here than anywhere else in the app — this badge is
 * the difference between a message from a bank and a message pretending to be.
 */
const VERDICTS: Record<
  SecurityVerdict,
  { icon: typeof icons.security.verified; label: string; tone: string }
> = {
  verified: { icon: icons.security.verified, label: "Authenticated sender", tone: "text-success-ink bg-success-muted" },
  unverified: { icon: icons.security.unconfigured, label: "Sender publishes no authentication policy", tone: "text-ink-muted bg-surface-sunken" },
  suspicious: { icon: icons.security.partial, label: "Authentication incomplete", tone: "text-warning-ink bg-warning-muted" },
  dangerous: { icon: icons.security.spoofed, label: "Failed authentication — possible spoofing", tone: "text-danger-ink bg-danger-muted" },
};

export function VerdictBadge({ verdict, compact = false }: { verdict: SecurityVerdict; compact?: boolean }) {
  const spec = VERDICTS[verdict];

  // A green "all fine" badge on every ordinary message is noise that trains
  // people to ignore the row. In the list, only the exceptions are shown.
  if (compact && verdict === "verified") return null;

  if (compact) {
    return <Icon icon={spec.icon} size="sm" className={cn("text-current", spec.tone.split(" ")[0])} label={spec.label} />;
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", spec.tone)}>
      <Icon icon={spec.icon} size="xs" />
      {spec.label}
    </span>
  );
}

const RESULT_TONE: Record<string, string> = {
  pass: "text-success-ink bg-success-muted",
  fail: "text-danger-ink bg-danger-muted",
  softfail: "text-warning-ink bg-warning-muted",
  neutral: "text-ink-muted bg-surface-sunken",
  none: "text-ink-muted bg-surface-sunken",
  temperror: "text-warning-ink bg-warning-muted",
  permerror: "text-danger-ink bg-danger-muted",
};

/** Per-mechanism chips (SPF / DKIM / DMARC / TLS) for the open message. */
export function AuthenticationChips({ auth }: { auth: AuthenticationSummary }) {
  const mechanisms: [string, string][] = [
    ["SPF", auth.spf],
    ["DKIM", auth.dkim],
    ["DMARC", auth.dmarc],
    ...(auth.arc ? ([["ARC", auth.arc]] as [string, string][]) : []),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {mechanisms.map(([name, result]) => (
        <span
          key={name}
          className={cn("rounded px-1.5 py-0.5 text-xs font-medium", RESULT_TONE[result] ?? RESULT_TONE.neutral)}
          title={`${name}: ${result}`}
        >
          {name} {result}
        </span>
      ))}
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
          auth.tls ? RESULT_TONE.pass : RESULT_TONE.fail
        )}
      >
        <Icon icon={auth.tls ? icons.security.tls : icons.security.plaintext} size="xs" />
        {auth.tls ?? "no TLS"}
      </span>
    </div>
  );
}

/**
 * The full-width warning above a message body.
 *
 * Says which check failed and what it means, rather than "this may be spam".
 * A warning a user cannot act on is a warning they learn to dismiss.
 */
export function PhishingBanner({ auth, verdict }: { auth: AuthenticationSummary; verdict: SecurityVerdict }) {
  if (verdict === "verified" || verdict === "unverified") return null;

  const reasons: string[] = [];
  if (auth.spf === "fail") reasons.push("SPF failed — the sending server is not authorised for this domain.");
  if (auth.dkim === "fail") reasons.push("DKIM signature is invalid — the message may have been altered in transit.");
  if (auth.dmarc === "fail") reasons.push("DMARC failed — the domain's own policy rejects this message.");
  if (auth.displayNameSpoof) reasons.push("The display name resembles a known contact, but the domain does not match.");
  if (auth.idnHomograph) reasons.push("The sender domain mixes scripts in a way that imitates another domain.");
  if (!auth.tls) reasons.push("The message arrived without transport encryption.");

  const dangerous = verdict === "dangerous";

  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border p-3",
        dangerous ? "border-danger bg-danger-muted" : "border-warning bg-warning-muted"
      )}
    >
      <p className={cn("flex items-center gap-2 text-sm font-semibold", dangerous ? "text-danger-ink" : "text-warning-ink")}>
        <Icon icon={dangerous ? icons.security.spoofed : icons.security.partial} size="sm" />
        {dangerous
          ? "This message may not be from who it claims to be"
          : "This message could not be fully authenticated"}
      </p>
      <ul className={cn("mt-2 list-disc space-y-1 pl-8 text-sm", dangerous ? "text-danger-ink" : "text-warning-ink")}>
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      {dangerous && (
        <p className="mt-2 pl-8 text-sm font-medium text-danger-ink">
          Do not click links or open attachments unless you are certain of the sender.
        </p>
      )}
    </div>
  );
}
