import { remote } from 'webdriverio'
import type { Capabilities, Options } from '@wdio/types'
import { ObsidianLauncherService, ObsidianWorkerService } from "./service.js"
import { ObsidianServiceOptions } from "./types.js"

/**
 * Starts an Obsidian instance for WDIO standalone mode. This can be used for making scripts to interact with Obsidian.
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
