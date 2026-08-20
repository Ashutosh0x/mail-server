import { guard, ok, requireUser } from "@/lib/server/http";
import { architecture, dataDirectories, platformId, platformInfo } from "@/lib/server/platform/platform";
import { configuredRoots } from "@/lib/server/storage/local-roots";
import { discoverStorage } from "@/lib/server/storage/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/system/capabilities — what THIS host can actually do.
 *
 * The point is that the frontend stops guessing. Without this, the UI decides
 * what to offer from hardcoded assumptions, and every one of them is wrong on
 * some platform: SMB is offered where no client exists, a local-storage button
 * appears where the operator never allowed a root, discovery looks broken
 * rather than unimplemented.
 *
 * Each flag below is derived from something real — a connector that exists, an
 * environment variable the operator set, an adapter for this platform — never
 * from the platform name alone. `smb: false` on Windows is correct: the host
 * can mount SMB shares, and Mail Server can use them once mounted, but it has
 * no SMB client of its own.
 *
 * Authenticated: this describes the server's filesystem layout and what it can
 * reach, which is reconnaissance for anyone without an account.
 */
export async function GET() {
  return guard(async () => {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const info = platformInfo();
    const discovery = await discoverStorage();
    const directories = dataDirectories();

    return ok({
      platform: info.platform,
      architecture: architecture(),
      runtime: {
        node: info.nodeVersion,
        osRelease: info.osRelease,
        supported: info.supported,
      },
      storage: {
        // Always: the local filesystem provider is the default object store.
        local: true,
        // True when this platform has a discovery adapter AND it worked.
        mounted: discovery.capabilities.mountedFilesystems,
        // Whether the operator has permitted any path for local connections.
        localConnections: configuredRoots().length > 0,
        // Implemented and tested against a real server.
        webdav: true,
        // No client library. Mounted shares still work through `mounted`.
        smb: false,
        // Mounting needs privileges the app process does not hold.
        nfs: false,
        // Needs request signing that has not been written or verified.
        s3: false,
        networkDiscovery: discovery.capabilities.mdns || discovery.capabilities.ssdp,
      },
      /**
       * Directory NAMES only, never their contents, and only to the signed-in
       * operator — enough to answer "where did it put my data", which is
       * otherwise a support question with no good answer.
       */
      directories: {
        data: directories.data,
        config: directories.config,
        logs: directories.logs,
        storage: directories.storage,
      },
      discovery: {
        adapter: platformId(),
        mdns: discovery.capabilities.mdns,
        ssdp: discovery.capabilities.ssdp,
        errors: discovery.errors,
      },
    });
  });
}
