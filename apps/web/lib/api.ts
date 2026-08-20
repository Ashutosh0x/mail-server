import type { EmailHeader, Label, Mailbox, Thread } from "@mailserver/types";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/browser";
import type { DiscoveryResult } from "./storage-types";
import type {
  CleanupAction,
  CleanupReport,
  Orphans,
} from "./cleanup-types";
import type {
  AccountOverview,
  AccountProfile,
  AuditEntry,
  PasskeyRecord,
  Preferences,
  SecurityPosture,
  SessionRecord,
  StorageUsage,
} from "./account-types";

/**
 * Browser-side API client.
 *
 * Every screen reads through this. There is no fixture module and no fallback
 * path: when a request fails the caller gets an error to render, never a
 * plausible-looking inbox. A mail client that invents messages while
 * disconnected is worse than one that admits it is disconnected, because people
 * act on what they read.
 */

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "network", "Cannot reach the server. Check your connection.");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? "unknown",
      body?.error?.message ?? "The request failed."
    );
  }
  return (await response.json()) as T;
}

export interface SessionInfo {
  id: string;
  email: string;
  displayName: string;
  role: string;
  quotaBytes: number;
  usedBytes: number;
}

export const api = {
  session: () => request<{ user: SessionInfo | null }>("/api/auth/session"),

  register: (input: { email: string; password: string; displayName: string }) =>
    request<{ user: { id: string } }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  login: (input: { email: string; password: string }) =>
    request<{ user: { id: string } }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  /** Mirrors `publicConfig()` exactly. Drift here means the UI enforces a
   *  different limit from the server, which surfaces as a rejected send. */
  config: () =>
    request<{
      maxAttachmentBytes: number;
      maxMessageBytes: number;
      maxOutboundMessageBytes: number;
      maxUserStorageBytes: number;
      uploadChunkBytes: number;
      maxRecipients: number;
      maxPageSize: number;
      defaultPageSize: number;
      outboundConfigured: boolean;
    }>("/api/config"),

  mailboxes: () => request<{ mailboxes: Mailbox[] }>("/api/mailboxes"),

  labels: () => request<{ labels: Label[] }>("/api/labels"),

  /**
   * One conversation, with every message in it.
   *
   * The list already carries the newest message, so this is fetched only when
   * a conversation is opened — the list must not pay for bodies nobody reads.
   */
  thread: (threadId: string) =>
    request<{ thread: Thread; emails: EmailHeader[] }>(
      `/api/mail/${encodeURIComponent(threadId)}`
    ),

  threads: (params: { mailboxId?: string; q?: string; cursor?: string | null; limit?: number }) => {
    const query = new URLSearchParams();
    if (params.mailboxId) query.set("mailboxId", params.mailboxId);
    if (params.q) query.set("q", params.q);
    if (params.cursor) query.set("cursor", params.cursor);
    if (params.limit) query.set("limit", String(params.limit));
    return request<{ items: Thread[]; nextCursor: string | null; total: number }>(
      `/api/mail?${query.toString()}`
    );
  },

  act: (action: string, messageIds: string[]) =>
    request<{ changed: number; requested: number }>("/api/mail/actions", {
      method: "POST",
      body: JSON.stringify({ action, messageIds }),
    }),

  /**
   * Upload one file, reporting progress.
   *
   * XMLHttpRequest rather than fetch: fetch still has no upload-progress event,
   * and an attachment picker with no progress bar is unusable for the large
   * files this system is built to accept.
   */
  upload: (
    file: File,
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal
  ): Promise<{ attachment: { id: string; filename: string; size: number; contentType: string; typeMismatch: boolean } }> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/attachments/upload");
      xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
      if (file.type) xhr.setRequestHeader("Content-Type", file.type);
      xhr.withCredentials = true;

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
      };
      xhr.onload = () => {
        const parsed = (() => {
          try {
            return JSON.parse(xhr.responseText);
          } catch {
            return null;
          }
        })();
        if (xhr.status >= 200 && xhr.status < 300) resolve(parsed);
        else
          reject(
            new ApiError(xhr.status, parsed?.error?.code ?? "upload_failed", parsed?.error?.message ?? "Upload failed.")
          );
      };
      xhr.onerror = () => reject(new ApiError(0, "network", "The upload could not reach the server."));
      xhr.onabort = () => reject(new ApiError(0, "aborted", "Upload cancelled."));
      signal?.addEventListener("abort", () => xhr.abort());
      xhr.send(file);
    }),

  // ── Account center ───────────────────────────────────────────────────────

  /** Identity, security posture and storage in one request — the menu needs all three at once. */
  account: () => request<AccountOverview>("/api/account"),

  updateProfile: (patch: { displayName?: string; timezone?: string; language?: string }) =>
    request<{ profile: AccountProfile }>("/api/account/profile", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  security: () =>
    request<{ posture: SecurityPosture; sessions: SessionRecord[]; activity: AuditEntry[] }>(
      "/api/account/security"
    ),

  sessions: () => request<{ sessions: SessionRecord[] }>("/api/account/sessions"),

  revokeSession: (id: string) =>
    request<{ revoked: number }>(`/api/account/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  revokeOtherSessions: () =>
    request<{ revoked: number }>("/api/account/sessions/revoke-all", { method: "POST" }),

  storage: () =>
    request<{ storage: StorageUsage; unavailable: { cleanupTools: string } }>("/api/account/storage"),

  /** What is taking up space. Read-only, so it is safe to re-poll after a delete. */
  cleanupReport: (olderThanDays?: number) =>
    request<{ report: CleanupReport; orphans: Orphans; storage: StorageUsage }>(
      `/api/account/storage/cleanup${olderThanDays ? `?olderThanDays=${olderThanDays}` : ""}`
    ),

  /**
   * Delete, permanently. Returns what was ACTUALLY removed plus fresh totals —
   * `failures` is never empty on a partial failure, and the caller must show it
   * rather than reporting a clean success.
   */
  runCleanup: (action: CleanupAction, ids?: string[]) =>
    request<{
      action: CleanupAction;
      deleted: number;
      freedBytes: number;
      failures: { id: string; reason: string }[];
      storage: StorageUsage;
    }>("/api/account/storage/cleanup", {
      method: "POST",
      body: JSON.stringify({ action, ids }),
    }),

  /**
   * Storage the SERVER can see. Discovery is server-side by necessity — a
   * browser cannot enumerate the host's mounts or the local network.
   */
  discoverStorage: () => request<DiscoveryResult>("/api/storage/discover"),

  preferences: () => request<{ preferences: Preferences }>("/api/account/preferences"),

  updatePreferences: (patch: DeepPartial<Preferences>) =>
    request<{ preferences: Preferences }>("/api/account/preferences", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  // ── Compose ──────────────────────────────────────────────────────────────

  /** Suggestions from the caller's own sent mail. No contact store exists. */
  recipientSuggestions: (query: string) =>
    request<{ recipients: { name: string | null; email: string; count: number; lastUsedAt: string }[] }>(
      `/api/recipients?q=${encodeURIComponent(query)}`
    ),

  /**
   * Start a draft. With `reply`, the server builds it from the stored message —
   * recipients, subject, quote and threading headers all come from the row, not
   * from here.
   */
  createDraft: (reply?: { mode: "reply" | "replyAll" | "forward"; sourceId: string }) =>
    request<{ draftId: string; senders: { name?: string | null; email: string }[] }>(
      "/api/drafts",
      { method: "POST", ...(reply ? { body: JSON.stringify(reply) } : {}) }
    ),

  saveDraft: (
    id: string,
    draft: {
      to: { name?: string | null; email: string }[];
      cc?: { name?: string | null; email: string }[];
      bcc?: { name?: string | null; email: string }[];
      subject: string;
      bodyHtml: string;
      attachmentIds?: string[];
      /** The version last read. Omit to force-save, which skips the check. */
      version?: number;
    }
  ) =>
    request<{ version: number; savedAt: string }>(`/api/drafts/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(draft),
    }),

  loadDraft: (id: string) =>
    request<{
      draft: {
        id: string;
        to: { name?: string | null; email: string }[];
        cc?: { name?: string | null; email: string }[];
        bcc?: { name?: string | null; email: string }[];
        subject: string;
        bodyHtml: string;
        attachments: { id: string; filename: string; size: number; contentType: string }[];
        version: number;
        updatedAt: string;
      };
      senders: { name?: string | null; email: string }[];
    }>(`/api/drafts/${encodeURIComponent(id)}`),

  deleteDraft: (id: string) =>
    request<{ deleted: true }>(`/api/drafts/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /**
   * Send. The idempotency key makes a double-click or a retried request
   * return the original result rather than sending twice.
   */
  sendDraft: (id: string, idempotencyKey: string, from?: string) =>
    request<{
      messageId: string;
      queueId: string;
      status: string;
      rfcMessageId: string;
      delivery: { status: string; detail: string };
      transportConfigured: boolean;
    }>(`/api/drafts/${encodeURIComponent(id)}/send`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from }),
    }),

  outboundStatus: (queueId: string) =>
    request<{
      queue: { id: string; status: string; attempts: number; lastError: string | null };
      transportConfigured: boolean;
    }>(`/api/outbound/${encodeURIComponent(queueId)}`),

  passkeys: () => request<{ passkeys: PasskeyRecord[] }>("/api/account/passkeys"),

  /** Server-issued registration options. Consumed by startRegistration(). */
  passkeyRegisterChallenge: () =>
    request<{ options: PublicKeyCredentialCreationOptionsJSON }>(
      "/api/account/passkeys/challenge",
      { method: "POST" }
    ),

  passkeyRegister: (response: RegistrationResponseJSON, name: string) =>
    request<{ passkeys: PasskeyRecord[] }>("/api/account/passkeys", {
      method: "POST",
      body: JSON.stringify({ response, name }),
    }),

  /** `email` is optional — omitting it uses a discoverable credential. */
  passkeyLoginChallenge: (email?: string) =>
    request<{ options: PublicKeyCredentialRequestOptionsJSON }>("/api/auth/passkey/challenge", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  passkeyLogin: (response: AuthenticationResponseJSON) =>
    request<{ user: { id: string } }>("/api/auth/passkey", {
      method: "POST",
      body: JSON.stringify(response),
    }),

  revokePasskey: (id: string) =>
    request<{ revoked: number }>(`/api/account/passkeys/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};

/** One section of preferences at a time, without restating every field. */
type DeepPartial<T> = { [K in keyof T]?: Partial<T[K]> };
