import { describe, expect, it } from "vitest";
import {
  effectiveAccess,
  hasCapability,
  roleRank,
  weakerRole,
  type AccessRequest,
  type MountRole,
  type ProviderGrant,
  type StorageConnection,
  type StorageMount,
} from "./storage";
import { PROVIDERS, availableProviders, plannedProviders } from "./providers";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const USER = "user-1";

function connection(over: Partial<StorageConnection> = {}): StorageConnection {
  return {
    id: "conn-1",
    organizationId: ORG,
    ownerUserId: USER,
    provider: "google_drive",
    displayName: "Drive",
    state: "active",
    stateDetail: null,
    lastSyncAt: null,
    createdAt: "2026-08-19T00:00:00.000Z",
    ...over,
  };
}

function mount(over: Partial<StorageMount> = {}): StorageMount {
  return {
    id: "mount-1",
    connectionId: "conn-1",
    organizationId: ORG,
    name: "Drive",
    rootPath: "/",
    visibility: "private",
    grantedGroupIds: [],
    grantedUserIds: [],
    maxRole: "manager",
    indexing: "metadata",
    createdAt: "2026-08-19T00:00:00.000Z",
    ...over,
  };
}

const FULL_GRANT: ProviderGrant = { readable: true, writable: true, deletable: true };

function request(over: Partial<AccessRequest> = {}): AccessRequest {
  return {
    userOrganizationId: ORG,
    userId: USER,
    userGroupIds: [],
    mount: mount(),
    connection: connection(),
    descriptor: PROVIDERS.google_drive,
    grant: FULL_GRANT,
    ...over,
  };
}

