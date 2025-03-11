import ObsidianLauncher from "obsidian-launcher";
import { ObsidianLauncherService, ObsidianWorkerService } from "./service.js";

export default ObsidianWorkerService;
export const launcher = ObsidianLauncherService;

export type { ObsidianServiceOptions, ObsidianCapabilityOptions } from "./types.js";

export { default as obsidianPage } from "./pageobjects/obsidianPage.js";

export type {
    LocalPluginEntry, GitHubPluginEntry, CommunityPluginEntry, PluginEntry,
    LocalThemeEntry, GitHubThemeEntry, CommunityThemeEntry, ThemeEntry,
} from "obsidian-launcher";

/**
 * Returns true if there's currently an Obsidian beta and we have the credentials to download it or it's already in the
 * cache.
 */
export async function obsidianBetaAvailable(cacheDir?: string) {
    const launcher = new ObsidianLauncher({cacheDir: cacheDir});
    const versionInfo = await launcher.getVersionInfo("latest-beta");
    return versionInfo.isBeta && await launcher.isAvailable(versionInfo.version);
}
