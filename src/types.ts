import type { ObsidianBrowserCommands } from "./browserCommands.js"
import type { App } from "obsidian"

type ObsidianApi = typeof import("obsidian") 

/**
 * Type of the obsidian-versions.json file.
 */
export type ObsidianVersionInfos = {
    latest: { date: string, sha: string },
    versions: ObsidianVersionInfo[],
}

export type ObsidianVersionInfo = {
    version: string,
    minInstallerVersion: string,
    maxInstallerVersion: string,
    isBeta: boolean,
    gitHubRelease?: string,
    downloads: {
        appImage?: string,
        appImageArm?: string,
        apk?: string,
        asar?: string,
        dmg?: string,
        exe?: string,
    },
    electronVersion?: string,
    chromeVersion?: string,
    nodeVersion?: string,
}

export const OBSIDIAN_CAPABILITY_KEY = "wdio:obsidianOptions" as const

export interface ObsidianServiceOptions {
    /**
     * Override the `obsidian-versions.json` used by the service. Can be a file URL.
     * This is only really useful for this package's own internal tests.
     */
    versionsUrl?: string,
    /**
     * Override the `community-plugins.json` used by the service. Can be a file URL.
     * This is only really useful for this package's own internal tests.
     */
    communityPluginsUrl?: string,
    /**
     * Override the `community-css-themes.json` used by the service. Can be a file URL.
     * This is only really useful for this package's own internal tests.
     */
    communityThemesUrl?: string,
}

type BasePluginEntry = {
    /** Set false to install the plugin but start it disabled. Default true. */
    enabled?: boolean,
}
export type LocalPluginEntry = BasePluginEntry & {
    /** Path on disk to the plugin to install. */
    path: string,
}
export type GitHubPluginEntry = BasePluginEntry & {
    /** Github repo of the plugin to install, e.g. "some-user/some-plugin". */
    repo: string,
    /** Version of the plugin to install. Defaults to latest. */
    version?: string,
}
export type CommunityPluginEntry = BasePluginEntry & {
    /** Plugin ID to install from Obsidian community plugins. */
    id: string,
    /** Version of the plugin to install. Defaults to latest. */
    version?: string,
}

/**
 * A plugin to install. Can be a simple string path to the local plugin to install, or an object.
 * If an object set one of `path` (to install a local plugin), `repo` (to install a plugin from github), or `id` to
 * install a plugin from Obsidian community plugins. You can also pass `enabled: false` to install the plugin, but start
 * it disabled by default.
 */
export type PluginEntry = string|LocalPluginEntry|GitHubPluginEntry|CommunityPluginEntry


type BaseThemeEntry = {
    /**
     * Set false to install the plugin but not enable it. Defaults to true.
     * Only one theme can be enabled.
     */
    enabled?: boolean,
}
export type LocalThemeEntry = BaseThemeEntry & {
    /** Path on disk to the theme to install. */
    path: string,
}
export type GitHubThemeEntry = BaseThemeEntry & {
    /** Github repo of the theme to install, e.g. "some-user/some-theme". */
    repo: string,
}
export type CommunityThemeEntry = BaseThemeEntry & {
    /** Theme name to install from Obsidian community themes. */
    name: string,
}

/**
 * A theme to install. Can be a simple string path to the local plugin to install, or an object.
 * If an object set one of `path` (to install a local theme), `repo` (to install a theme from github), or `name` to
 * install a theme from Obsidian community theme. You can also pass `enabled: false` to install the theme, but start
 * it disabled by default. You can only have one enabled theme, so if you pass multiple you'll have to disable all but
 * one.
 */
export type ThemeEntry = string|LocalThemeEntry|GitHubThemeEntry|CommunityThemeEntry


export interface ObsidianCapabilityOptions {
    /**
     * Version of Obsidian to run. Can be set to "latest", "latest-beta", or a specific version name. Defaults to
     * "latest". You can also use the wdio `browserVersion` option instead.
     */
    appVersion?: string

    /**
     * Version of the Obsidian Installer to download.
     * 
     * Note that Obsidian is distributed in two parts, the "installer", which is the executable containing Electron, and
     * the "app" which is a bundle of JavaScript containing the Obsidian code. Obsidian's self-update system only
     * updates the JavaScript bundle, and not the base installer/Electron version. This makes Obsidian's auto-update
     * fast as it only needs to download a few MiB of JS instead of all of  Electron. But, it means different users with
     * the same Obsidian version may be running on different versions of Electron, which could cause obscure differences
     * in plugin behavior if you are using newer JavaScript features and the like in your plugin.
     * 
     * If passed "latest", it will use the maximum installer version compatible with the selected Obsidian version. If
     * passed "earliest" it will use the oldest installer version compatible with the selected Obsidian version. The 
     * default is "earliest".
     */
    installerVersion?: string,

    /**
     * Plugins to install.
     * 
     * Can be simple paths to the local plugin to install, e.g. ["."] or ["dist"] depending on your build setup. You
     * can also pass an object. If you pass an object it can contain one of either `path` (to install a local plugin),
     * `repo` (to install a plugin from github), or `id` to install a plugin from Obsidian community plugins. You can
     * set `enabled: false` to install the plugin, but start it disabled by default.
     */
    plugins?: PluginEntry[],

    /**
     * Themes to install.
     * 
     * Can be simple paths to the local themes to install, e.g. ["."] or ["dist"]. You can also pass an object. If you
     * pass an object it can contain one of either `path` (to install a local theme), `repo` (to install a theme from
     * github), or `name` to install a theme from Obsidian community themes. You can set `enabled: false` to install the
     * theme, but start it disabled by default. You can only have one enabled theme, so if you pass multiple you'll
     * have to disable all but one.
     */
    themes?: ThemeEntry[],

    /**
     * The path to the vault to open. The vault will be copied first, so any changes made in your tests won't affect the
     * original. If omitted, no vault will be opened. You can call `browser.openVault` to open a vault during the tests.
     */
    vault?: string,

    /** Path to the Obsidian binary to use. If omitted it will download Obsidian automatically.*/
    binaryPath?: string,

    /** Path to the app asar to load into obsidian. If omitted it will be downloaded automatically. */
    appPath?: string,
}


declare global {
    namespace WebdriverIO {
        interface Capabilities {
            [OBSIDIAN_CAPABILITY_KEY]?: ObsidianCapabilityOptions,
        }

        interface Browser extends ObsidianBrowserCommands {
            /**
             * Opens an obsidian vault. The vault will be copied, so any changes made in your tests won't be persited to the
             * original. This does require rebooting Obsidian. You can also set the vault in the `wdio.conf.ts` capabilities
             * section which may be useful if all your tests use the same vault.
             * 
             * @param vault path to the vault to open. If omitted it will re-open the current vault.
             * @param plugins List of plugin ids to enable. If omitted it will keep current plugin list.
             *     Note, all the plugins must be defined in your wdio.conf.ts capabilities. You can use openVault to
             *     toggle which plugins are enabled and which are disabled.
             * @param theme Theme to enable. Pass "" to switch back to the default theme.
             * @returns Returns the new sessionId (same as reloadSession()).
             */
            openVault(vault?: string, plugins?: string[], theme?: string): Promise<string>;
        }
    }

    /**
     * This is a global added inside Obsidian so you can access app and the obsidian API.
     * You can only access inside a wdio execute context (see https://webdriver.io/docs/api/browser/execute)
     */
    const optl: {
        app: App,
        obsidian: ObsidianApi,
    }
}
