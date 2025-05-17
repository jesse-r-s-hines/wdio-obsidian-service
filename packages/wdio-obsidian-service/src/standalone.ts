import { remote } from 'webdriverio'
import type { Capabilities, Options } from '@wdio/types'
import { ObsidianLauncherService, ObsidianWorkerService } from "./service.js"
import { ObsidianServiceOptions } from "./types.js"

/**
 * Starts an Obsidian instance for WDIO standalone mode.
 * 
 * For testing, you'll usually want to use the WDIO testrunner with Mocha, wdio.conf.ts, etc. to launch WDIO. However if
 * you want to use WDIO for some kind of scripting scenario, you can use this function to launch a WDIO standalone
 * session connected to Obsidian.
 * 
 * See also: https://webdriver.io/docs/setuptypes/#standalone-mode
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
    const launcherService = new ObsidianLauncherService(serviceOptions, [capabilities] as any, testRunnerOptions);
    const workerService = new ObsidianWorkerService(serviceOptions, capabilities, testRunnerOptions);

    await launcherService.onPrepare(testRunnerOptions, [capabilities]);
    await workerService.beforeSession(testRunnerOptions, capabilities);

    const browser = await remote(params);

    await workerService.before(capabilities, [], browser);

    return browser;
}
