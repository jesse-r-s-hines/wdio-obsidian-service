import ObsidianLauncher from "obsidian-launcher";
import { ObsidianLauncherService, ObsidianWorkerService } from "./service.js";
/** @hidden */
export default ObsidianWorkerService;
/** @hidden */
export const launcher = ObsidianLauncherService;
export { minSupportedObsidianVersion } from "./service.js";

export type { ObsidianServiceOptions, ObsidianCapabilityOptions } from "./types.js";
export type { ObsidianBrowserCommands, ExecuteObsidianArg } from "./browserCommands.js";
export { default as obsidianPage } from "./pageobjects/obsidianPage.js";
export type { ObsidianPage } from "./pageobjects/obsidianPage.js";

export type { PluginEntry, DownloadedPluginEntry, ThemeEntry, DownloadedThemeEntry } from "obsidian-launcher";

// Some convenience helpers for use in wdio.conf.ts

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
 * @param appVersion Obsidian version string or "latest", "latest-beta" or "earliest". "earliest" will use the 
 *     minAppVersion set in your manifest.json.
 * @param installerVersion Obsidian version string or "latest" or "earliest". "earliest" will use the oldest
 *     installer version compatible with the appVersion.
 * @param cacheDir Obsidian cache dir, defaults to `.obsidian-cache`.
 * @returns [appVersion, installerVersion] with any "latest" etc. resolved to specific versions.
 */
export async function resolveObsidianVersions(
    appVersion: string, installerVersion: string, cacheDir?: string,
): Promise<[string, string]> {
    const launcher = new ObsidianLauncher({cacheDir: cacheDir});
    return await launcher.resolveVersions(appVersion, installerVersion);

}
