/**
 * Type of the obsidian-versions.json file.
 * @category Types
 */
export type ObsidianVersionInfos = {
    metadata: {
        commitDate: string,
        commitSha: string,
        timestamp: string,
    },
    versions: ObsidianVersionInfo[],
}

/**
 * Metadata about a specific Obsidian version, including the min/max compatible installer versions, download urls, and
 * the internal electron version.
 * @category Types
 */
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

/**
 * Schema of entries in https://github.com/obsidianmd/obsidian-releases/blob/HEAD/community-plugins.json
 * @category Types
 */
export type ObsidianCommunityPlugin = {
    id: string,
    name: string
    author: string,
    description: string,
    repo: string,
}

/**
 * Schema of entries in https://github.com/obsidianmd/obsidian-releases/blob/HEAD/community-css-themes.json
 * @category Types
 */
export type ObsidianCommunityTheme = {
    name: string,
    author: string,
    repo: string,
    screenshot: string,
    modes: string[],
}

/** @inline */
interface BasePluginEntry {
    /** Set false to install the plugin but start it disabled. Default true. */
    enabled?: boolean,
}
/** @inline */
interface LocalPluginEntry extends BasePluginEntry {
    /** Path on disk to the plugin to install. */
    path: string,
}
/** @inline */
interface GitHubPluginEntry extends BasePluginEntry {
    /** Github repo of the plugin to install, e.g. "some-user/some-plugin". */
    repo: string,
    /** Version of the plugin to install. Defaults to latest. */
    version?: string,
}
/** @inline */
interface CommunityPluginEntry extends BasePluginEntry {
    /** Plugin ID to install from Obsidian community plugins. */
    id: string,
    /** Version of the plugin to install. Defaults to latest. */
    version?: string,
}
/**
 * A plugin to install. Can be a simple string path to the local plugin to install, or an object.
 * If an object set one of:
 * - `path` to install a local plugin
 * - `repo` to install a plugin from github
 * - `id` to install a community plugin
 * 
 * You can also pass `enabled: false` to install the plugin, but start it disabled by default.
 * 
 * @category Types
 */
export type PluginEntry = string|LocalPluginEntry|GitHubPluginEntry|CommunityPluginEntry

/**
 * PluginEntry plus downloaded path.
 * @category Types
 */
export type DownloadedPluginEntry = {
    /** If the plugin is enabled */
    enabled: boolean,
    /** Path on disk to the downloaded plugin. */
    path: string,
    /** Id of the plugin */
    id: string,
    /** Type of the plugin entry before downloading */
    originalType: "local"|"github"|"community",
}

/** @inline */
interface BaseThemeEntry {
    /**
     * Set false to install the theme but not enable it. Defaults to true.
     * Only one theme can be enabled.
     */
    enabled?: boolean,
}
/** @inline */
interface LocalThemeEntry extends BaseThemeEntry {
    /** Path on disk to the theme to install. */
    path: string,
}
/** @inline */
interface GitHubThemeEntry extends BaseThemeEntry {
    /** Github repo of the theme to install, e.g. "some-user/some-theme". */
    repo: string,
}
/** @inline */
interface CommunityThemeEntry extends BaseThemeEntry {
    /** Theme name to install from Obsidian community themes. */
    name: string,
}

/**
 * A theme to install. Can be a simple string path to the local theme to install, or an object.
 * If an object, set one of:
 * - `path` to install a local theme
 * - `repo` to install a theme from github
 * - `name` to install a community theme
 * 
 * You can also pass `enabled: false` to install the theme, but start it disabled by default. You can only have one
 * enabled theme, so if you pass multiple you need to disable all but one.
 * 
 * @category Types
 */
export type ThemeEntry = string|LocalThemeEntry|GitHubThemeEntry|CommunityThemeEntry

/**
 * ThemeEntry plus downloaded path.
 * @category Types
 */
export type DownloadedThemeEntry = {
    /** If the theme is enabled */
    enabled: boolean,
    /** Path on disk to the downloaded theme. */
    path: string,
    /** Name of the theme */
    name: string,
    /** Type of the theme entry before downloading */
    originalType: "local"|"github"|"community",
}
