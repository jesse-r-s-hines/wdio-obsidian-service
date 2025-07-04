import type { ObsidianBrowserCommands } from "./browserCommands.js";
import type { PluginEntry, ThemeEntry, DownloadedPluginEntry, DownloadedThemeEntry } from "obsidian-launcher";

export const OBSIDIAN_CAPABILITY_KEY = "wdio:obsidianOptions";

/**
 * Options passed to an "wdio:obsidianOptions" capability in wdio.conf.ts. E.g.
 * ```ts
 * // ...
 * capabilities: [{
 *     browserName: "obsidian",
 *     browserVersion: "latest",
 *     'wdio:obsidianOptions': {
 *         installerVersion: 'earliest',
 *         plugins: ["."],
 *     },
 * }],
 * ```
 * 
 * @category Options
 */
export interface ObsidianCapabilityOptions {
    /**
     * Version of Obsidian to download and run.
     * 
     * Can be set to a specific version or one of:
     * - "latest": Run the latest non-beta Obsidian version
     * - "latest-beta": Run the latest beta Obsidian version (or latest is there is no current beta)
     *   - To download Obsidian beta versions you'll need to have an Obsidian account with Catalyst and set the 
     *     `OBSIDIAN_USERNAME` and `OBSIDIAN_PASSWORD` environment variables. 2FA needs to be disabled.
     * - "earliest": Run the `minAppVersion` set in your `manifest.json`
     * 
     * Defaults to "latest".
     * 
     * You can also use the wdio capability `browserVersion` field to set the Obsidian version.
     * 
     * See also: [Obsidian App vs Installer Versions](../README.md#obsidian-app-vs-installer-versions)
     */
    appVersion?: string

    /**
     * Version of the Obsidian installer to download and run.
     * 
     * Obsidian is distributed in two parts, the app which contains the JS, and the installer which is the binary with
     * electron. Obsidian's auto update only updates the app, so users on the same Obsidian version can be running
     * different Electron versions. You can use this to test your plugin against different installer/electron versions.
     * 
     * See also: [Obsidian App vs Installer Versions](../README.md#obsidian-app-vs-installer-versions)
     *
     * Can be set to a specific version string or one of:
     * - "latest": Run the latest Obsidian installer compatible with `appVersion`.
     * - "earliest": Run the oldest Obsidian installer compatible with `appVersion`.
     * 
     * Defaults to "earliest".
     */
    installerVersion?: string,

    /**
     * List of plugins to install.
     * 
     * Each entry is a path to the local plugin to install, e.g. ["."] or ["dist"] depending on your build setup. Paths
     * are relative to your `wdio.conf.ts`.You can also pass objects. If you pass an object it should contain one of
     * `path` (to install a local plugin), `repo` (to install a plugin from GitHub), or `id` (to install a community
     * plugin). You can set `enabled: false` to install the plugin but start it disabled. You can enable the plugin
     * later using `browser.reloadObsidian` or the `obsidianPage.enablePlugin`.
     */
    plugins?: PluginEntry[],

    /**
     * List of themes to install.
     * 
     * Each entry is a path to the local theme to install. Paths are relative to your `wdio.conf.ts`. You can also pass
     * an object. If you pass an object it should contain one of `path` (to install a local theme), `repo` (to install a
     * theme from GitHub), or `name` (to install a community theme). You can set `enabled: false` to install the theme,
     * but start it disabled. You can only have one enabled theme, so if you pass multiple you'll have to disable all
     * but one.
     */
    themes?: ThemeEntry[],

    /**
     * The path to the vault to open.
     * 
     * The vault will be copied, so any changes made in your tests won't affect the original. If omitted, no vault will
     * be opened and you'll need to call `browser.reloadObsidian` to open a vault during your tests. Path is relative
     * to your `wdio.conf.ts`.
     */
    vault?: string,

    /**
     * Path to the Obsidian binary to use. If omitted it will be downloaded automatically.
     */
    binaryPath?: string,

    /**
     * Path to the app asar to load into obsidian. If omitted it will be downloaded automatically.
     */
    appPath?: string,
}


/** Internal type, capability options after being normalized by onPrepare */
export interface NormalizedObsidianCapabilityOptions {
    appVersion: string
    installerVersion: string,
    plugins: DownloadedPluginEntry[],
    themes: DownloadedThemeEntry[],
    vault?: string,
    vaultCopy?: string,
    binaryPath: string,
    appPath: string,
}


/**
 * Options based to the obsidian service in wdio.conf.ts. E.g.
 * ```js
 * // ...
 * services: [["obsidian", {versionsUrl: "file:///path/to/obsidian-versions.json"}]]
 * ```
 * You'll usually want to leave these options as the default, they are mostly useful for wdio-obsidian-service's
 * internal tests.
 * 
 * @category Options
 */
export interface ObsidianServiceOptions {
    /**
     * Override the `obsidian-versions.json` used by the service. Can be a file URL.
     * Defaults to https://github.com/jesse-r-s-hines/wdio-obsidian-service/blob/HEAD/obsidian-versions.json which is
     * auto-updated to contain information on available Obsidian versions.
     */
    versionsUrl?: string,
    /**
     * Override the `community-plugins.json` used by the service. Can be a file URL.
     * Defaults to https://github.com/obsidianmd/obsidian-releases/blob/HEAD/community-plugins.json
     */
    communityPluginsUrl?: string,
    /**
     * Override the `community-css-themes.json` used by the service. Can be a file URL.
     * Defaults tohttps://github.com/obsidianmd/obsidian-releases/blob/HEAD/community-css-themes.json
     */
    communityThemesUrl?: string,
}

declare global {
    namespace WebdriverIO {
        interface Capabilities {
            [OBSIDIAN_CAPABILITY_KEY]?: ObsidianCapabilityOptions,
        }

        interface Browser extends ObsidianBrowserCommands {}
    }
}
