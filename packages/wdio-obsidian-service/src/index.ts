/**
 * @module
 * @document ../README.md
 */
import ObsidianLauncher from "obsidian-launcher";
import { ObsidianLauncherService, ObsidianWorkerService } from "./service.js";
/** @hidden */
export default ObsidianWorkerService;
/** @hidden */
export const launcher = ObsidianLauncherService;

export type { ObsidianCapabilityOptions, ObsidianServiceOptions } from "./types.js";
export type { ObsidianBrowserCommands, ExecuteObsidianArg, InstalledPlugins } from "./browserCommands.js";
export { default as obsidianPage } from "./pageobjects/obsidianPage.js";
export type { ObsidianPage } from "./pageobjects/obsidianPage.js";
export type { PluginEntry, DownloadedPluginEntry, ThemeEntry, DownloadedThemeEntry } from "obsidian-launcher";

export { minSupportedObsidianVersion } from "./service.js";
export { startWdioSession } from "./standalone.js";

// Some convenience helpers for use in wdio.conf.(m)ts

/**
 * Returns true if there is a current Obsidian beta and we have the credentials to download it, or its already in cache.
 * @param cacheDir Obsidian cache dir, defaults to `.obsidian-cache`.
 */
export async function obsidianBetaAvailable(cacheDir?: string) {
    const launcher = new ObsidianLauncher({cacheDir: cacheDir});
    const versionInfo = await launcher.getVersionInfo("latest-beta");
    return versionInfo.isBeta && await launcher.isAvailable(versionInfo.version);
}

/**
 * Resolves Obsidian app and installer version strings to absolute versions.
 * @param appVersion Obsidian version string or one of 
 *   - "latest": Get the current latest non-beta Obsidian version
 *   - "latest-beta": Get the current latest beta Obsidian version (or latest is there is no current beta)
 *   - "earliest": Get the `minAppVersion` set in your `manifest.json`
 * @param installerVersion Obsidian version string or one of 
 *   - "latest": Get the latest Obsidian installer compatible with `appVersion`
 *   - "earliest": Get the oldest Obsidian installer compatible with `appVersion`
 * @param cacheDir Obsidian cache dir, defaults to `.obsidian-cache`.
 * 
 * See also: [Obsidian App vs Installer Versions](../README.md#obsidian-app-vs-installer-versions)
 *
 * @returns [appVersion, installerVersion] with any "latest" etc. resolved to specific versions.
 */
export async function resolveObsidianVersions(
    appVersion: string, installerVersion: string, cacheDir?: string,
): Promise<[string, string]> {
    const launcher = new ObsidianLauncher({cacheDir: cacheDir});
    return await launcher.resolveVersions(appVersion, installerVersion);
}
