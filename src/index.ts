import ObsidianLauncher from "./obsidianLauncher.js"
import { ObsidianLauncherService, ObsidianWorkerService } from "./service.js";

export default ObsidianWorkerService;
export const launcher = ObsidianLauncherService;

/**
 * Returns true if we either have the credentails to download the latest Obsidian beta or it's already in cache.
 */
export async function obsidianBetaAvailable(cacheDir: string) {
    const launcher = new ObsidianLauncher({cacheDir: cacheDir});
    return await launcher.isAvailable("latest-beta");
}
