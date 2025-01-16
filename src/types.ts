import type { ObsidianBrowserCommands } from "./browserCommands.js"

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
     * Directory to cache downloaded Obsidian versions. Defaults to `./.optl`
     */
    cacheDir?: string,

    /**
     * Override the `obsidian-versions.json` used by the service. Can be a URL or a file path.
     * This is only really useful for this package's own internal tests.
     */
    obsidianVersionsFile?: string,
}

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

    /** Path to local plugin to install. */
    plugins?: string[],

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
             * @param vault path to the vault to open. If omitted it will use the vault set in `wdio.conf.ts` (An empty
             *     vault by default.)
             * @param plugins List of plugins to initialize. If omitted, it will use the plugins set in `wdio.conf.ts`.
             * @returns Returns the new sessionId (same as reloadSession()).
             */
            openVault(vault?: string, plugins?: string[]): Promise<string>;
        }
    }
}
