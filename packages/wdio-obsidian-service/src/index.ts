/**
 * @module
 * @document ../README.md
 * @categoryDescription Options
 * Capability and service options.
 * @categoryDescription WDIO Helpers
 * Helpers for use in wdio.conf.mts, or for launching WDIO in standalone mode.
 * @categoryDescription Utilities
 * Browser commands and helper functions for writing tests.
 */
import ObsidianLauncher from "obsidian-launcher";
import { deprecate } from "util";

import { ObsidianLauncherService, ObsidianWorkerService } from "./service.js";
/** @hidden */
export default ObsidianWorkerService;
/** @hidden */
export const launcher = ObsidianLauncherService;

export type { ObsidianCapabilityOptions, ObsidianServiceOptions } from "./types.js";
export type { ObsidianBrowserCommands, ExecuteObsidianArg, InstalledPlugins } from "./browserCommands.js";
export { default as obsidianPage } from "./pageobjects/obsidianPage.js";
export type { ObsidianPage, Platform } from "./pageobjects/obsidianPage.js";
export type { PluginEntry, ThemeEntry } from "obsidian-launcher";

export { minSupportedObsidianVersion } from "./service.js";
export { startWdioSession } from "./standalone.js";

// Some convenience helpers for use in wdio.conf.mts

/**
 * Returns true if there is a current Obsidian beta and we have the credentials to download it, or its already in cache.
 * @category WDIO Helpers
 * @param opts.cacheDir Obsidian cache dir, defaults to `.obsidian-cache`.
 */
export async function obsidianBetaAvailable(opts: string|{cacheDir?: string} = {}) {
    opts = typeof opts == "string" ? {cacheDir: opts} : opts;
    const launcher = new ObsidianLauncher(opts);
    const versionInfo = await launcher.getVersionInfo("latest-beta");
    return versionInfo.isBeta && await launcher.isAvailable(versionInfo.version);
}

/**
 * Resolves Obsidian app and installer version strings to absolute versions.
 * 
 * @category WDIO Helpers
 * @deprecated Use parseObsidianVersions instead
 */
export const resolveObsidianVersions = deprecate(async function(
    appVersion: string, installerVersion: string, cacheDir?: string,
): Promise<[string, string]> {
    const launcher = new ObsidianLauncher({cacheDir: cacheDir});
    return await launcher.resolveVersion(appVersion, installerVersion);
}, 'resolveObsidianVersions is deprecated, use parseObsidianVersions instead');


/**
 * Parses a string of Obsidian versions into [appVersion, installerVersion] tuples. This is a convenience helper for use
 * in `wdio.conf.mts`
 * 
 * `versions` should be a space separated list of Obsidian app versions. You can optionally specify the installer
 * version by using "appVersion/installerVersion" e.g. `"1.7.7/1.8.10"`.
 * 
 * Like in {@link ObsidianCapabilityOptions}, appVersion can be a specific version, "latest", "latest-beta", or
 * "earliest" and installerVersion can be a specific version, "latest" or "earliest".
 * 
 * Example: 
 * ```js
 * parseObsidianVersions("1.7.7 1.7.7/1.8.10 1.8.10/earliest latest-beta/latest")
 * ```
 * 
 * See also: [Obsidian App vs Installer Versions](../README.md#obsidian-app-vs-installer-versions)
 * 
 * @category WDIO Helpers
 * @param versions string to parse
 * @param opts.cacheDir Obsidian cache dir, defaults to `.obsidian-cache`.
 * @returns [appVersion, installerVersion][]
 */
export async function parseObsidianVersions(
    versions: string,
    opts: {cacheDir?: string} = {},
): Promise<[string, string][]> {
    const launcher = new ObsidianLauncher(opts);
    return launcher.parseVersions(versions);
}