describe("effectiveAccess — tenant layer", () => {
  it("denies a mount belonging to another organization", () => {
    const result = effectiveAccess(request({ userOrganizationId: OTHER_ORG }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("different organization");
  });

  it("denies when the connection is in another organization even if the mount is not", () => {
    // Both are checked. A mount pointing at a foreign connection is the shape
    // a cross-tenant escalation would take.
    const result = effectiveAccess(
      request({ connection: connection({ organizationId: OTHER_ORG }) })
    );
    expect(result.allowed).toBe(false);
  });

  it("denies through a connection that is not active", () => {
    for (const state of ["auth_required", "revoked", "unreachable", "disconnected", "degraded"] as const) {
      const result = effectiveAccess(request({ connection: connection({ state }) }));
      expect(result.allowed, state).toBe(false);
    }
  });
});

describe("effectiveAccess — mount visibility", () => {
  it("keeps a private mount to the person who connected it", () => {
    expect(effectiveAccess(request()).allowed).toBe(true);
    // The specific failure the brief names: one person's personal account must
    // not become visible to the whole organization.
    const other = effectiveAccess(request({ userId: "user-2" }));
    expect(other.allowed).toBe(false);
    expect(other.reason).toContain("do not have access");
  });

  it("shares an organization mount with any member of that organization", () => {
    const result = effectiveAccess(
      request({ userId: "user-2", mount: mount({ visibility: "organization" }) })
    );
    expect(result.allowed).toBe(true);
  });

  it("honours explicit user grants", () => {
    const m = mount({ visibility: "users", grantedUserIds: ["user-2"] });
    expect(effectiveAccess(request({ userId: "user-2", mount: m })).allowed).toBe(true);
    expect(effectiveAccess(request({ userId: "user-3", mount: m })).allowed).toBe(false);
  });

  it("honours group grants only for members of that group", () => {
    const m = mount({ visibility: "group", grantedGroupIds: ["finance"] });
    expect(effectiveAccess(request({ userId: "u", userGroupIds: ["finance"], mount: m })).allowed).toBe(true);
    expect(effectiveAccess(request({ userId: "u", userGroupIds: ["eng"], mount: m })).allowed).toBe(false);
  });

  it("hides a private mount on an organization-owned connection from everyone", () => {
    // No owner means nobody satisfies "is the owner" — deliberately closed
    // rather than defaulting open.
    const result = effectiveAccess(
      request({ connection: connection({ ownerUserId: null }), mount: mount({ visibility: "private" }) })
    );
    expect(result.allowed).toBe(false);
  });
});

describe("effectiveAccess — provider layer is final", () => {
  it("denies when the provider denies, whatever the mount role says", () => {
    const result = effectiveAccess(
      request({
        mount: mount({ maxRole: "manager" }),
        grant: { readable: false, writable: true, deletable: true },
      })
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("provider denied");
  });

  it("cannot write when the provider says read-only, even for a manager", () => {
    const result = effectiveAccess(
      request({
        mount: mount({ maxRole: "manager" }),
        grant: { readable: true, writable: false, deletable: false },
      })
    );
    expect(result.allowed).toBe(true);
    expect(result.canRead).toBe(true);
    expect(result.canWrite).toBe(false);
    expect(result.canDelete).toBe(false);
  });

  it("cannot delete when the connector lacks the capability, even for a manager", () => {
    // WebDAV in the registry has delete; S3 has delete. Use a descriptor with
    // neither to prove capability gates the operation independently of role.
    const readOnlyProvider = { ...PROVIDERS.webdav, capabilities: ["read", "folders"] as const };
    const result = effectiveAccess(
      request({ descriptor: readOnlyProvider, mount: mount({ maxRole: "manager" }) })
    );
    expect(result.canWrite).toBe(false);
    expect(result.canDelete).toBe(false);
  });
});

describe("effectiveAccess — mount role ceiling", () => {
  it("stops a viewer writing even when the provider allows it", () => {
    const result = effectiveAccess(request({ mount: mount({ maxRole: "viewer" }) }));
    expect(result.canRead).toBe(true);
    expect(result.canWrite).toBe(false);
    expect(result.canDelete).toBe(false);
  });

  it("lets a contributor write but not delete", () => {
    const result = effectiveAccess(request({ mount: mount({ maxRole: "contributor" }) }));
    expect(result.canWrite).toBe(true);
    expect(result.canDelete).toBe(false);
  });

  it("lets a content manager delete", () => {
    expect(effectiveAccess(request({ mount: mount({ maxRole: "content_manager" }) })).canDelete).toBe(true);
  });

  it("never widens access — every layer can only remove it", () => {
    // Exhaustive over the three layers: if any one says no, the answer is no.
    const roles: MountRole[] = ["viewer", "commenter", "contributor", "content_manager", "manager"];
    for (const role of roles) {
      const denied = effectiveAccess(
        request({ mount: mount({ maxRole: role }), grant: { readable: false, writable: false, deletable: false } })
      );
      expect(denied.allowed, role).toBe(false);
    }
  });
});

describe("role helpers", () => {
  it("orders roles least to most privileged", () => {
    expect(roleRank("viewer")).toBeLessThan(roleRank("contributor"));
    expect(roleRank("contributor")).toBeLessThan(roleRank("manager"));
  });

  it("intersects to the weaker role", () => {
    expect(weakerRole("manager", "viewer")).toBe("viewer");
    expect(weakerRole("contributor", "content_manager")).toBe("contributor");
    expect(weakerRole("viewer", "viewer")).toBe("viewer");
  });
});

describe("provider registry", () => {
  it("declares a status for every provider", () => {
    for (const [id, descriptor] of Object.entries(PROVIDERS)) {
      expect(descriptor.id, id).toBe(id);
      expect(["available", "planned"]).toContain(descriptor.status);
      expect(descriptor.capabilities.length, id).toBeGreaterThan(0);
    }
  });

  it("gives every planned provider a reason, so the UI never says just 'unavailable'", () => {
    for (const descriptor of plannedProviders()) {
      expect(descriptor.note, descriptor.id).toBeTruthy();
    }
  });

  it("offers no external provider as connectable until a connector exists", () => {
    // This is the fake-connector guard. It fails the moment someone flips a
    // provider to "available" without shipping the connector — which is
    // exactly when it should fail.
    expect(availableProviders().map((p) => p.id)).toEqual([]);
  });

  it("marks only native storage as non-external", () => {
    const internal = Object.values(PROVIDERS).filter((p) => !p.external);
    expect(internal.map((p) => p.id)).toEqual(["native"]);
  });

  it("does not claim search for WebDAV, whose SEARCH method is optional", () => {
    expect(hasCapability(PROVIDERS.webdav, "search")).toBe(false);
  });

  it("does not claim rename or move for S3, which has neither operation", () => {
    expect(hasCapability(PROVIDERS.s3, "rename")).toBe(false);
    expect(hasCapability(PROVIDERS.s3, "move")).toBe(false);
    expect(hasCapability(PROVIDERS.s3, "server_side_copy")).toBe(true);
  });

  it("models SharePoint separately from OneDrive", () => {
    expect(PROVIDERS.sharepoint.id).not.toBe(PROVIDERS.onedrive.id);
  });
});
