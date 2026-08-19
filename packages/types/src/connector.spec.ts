import { describe, expect, it } from "vitest";
import {
  applicableOperations,
  meetsContract,
  skippedOperations,
  CAPABILITY_GATED_OPERATIONS,
  REQUIRED_OPERATIONS,
  type ConnectorOperation,
  type ContractResult,
} from "./connector";
import { PROVIDERS } from "./providers";

/** A passing result for every operation the provider must implement. */
function allPassing(operations: readonly ConnectorOperation[]): ContractResult[] {
  return operations.map((operation) => ({ operation, status: "passed" as const }));
}

describe("applicableOperations", () => {
  it("always requires the lifecycle, read and failure-handling operations", () => {
    // Even the narrowest provider in the registry gets the full required set.
    for (const descriptor of Object.values(PROVIDERS)) {
      const operations = applicableOperations(descriptor);
      for (const required of REQUIRED_OPERATIONS) {
        expect(operations, `${descriptor.id} / ${required}`).toContain(required);
      }
    }
  });

  it("requires search only where the provider actually supports it", () => {
    // WebDAV's SEARCH method is optional under RFC 5323 and rarely present, so
    // the registry does not claim it — and the suite must not demand it.
    expect(applicableOperations(PROVIDERS.webdav)).not.toContain("search");
    expect(applicableOperations(PROVIDERS.google_drive)).toContain("search");
  });

  it("does not require rename or move from S3, which has neither operation", () => {
    const operations = applicableOperations(PROVIDERS.s3);
    expect(operations).not.toContain("rename");
    expect(operations).not.toContain("move");
    // But it can still write and delete.
    expect(operations).toContain("upload");
    expect(operations).toContain("delete");
  });

  it("names the missing capability for every skipped operation", () => {
    for (const { operation, missing } of skippedOperations(PROVIDERS.sftp)) {
      expect(CAPABILITY_GATED_OPERATIONS[operation]).toBe(missing);
    }
  });

  it("partitions every gated operation into applicable or skipped, never both", () => {
    for (const descriptor of Object.values(PROVIDERS)) {
      const applicable = new Set(applicableOperations(descriptor));
      const skipped = new Set(skippedOperations(descriptor).map((s) => s.operation));
      for (const operation of Object.keys(CAPABILITY_GATED_OPERATIONS) as ConnectorOperation[]) {
        const inOne = applicable.has(operation) !== skipped.has(operation);
        expect(inOne, `${descriptor.id} / ${operation}`).toBe(true);
      }
    }
  });
});

describe("meetsContract", () => {
  it("passes a connector that implements everything it claims", () => {
    const descriptor = PROVIDERS.s3;
    const verdict = meetsContract(descriptor, allPassing(applicableOperations(descriptor)));
    expect(verdict.ready).toBe(true);
    expect(verdict.missing).toEqual([]);
    expect(verdict.failed).toEqual([]);
  });

  it("treats an absent result as missing, not as passing", () => {
    // Silence is the most common way a gap reaches production.
    const descriptor = PROVIDERS.s3;
    const results = allPassing(applicableOperations(descriptor)).filter(
      (result) => result.operation !== "rateLimit"
    );
    const verdict = meetsContract(descriptor, results);
    expect(verdict.ready).toBe(false);
    expect(verdict.missing).toContain("rateLimit");
  });

  it("refuses to let a required operation be skipped", () => {
    const descriptor = PROVIDERS.s3;
    const results: ContractResult[] = allPassing(applicableOperations(descriptor)).map((result) =>
      result.operation === "expiredCredentials"
        ? { operation: result.operation, status: "skipped", reason: "hard to test" }
        : result
    );
    const verdict = meetsContract(descriptor, results);
    expect(verdict.ready).toBe(false);
    expect(verdict.missing).toContain("expiredCredentials");
  });

  it("reports failures separately from omissions", () => {
    const descriptor = PROVIDERS.s3;
    const results: ContractResult[] = allPassing(applicableOperations(descriptor)).map((result) =>
      result.operation === "download"
        ? { operation: result.operation, status: "failed", reason: "truncated at 2GB" }
        : result
    );
    const verdict = meetsContract(descriptor, results);
    expect(verdict.ready).toBe(false);
    expect(verdict.failed).toEqual(["download"]);
    expect(verdict.missing).toEqual([]);
  });

  it("ignores results for operations the provider never claimed", () => {
    // Reporting a rename result for S3 does not make S3 renameable, but it
    // must not break the verdict either.
    const descriptor = PROVIDERS.s3;
    const results: ContractResult[] = [
      ...allPassing(applicableOperations(descriptor)),
      { operation: "rename", status: "passed" },
    ];
    expect(meetsContract(descriptor, results).ready).toBe(true);
  });

  it("blocks promotion for a connector that does not exist at all", () => {
    // The state every external provider is in today: no results, so not ready.
    for (const descriptor of Object.values(PROVIDERS).filter((p) => p.external)) {
      const verdict = meetsContract(descriptor, []);
      expect(verdict.ready, descriptor.id).toBe(false);
      expect(verdict.missing.length, descriptor.id).toBeGreaterThan(0);
    }
  });
});
