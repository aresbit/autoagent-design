import { describe, expect, it } from "vitest";

import { resolveWinInstallIdentity } from "../src/win/identity.js";

describe("resolveWinInstallIdentity", () => {
  it("keeps the default namespace on the canonical Windows display name", () => {
    expect(resolveWinInstallIdentity({ namespace: "default" })).toMatchObject({
      displayName: "Auto Design",
      shortcutName: "Auto Design.lnk",
      uninstallerName: "Uninstall Auto Design.exe",
    });
  });

  it("uses first-class beta display identity for beta release namespaces", () => {
    expect(resolveWinInstallIdentity({ namespace: "release-beta-win" })).toMatchObject({
      appPathsKey: "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Auto Design Beta.exe",
      displayName: "Auto Design Beta",
      registryKey: "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Auto Design-release-beta-win",
      shortcutName: "Auto Design Beta.lnk",
      uninstallerName: "Uninstall Auto Design Beta.exe",
    });
  });

  it("keeps non-release beta-like namespaces isolated from the real beta channel identity", () => {
    expect(resolveWinInstallIdentity({ namespace: "beta-local-flow" })).toMatchObject({
      appPathsKey: "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Auto Design beta-local-flow.exe",
      displayName: "Auto Design beta-local-flow",
      registryKey: "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Auto Design-beta-local-flow",
      shortcutName: "Auto Design beta-local-flow.lnk",
      uninstallerName: "Uninstall Auto Design beta-local-flow.exe",
    });
  });

  it("uses first-class preview display identity for preview release namespaces", () => {
    expect(resolveWinInstallIdentity({ namespace: "release-preview-win" })).toMatchObject({
      appPathsKey: "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Auto Design Preview.exe",
      displayName: "Auto Design Preview",
      registryKey: "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Auto Design-release-preview-win",
      shortcutName: "Auto Design Preview.lnk",
      uninstallerName: "Uninstall Auto Design Preview.exe",
    });
  });
});
