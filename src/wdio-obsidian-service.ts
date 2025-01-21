import fsAsync from "fs/promises"
import path from "path"
import { SevereServiceError } from 'webdriverio'
import type { Capabilities, Options, Services } from '@wdio/types'
import { ObsidianLauncher } from "./obsidianUtils.js"
import browserCommands from "./browserCommands.js"
import { ObsidianCapabilityOptions, ObsidianServiceOptions, OBSIDIAN_CAPABILITY_KEY } from "./types.js"


export class ObsidianLauncherService implements Services.ServiceInstance {
    private obsidianLauncher: ObsidianLauncher

    constructor (
        public options: ObsidianServiceOptions,
        public capabilities: WebdriverIO.Capabilities,
        public config: Options.Testrunner
    ) {
        this.obsidianLauncher = new ObsidianLauncher(config.cacheDir, options.obsidianVersionsUrl);
    }


    async onPrepare(config: Options.Testrunner, capabilities: Capabilities.TestrunnerCapabilities) {
        if (!Array.isArray(capabilities)) {
            capabilities = Object.values(capabilities as Capabilities.RequestedMultiremoteCapabilities).map(
                (multiremoteOption) => (multiremoteOption as Capabilities.WithRequestedCapabilities).capabilities,
            );
        }

        const obsidianCapabilities = capabilities.flatMap((cap) => {
            if (("browserName" in cap) && cap.browserName === "obsidian") {
                return [cap as WebdriverIO.Capabilities];
            } else {
                return [];
            }
        });

        try {
            await this.obsidianLauncher.downloadVersions();

            for (const cap of obsidianCapabilities) {
                const obsidianOptions = cap[OBSIDIAN_CAPABILITY_KEY] ?? {};
    
                const appVersion = cap.browserVersion ?? "latest";
                const installerVersion = obsidianOptions.installerVersion ?? "earliest";
                const vault = obsidianOptions.vault != undefined ? path.resolve(obsidianOptions.vault) : undefined;
    
                const {
                    appVersionInfo, installerVersionInfo,
                } = await this.obsidianLauncher.resolveVersions(appVersion, installerVersion);
    
                let installerPath = obsidianOptions.binaryPath;
                if (!installerPath) {
                    installerPath = await this.obsidianLauncher.downloadInstaller(installerVersionInfo.version);
                }
                let appPath = obsidianOptions.appPath;
                if (!appPath) {
                    appPath = await this.obsidianLauncher.downloadApp(appVersionInfo.version);
                }
                let chromedriverPath = cap['wdio:chromedriverOptions']?.binary
                // wdio can download chromedriver for versions greater than 115 automatically
                if (!chromedriverPath && Number(installerVersionInfo.chromeVersion!.split(".")[0]) <= 115) {
                    chromedriverPath = await this.obsidianLauncher.downloadChromedriver(installerVersion);
                }
    
                cap.browserName = "chrome";
                cap.browserVersion = installerVersionInfo.chromeVersion;
                cap[OBSIDIAN_CAPABILITY_KEY] = {
                    plugins: ["."],
                    ...obsidianOptions,
                    binaryPath: installerPath,
                    appPath: appPath,
                    vault: vault,
                    appVersion: appVersionInfo.version, // Resolve the versions
                    installerVersion: installerVersionInfo.version,
                };
                cap['goog:chromeOptions'] = {
                    binary: installerPath,
                    windowTypes: ["app", "webview"],
                    ...cap['goog:chromeOptions'],
                }
                cap['wdio:chromedriverOptions'] = {
                    // allowedIps is not included in the types, but gets passed as --allowed-ips to chromedriver.
                    // It defaults to ["0.0.0.0"] which makes Windows Firewall complain, and we don't need remote
                    // connections anyways.
                    allowedIps: [],
                    ...cap['wdio:chromedriverOptions'],
                    binary: chromedriverPath,
                } as any
                cap["wdio:enforceWebDriverClassic"] = true;
            }
        } catch (e: any) {
            // By default wdio just logs service errors, throwing this makes it bail if anything goes wrong.
            throw new SevereServiceError(`Failed to download and setup Obsidian. Caused by: ${e.stack}\n`+
                                         ` ------The above causes:-----`);
        }
    }
}

