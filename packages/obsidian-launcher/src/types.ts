/**
 * Type of the obsidian-versions.json file.
 */
export type ObsidianVersionInfos = {
    metadata: {
        commit_date: string,
        commit_sha: string,
        timestamp: string,
    },
    versions: ObsidianVersionInfo[],
}

export type ObsidianVersionInfo = {
    version: string,
    minInstallerVersion?: string,
    maxInstallerVersion?: string,
    isBeta: boolean,
    gitHubRelease?: string,
    downloads: {
        asar?: string,
        appImage?: string,
        appImageArm?: string,
        apk?: string,
        dmg?: string,
        exe?: string,
    },
    electronVersion?: string,
    chromeVersion?: string,
    nodeVersion?: string,
}

export type ObsidianCommunityPlugin = {
    id: string,
    name: string
    author: string,
    description: string,
    repo: string,
}

export type ObsidianCommunityTheme = {
    name: string,
    author: string,
    repo: string,
    screenshot: string,
    modes: string[],
}

type BasePluginEntry = {
    /** Set false to install the plugin but start it disabled. Default true. */
    enabled?: boolean,
}
export type LocalPluginEntry = BasePluginEntry & {
    /** Path on disk to the plugin to install. */
    path: string,
}
export type DownloadedPluginEntry = LocalPluginEntry & {
    id: string,
    /** Type of the plugin entry before downloading */
    originalType: "local"|"github"|"community",
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
 * If an object set one of `path` (to install a local plugin), `repo` (to install a plugin from github), or `id` (to
 * install a community plugin). You can also pass `enabled: false` to install the plugin, but start it disabled by
 * default.
 */
export type PluginEntry = string|LocalPluginEntry|GitHubPluginEntry|CommunityPluginEntry


type BaseThemeEntry = {
    /**
     * Set false to install the theme but not enable it. Defaults to true.
     * Only one theme can be enabled.
     */
    enabled?: boolean,
}
export type LocalThemeEntry = BaseThemeEntry & {
    /** Path on disk to the theme to install. */
    path: string,
}
export type DownloadedThemeEntry = LocalPluginEntry & {
    name: string,
    /** Type of the plugin entry before downloading */
    originalType: "local"|"github"|"community",
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
 * A theme to install. Can be a simple string path to the local theme to install, or an object.
 * If an object, set one of `path` (to install a local theme), `repo` (to install a theme from github), or `name` (to
 * install a community theme). You can also pass `enabled: false` to install the theme, but start it disabled by
 * default. You can only have one enabled theme, so if you pass multiple you'll have to disable all but one.
 */
export type ThemeEntry = string|LocalThemeEntry|GitHubThemeEntry|CommunityThemeEntry
