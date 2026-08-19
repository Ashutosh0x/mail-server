/**
 * The connector contract.
 *
 * Every external storage provider is reached through one interface, and every
 * connector must pass one shared test suite. The suite is capability-aware:
 * a provider that genuinely cannot rename is not required to implement rename,
 * but it also may not silently no-op it.
 *
 * The distinction this file encodes:
 *
 *   REQUIRED    every connector must implement it, regardless of provider
 *   CAPABILITY  required only if the descriptor declares the capability
 *
 * Nothing here implements a provider. There is no connector in this repository
 * yet — `availableProviders()` returns `[]` and a test asserts it. This is the
 * shape the first one (S3, per ADR-0004) will be built to.
 */

import type { Capability, ProviderDescriptor, ProviderGrant, StorageItem } from "./storage";
import { hasCapability } from "./storage";

// ── Operations ─────────────────────────────────────────────────────────────

/**
 * Every operation the contract suite knows about.
 *
 * Lifecycle and failure-handling operations come first because they are the
 * ones most often skipped when a connector is written in a hurry, and they are
 * the ones that decide whether a connection degrades honestly or lies.
 */
export type ConnectorOperation =
  // Lifecycle — required of every connector.
  | "connect"
  | "authenticate"
  | "validateConnection"
  | "reconnect"
  | "disconnect"
  // Reading — required of every connector.
  | "list"
  | "metadata"
  | "download"
  // Failure behaviour — required of every connector.
  | "rateLimit"
  | "providerFailure"
  | "permissionDenied"
  | "expiredCredentials"
  // Capability-gated.
  | "search"
  | "upload"
  | "rename"
  | "move"
  | "delete"
  | "createFolder"
  | "share";

/**
 * Operations no connector may skip.
 *
 * `read` is not in the capability gate list for `list`/`metadata`/`download`
 * on purpose: a storage connector that cannot read is not a storage connector.
 * The failure-behaviour four are required because a connector that has never
 * been tested against a 429 or an expired token will discover both in
 * production, on a customer's account.
 */
export const REQUIRED_OPERATIONS: readonly ConnectorOperation[] = [
  "connect",
  "authenticate",
  "validateConnection",
  "reconnect",
  "disconnect",
  "list",
  "metadata",
  "download",
  "rateLimit",
  "providerFailure",
  "permissionDenied",
  "expiredCredentials",
] as const;

/**
 * Operations required only when the descriptor declares the capability.
 *
 * A provider legitimately lacking one is SKIPPED and recorded as skipped —
 * never counted as passing. "Skipped" and "passed" being the same colour in a
 * report is how a connector ships with half its operations unimplemented.
 */
export const CAPABILITY_GATED_OPERATIONS: Readonly<Record<string, Capability>> = {
  search: "search",
  upload: "write",
  rename: "rename",
  move: "move",
  delete: "delete",
  createFolder: "folders",
  share: "sharing",
} as const;

/**
 * Which operations this provider's connector must pass.
 *
 * Drives the contract suite: everything required, plus the capability-gated
 * operations the descriptor actually claims.
 */
export function applicableOperations(descriptor: ProviderDescriptor): ConnectorOperation[] {
  const gated = (Object.entries(CAPABILITY_GATED_OPERATIONS) as [ConnectorOperation, Capability][])
    .filter(([, capability]) => hasCapability(descriptor, capability))
    .map(([operation]) => operation);
  return [...REQUIRED_OPERATIONS, ...gated];
}

/** Operations skipped for this provider, with the capability that would enable each. */
export function skippedOperations(descriptor: ProviderDescriptor): { operation: ConnectorOperation; missing: Capability }[] {
  return (Object.entries(CAPABILITY_GATED_OPERATIONS) as [ConnectorOperation, Capability][])
    .filter(([, capability]) => !hasCapability(descriptor, capability))
    .map(([operation, capability]) => ({ operation, missing: capability }));
}

// ── Results ────────────────────────────────────────────────────────────────

/**
 * There is deliberately no status meaning "not implemented but probably fine".
 * A connector is passing, skipped for a declared reason, or failing.
 */
export type ContractStatus = "passed" | "skipped" | "failed";

export interface ContractResult {
  operation: ConnectorOperation;
  status: ContractStatus;
  /** Required for `skipped` and `failed`. A skip without a reason is a gap. */
  reason?: string;
}

/**
 * Whether a provider may be promoted from `planned` to `available`.
 *
 * This is the machine-checkable part of the eight-point gate in ADR-0004.
 * It is intentionally strict: an operation with no result at all counts as
 * missing, because silence is the most common way a gap reaches production.
 */
export function meetsContract(
  descriptor: ProviderDescriptor,
  results: readonly ContractResult[]
): { ready: boolean; missing: ConnectorOperation[]; failed: ConnectorOperation[] } {
  const required = applicableOperations(descriptor);
  const byOperation = new Map(results.map((result) => [result.operation, result]));

  const missing: ConnectorOperation[] = [];
  const failed: ConnectorOperation[] = [];

  for (const operation of required) {
    const result = byOperation.get(operation);
    if (!result) {
      missing.push(operation);
      continue;
    }
    if (result.status === "failed") failed.push(operation);
    // A required operation cannot be skipped — `applicableOperations` only
    // returns operations this provider has claimed it supports.
    if (result.status === "skipped") missing.push(operation);
  }

  return { ready: missing.length === 0 && failed.length === 0, missing, failed };
}

// ── The interface a connector implements ───────────────────────────────────

export interface ListPage {
  items: StorageItem[];
  /** Opaque continuation token. Null when the listing is complete. */
  cursor: string | null;
}

/**
 * What a connector implements.
 *
 * Capability-gated methods are optional in the type. A connector that declares
 * the capability but omits the method fails `meetsContract` rather than
 * throwing at the call site in front of a user.
 */
export interface StorageConnector {
  readonly descriptor: ProviderDescriptor;

  /** Prove the stored credential still works. Called before trusting a mount. */
  validateConnection(): Promise<{ ok: boolean; detail?: string }>;

  /** Refresh credentials. Distinct from connect: no user interaction. */
  reconnect(): Promise<void>;

  /** Release provider-side resources; revoke tokens where the provider allows. */
  disconnect(): Promise<void>;

  list(parentExternalId: string | null, cursor?: string): Promise<ListPage>;

  metadata(externalId: string): Promise<StorageItem>;

  /** Streamed, never buffered whole — files here can be gigabytes. */
  download(externalId: string): Promise<ReadableStream<Uint8Array>>;

  /**
   * What the provider says this identity may do. Fed to `effectiveAccess` as
   * the third and final layer; a connector must never widen it.
   */
  grantFor(externalId: string): Promise<ProviderGrant>;

  search?(query: string, cursor?: string): Promise<ListPage>;
  upload?(parentExternalId: string | null, name: string, body: ReadableStream<Uint8Array>): Promise<StorageItem>;
  rename?(externalId: string, name: string): Promise<StorageItem>;
  move?(externalId: string, newParentExternalId: string): Promise<StorageItem>;
  delete?(externalId: string): Promise<void>;
  createFolder?(parentExternalId: string | null, name: string): Promise<StorageItem>;
  share?(externalId: string, options: { public: boolean }): Promise<{ url: string }>;
}
