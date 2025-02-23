import { ObsidianLauncher } from "./obsidianLauncher.js"
import { ObsidianLauncherService, ObsidianWorkerService } from "./service.js";
import type {
    ObsidianServiceOptions, ObsidianCapabilityOptions,
    ObsidianCommunityPlugin, ObsidianCommunityTheme,
    LocalPluginEntry, GitHubPluginEntry, CommunityPluginEntry, PluginEntry,
    LocalThemeEntry, GitHubThemeEntry, CommunityThemeEntry, ThemeEntry,
} from "./types.js";


export default ObsidianWorkerService;
export const launcher = ObsidianLauncherService;
export type {
    ObsidianServiceOptions, ObsidianCapabilityOptions, ObsidianCommunityPlugin, ObsidianCommunityTheme,
    LocalPluginEntry, GitHubPluginEntry, CommunityPluginEntry, PluginEntry,
    LocalThemeEntry, GitHubThemeEntry, CommunityThemeEntry, ThemeEntry,
}

/**
 * Returns true if we either have the credentails to download the latest Obsidian beta or it's already in cache.
 */
export async function obsidianBetaAvailable(cacheDir?: string) {
    const launcher = new ObsidianLauncher({cacheDir: cacheDir});
    return await launcher.isAvailable("latest-beta");
}
