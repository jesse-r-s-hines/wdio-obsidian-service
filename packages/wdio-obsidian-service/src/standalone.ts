import { remote } from 'webdriverio'
import type { Capabilities, Options } from '@wdio/types'
import { ObsidianLauncherService, ObsidianWorkerService } from "./service.js"
import { ObsidianBrowserCommands } from './browserCommands.js'
import { ObsidianServiceOptions } from "./types.js"

/**
 * Starts an Obsidian instance for WDIO standalone mode.
 * 
 * For testing, you'll usually want to use the WDIO testrunner with Mocha, wdio.conf.mts, etc. to launch WDIO. However
 * if you want to use WDIO for some kind of scripting scenario, you can use this function to launch a WDIO standalone
 * session connected to Obsidian.
 * 
 * See also: https://webdriver.io/docs/setuptypes/#standalone-mode
 * 
 * Example:
 * ```ts
 * const browser = await startWdioSession({
 *     capabilities: {
 *         browserName: "obsidian",
 *         browserVersion: "latest",
 *         'wdio:obsidianOptions': {
 *             installerVersion: "latest",
 *             vault: "./test/vaults/basic",
 *         },
 *     },
 * });
 * await browser.executeObsidian(({app}) => {
 *     // extract some file metadata, edit the vault, etc...
 * });
 * await browser.deleteSession();
 * ```
 * 
 * Note that in standalone mode, the global `obsidianPage` instance won't work, you have to use
 * {@link ObsidianBrowserCommands.getObsidianPage | getObsidianPage} to get the page object, e.g.:
 * ```js
 * const obsidianPage = browser.getObsidianPage()
 * ```
 * instead of the 
 * @category WDIO Helpers
 */
export async function startWdioSession(
    params: Capabilities.WebdriverIOConfig,
    serviceOptions?: ObsidianServiceOptions,
): Promise<WebdriverIO.Browser> {
    serviceOptions = serviceOptions ?? {};
    const capabilities = params.capabilities as WebdriverIO.Capabilities;
    const testRunnerOptions: Options.Testrunner = {
        cacheDir: params.cacheDir,
    };
    const launcherService = new ObsidianLauncherService(
        serviceOptions,
        [capabilities] as WebdriverIO.Capabilities,
        testRunnerOptions,
    );
    const workerService = new ObsidianWorkerService(serviceOptions, capabilities, testRunnerOptions);

    await launcherService.onPrepare(testRunnerOptions, [capabilities]);
    await workerService.beforeSession(testRunnerOptions, capabilities);

    const browser = await remote(params);

    await workerService.before(capabilities, [], browser);

    return browser;
}
