import type { MetadataCache, App } from "obsidian";

/**
 * I'm not extending the "obsidian" namespace directly, or using fevol/obsidian-typings as I don't want
 * wdio-obsidian-service implicitly exposing these internal types to users.
 */
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