export class ObsidianWorkerService implements Services.ServiceInstance {
    private obsidianLauncher: ObsidianLauncher
    /** Directories to clean up after the tests */
    private tmpDirs: string[]

    constructor (
        public options: ObsidianServiceOptions,
        public capabilities: WebdriverIO.Capabilities,
        public config: Options.Testrunner
    ) {
        this.obsidianLauncher = new ObsidianLauncher(config.cacheDir, options.obsidianVersionsUrl);
        this.tmpDirs = [];
    }

    private async setupObsidian(obsidianOptions: ObsidianCapabilityOptions) {
        if (obsidianOptions.vault != undefined) {
            console.log(`Opening vault ${obsidianOptions.vault}`);
        }
        const tmpDir = await this.obsidianLauncher.setup({
            appVersion: obsidianOptions.appVersion!, installerVersion: obsidianOptions.installerVersion!,
            appPath: obsidianOptions.appPath!, vault: obsidianOptions.vault, plugins: obsidianOptions.plugins,
        });
        this.tmpDirs.push(tmpDir);
        return tmpDir;
    }

    private async waitForReady(browser: WebdriverIO.Browser) {
        if ((await browser.getVaultPath()) != undefined) {
            await browser.execute(`
                await new Promise((resolve) => { app.workspace.onLayoutReady(resolve) });
            `)
        }
    }

    async beforeSession(config: Options.Testrunner, capabilities: WebdriverIO.Capabilities) {
        if (!capabilities[OBSIDIAN_CAPABILITY_KEY]) return;

        const tmpDir = await this.setupObsidian(capabilities[OBSIDIAN_CAPABILITY_KEY]);

        capabilities['goog:chromeOptions']!.args = [
            `--user-data-dir=${tmpDir}/config`,
            ...(capabilities['goog:chromeOptions']!.args ?? [])
        ];
    }

    async before(capabilities: WebdriverIO.Capabilities, specs: never, browser: WebdriverIO.Browser) {
        if (!capabilities[OBSIDIAN_CAPABILITY_KEY]) return;

        const service = this; // eslint-disable-line @typescript-eslint/no-this-alias
        await browser.addCommand("openVault", async function(this: WebdriverIO.Browser, vault?: string, plugins?: string[]) {
            const oldObsidianOptions = this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY];
            const newObsidianOptions = {
                ...oldObsidianOptions,
                vault: vault != undefined ? path.resolve(vault) : oldObsidianOptions.vault,
                plugins: plugins ?? oldObsidianOptions.plugins,
            }

            const tmpDir = await service.setupObsidian(newObsidianOptions);
            
            const newArgs = [
                `--user-data-dir=${tmpDir}/config`,
                ...this.requestedCapabilities['goog:chromeOptions'].args.filter((arg: string) => {
                    const match = arg.match(/^--user-data-dir=(.*)\/config$/);
                    return !service.tmpDirs.includes(match?.[1] ?? '');
                }),
            ]

            // Reload session already merges with existing settings, and tries to restart the driver entirely if you
            // set browserName explicitly instead of letting it keep existing.
            const sessionId = await this.reloadSession({
                [OBSIDIAN_CAPABILITY_KEY]: newObsidianOptions,
                'goog:chromeOptions': {
                    ...this.requestedCapabilities['goog:chromeOptions'],
                    args: newArgs,
                },
            });
            await service.waitForReady(this);

            return sessionId;
        });

        for (const [name, cmd] of Object.entries(browserCommands)) {
            await browser.addCommand(name, cmd);
        }

        await service.waitForReady(browser);
    }

    async afterSession() {
        for (const tmpDir of this.tmpDirs) {
            await fsAsync.rm(tmpDir, { recursive: true, force: true });
        }
    }
}

export default ObsidianWorkerService;
export const launcher = ObsidianLauncherService;
