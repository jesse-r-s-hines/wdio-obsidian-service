/**
 * I'm not extending the "obsidian" namespace directly, or using fevol/obsidian-typings as I don't want
 * wdio-obsidian-service implicitly exposing these internal types to users.
 */

import { MetadataCache, App, Platform } from "obsidian";


export interface AppInternal extends App {
    commands: {
        executeCommandById(id: string): boolean,
    },

    plugins: {
        enablePluginAndSave(pluginId: string): Promise<void>,
        disablePluginAndSave(pluginId: string): Promise<void>,
    },

    customCss: {
        setTheme(theme: string): Promise<void>,
    },

    metadataCache: MetadataCacheInternal,
}

export interface MetadataCacheInternal extends MetadataCache {
    getFileInfo(path: string): FileCacheEntry|undefined;
}

export interface FileCacheEntry {
    hash: string;
    mtime: number;
    size: number;
}

export type PlatformInternal = (typeof Platform) & {
    // these fields exist in Obsidian 1.0.3, but were only added to types later
    isPhone: boolean,
    isTablet: boolean,
    // isLinux doesn't exist in 1.0.3, though weirdly isWin exists but isn't in types, and isMacOS is in types
    isWin: boolean,
    isLinux?: boolean,
}
