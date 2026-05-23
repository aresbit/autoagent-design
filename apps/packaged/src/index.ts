import { performance } from "node:perf_hooks";
import {
  APP_KEYS,
  OPEN_DESIGN_SIDECAR_CONTRACT,
  SIDECAR_MODES,
  SIDECAR_SOURCES,
  type SidecarStamp,
} from "@open-design/sidecar-proto";
import {
  bootstrapSidecarRuntime,
  createSidecarLaunchEnv,
  resolveAppIpcPath,
} from "@open-design/sidecar";
import { readProcessStamp } from "@open-design/platform";
import { join } from "node:path";
import { app, dialog } from "electron";

import { readPackagedConfig } from "./config.js";
import { writePackagedDesktopIdentity } from "./identity.js";
import {
  PackagedPathAccessError,
  applyPackagedElectronPathOverrides,
  ensurePackagedNamespacePaths,
} from "./launch.js";
import {
  attachPackagedDesktopProcessLogging,
  createPackagedDesktopLogger,
  type PackagedDesktopLogger,
} from "./logging.js";
import { resolvePackagedNamespacePaths } from "./paths.js";
import { packagedEntryUrl, registerOdProtocol } from "./protocol.js";
import { startPackagedSidecars } from "./sidecars.js";

let packagedLogger: PackagedDesktopLogger | null = null;

function createPackagedDesktopStamp(namespace: string): SidecarStamp {
  return {
    app: APP_KEYS.DESKTOP,
    ipc: resolveAppIpcPath({
      app: APP_KEYS.DESKTOP,
      contract: OPEN_DESIGN_SIDECAR_CONTRACT,
      namespace,
    }),
    mode: SIDECAR_MODES.RUNTIME,
    namespace,
    source: SIDECAR_SOURCES.PACKAGED,
  };
}

function applyLaunchEnv(base: string, stamp: SidecarStamp): void {
  const env = createSidecarLaunchEnv({
    base,
    contract: OPEN_DESIGN_SIDECAR_CONTRACT,
    stamp,
  });

  for (const [key, value] of Object.entries(env)) {
    if (value != null) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  performance.mark("packaged:start");
  const config = await readPackagedConfig();
  performance.mark("packaged:config-read");
  const argvStamp = readProcessStamp(process.argv.slice(1), OPEN_DESIGN_SIDECAR_CONTRACT);
  const namespace = argvStamp?.namespace ?? config.namespace;
  const paths = resolvePackagedNamespacePaths(config, namespace);
  const stamp = argvStamp ?? createPackagedDesktopStamp(namespace);

  await ensurePackagedNamespacePaths(paths);
  performance.mark("packaged:paths-ready");
  packagedLogger = createPackagedDesktopLogger(paths);
  attachPackagedDesktopProcessLogging({ logger: packagedLogger, paths, stamp });
  applyPackagedElectronPathOverrides(paths);
  performance.mark("packaged:electron-ready");
  const identity = await writePackagedDesktopIdentity({ paths, stamp });
  await app.whenReady();
  performance.mark("packaged:app-ready");

  applyLaunchEnv(paths.runtimeRoot, stamp);

  const runtime = bootstrapSidecarRuntime(stamp, process.env, {
    app: APP_KEYS.DESKTOP,
    base: paths.runtimeRoot,
    contract: OPEN_DESIGN_SIDECAR_CONTRACT,
  });
  performance.mark("packaged:runtime-bootstrapped");

  const sidecars = await startPackagedSidecars(runtime, paths, {
    appVersion: config.appVersion,
    daemonCliEntry: config.daemonCliEntry,
    daemonSidecarEntry: config.daemonSidecarEntry,
    nodeCommand: config.nodeCommand,
    telemetryRelayUrl: config.telemetryRelayUrl,
    posthogKey: config.posthogKey,
    posthogHost: config.posthogHost,
    // PR #974 round-5 (lefarcen P2): the Electron entry runs desktop
    // main alongside the daemon, so the import-folder gate must be
    // pinned ON from request 0. See `apps/packaged/src/headless.ts` for
    // the daemon+web-only counterpart that passes `false`.
    requireDesktopAuth: true,
    webSidecarEntry: config.webSidecarEntry,
    webStandaloneRoot: config.webStandaloneRoot,
    webOutputMode: config.webOutputMode,
  });
  performance.mark("packaged:sidecars-ready");
  registerOdProtocol(sidecars.web.url ?? "http://127.0.0.1:0");
  performance.mark("packaged:protocol-registered");

  const { runDesktopMain } = await import("@open-design/desktop/main");
  performance.mark("packaged:desktop-main-imported");

  // Log packaged startup timing breakdown
  try {
    performance.measure("packaged:config", "packaged:start", "packaged:config-read");
    performance.measure("packaged:paths", "packaged:config-read", "packaged:paths-ready");
    performance.measure("packaged:electron-setup", "packaged:paths-ready", "packaged:electron-ready");
    performance.measure("packaged:app-wait", "packaged:electron-ready", "packaged:app-ready");
    performance.measure("packaged:bootstrap", "packaged:app-ready", "packaged:runtime-bootstrapped");
    performance.measure("packaged:sidecars", "packaged:runtime-bootstrapped", "packaged:sidecars-ready");
    performance.measure("packaged:protocol", "packaged:sidecars-ready", "packaged:protocol-registered");
    performance.measure("packaged:desktop-import", "packaged:protocol-registered", "packaged:desktop-main-imported");
    performance.measure("packaged:pre-desktop-total", "packaged:start", "packaged:desktop-main-imported");
    for (const entry of performance.getEntriesByType("measure")) {
      console.log(`[auto-design packaged] startup timing — ${entry.name}: ${Math.round(entry.duration)}ms`);
    }
    performance.clearMarks();
    performance.clearMeasures();
  } catch {
    // ignore timing errors
  }

  await runDesktopMain(runtime, {
    async beforeShutdown() {
      try {
        await sidecars.close();
      } finally {
        await identity.close();
      }
    },
    async discoverWebUrl() {
      return packagedEntryUrl();
    },
    // Round-7 (lefarcen P2 @ runtime.ts:336): packaged main-process
    // fetch targets the daemon sidecar's real http URL — never the
    // od://app/ renderer URL, which Node/undici cannot resolve through
    // Electron's protocol handler.
    async discoverDaemonUrl() {
      return sidecars.daemon.url;
    },
    preloadPath: join(app.getAppPath(), "preload.cjs"),
    update: {
      currentVersion: config.appVersion,
      downloadRoot: paths.updateRoot,
    },
  });
}

void main().catch((error: unknown) => {
  if (error instanceof PackagedPathAccessError) {
    try {
      dialog.showErrorBox(error.title, error.message);
    } catch {
      // Fall through to console logging + process exit.
    }
  }
  packagedLogger?.error("packaged runtime failed", { error });
  console.error("packaged runtime failed", error);
  process.exit(1);
});
