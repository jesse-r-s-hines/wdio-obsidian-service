/**
 * Extra typings for the Obsidian api
 */

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

export interface PluginManifest {
    author: string;
    authorUrl?: string;
    description: string;
    dir?: string;
    fundingUrl?: string;
    id: string;
    isDesktopOnly?: boolean;
    minAppVersion: string;
    name: string;
    version: string;
}

export interface ObsidianAppearanceConfig {
    cssTheme?: string,
}

export interface ObsidianDesktopRelease {
    minimumVersion: string,
    latestVersion: string,
    downloadUrl: string,
    hash: string,
    signature: string,
    beta?: {
        minimumVersion: string,
        latestVersion: string,
        downloadUrl: string,
        hash: string,
        signature: string,
    }
}
