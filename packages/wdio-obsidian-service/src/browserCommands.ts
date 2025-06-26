import type * as obsidian from "obsidian"
import { ObsidianPage } from "./pageobjects/obsidianPage.js"
import { NormalizedObsidianCapabilityOptions, OBSIDIAN_CAPABILITY_KEY } from "./types.js";

export const asyncBrowserCommands = {
    /**
     * Wrapper around browser.execute that passes the Obsidian API to the function. The first argument to the function
     * is an object containing keys:
     * - app: Obsidian app instance
     * - obsidian: Full Obsidian API
     * - plugins: Object of all installed plugins, mapped by plugin id converted to camelCase.
     * - require: The customized require function Obsidian makes available to plugins. This is also available globally,
     *            so you can just use `require` directly instead of from {@link ExecuteObsidianArg} if you prefer.
     * 
     * Like `brower.execute`, you can pass other extra arguments to the function.
     * 
     * See also: https://webdriver.io/docs/api/browser/execute
     * 
     * Example usage
     * ```ts
     * const file = browser.executeObsidian(({app, obsidian}, path) => {
     *      return app.vault.getMarkdownFiles().find(f => f.path == path);
     * })
     * ```
     * 
     * Note: The same caveats as `browser.execute` apply. The function will be stringified and then run inside Obsidian,
     * so you can't capture any local variables. E.g.
     * 
     * This *won't* work:
     * ```ts
     * import { FileView } from "obsidian"
     * browser.executeObsidian(({app}) => {
     *     if (leaf.view instanceof FileView) {
     *         ...
     *     }
     * })
     * ```
     * do this instead:
     * ```ts
     * browser.executeObsidian(({app, obsidian}) => {
     *     if (leaf.view instanceof obsidian.FileView) {
     *         ...
     *     }
     * })
     * ```
     */
    async executeObsidian<Return, Params extends unknown[]>(
        this: WebdriverIO.Browser,
        func: (obs: ExecuteObsidianArg, ...params: Params) => Return,
        ...params: Params
    ): Promise<Return> {
        const obsidianOptions = this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY] as NormalizedObsidianCapabilityOptions;
        if (obsidianOptions.vault === undefined) {
            throw Error("No vault open, set vault in wdio.conf or use reloadObsidian to open a vault dynamically.")
        }
        return await this.execute<Return, Params>(`
            const require = window.wdioObsidianService().require;
            return (${func.toString()}).call(null, {...window.wdioObsidianService()}, ...arguments)
        `, ...params)
    },

    /**
     * Executes an Obsidian command by id.
     * @param id Id of the command to run.
     */
    async executeObsidianCommand(this: WebdriverIO.Browser, id: string) {
        const result = await this.executeObsidian(({app}, id) => (app as any).commands.executeCommandById(id), id);
        if (!result) {
            throw Error(`Obsidian command ${id} not found or failed.`);
        }
    },
} as const

/** Define this type separately so we can @inline it in typedoc */
type AsyncObsidianBrowserCommands = typeof asyncBrowserCommands;

/**
 * addCommand always makes the command async, we manually add these methods to the browser instance so they can be
 * sync.
 */
export const syncBrowserCommands = {
    /**
     * Returns the Obsidian app version this test is running under.
     */
    getObsidianVersion(this: WebdriverIO.Browser): string {
        const obsidianOptions = this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY] as NormalizedObsidianCapabilityOptions;
        return obsidianOptions.appVersion;
    },
    
    /**
     * Returns the Obsidian installer version this test is running under.
     */
    getObsidianInstallerVersion(this: WebdriverIO.Browser): string {
        const obsidianOptions = this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY] as NormalizedObsidianCapabilityOptions;
        return obsidianOptions.installerVersion;
    },

    /**
     * Returns the ObsidianPage object with convenience helper functions.
     * You can also just import the page object directly with
     * ```ts
     * import { obsidianPage } from "wdio-obsidian-service"
     * ```
     */
    getObsidianPage(this: WebdriverIO.Browser): ObsidianPage {
        return new ObsidianPage(this);
    },
}

/** Define this type separately so we can @inline it in typedoc */
type SyncObsidianBrowserCommands = typeof syncBrowserCommands;

/**
 * Extra commands added to the WDIO Browser instance.
 * 
 * See also: https://webdriver.io/docs/api/browser
 * @interface
 * @category Utilities
 */
export type ObsidianBrowserCommands = AsyncObsidianBrowserCommands & SyncObsidianBrowserCommands & {
    /**
     * Relaunch obsidian. Can be used to switch to a new vault, change the plugin list, or just to reboot Obsidian.
     * 
     * As this does a full reboot of Obsidian, this is rather slow. In many cases you can use {@link ObsidianPage.resetVault}
     * instead, which modifies vault files in place without rebooting Obsidian. If all your tests use the same vault,
     * you can also just set the vault in the `wdio.conf.(m)ts` capabilities section.
     * 
     * @param params.vault Path to the vault to open. The vault will be copied, so any changes made in your tests won't
     *     be persited to the original. If omitted, it will reboot Obsidian with the current vault without creating a
     *     new copy of the vault.
     * @param params.plugins List of plugin ids to enable. If omitted it will keep current plugin list. Note, all the
     *     plugins must be defined in your wdio.conf.ts capabilities. You can also use the enablePlugin and 
     *     disablePlugin commands to change plugins without relaunching Obsidian.
     * @param params.theme Name of the theme to enable. If omitted it will keep the current theme. Pass "default" to
     *     switch back to the default theme. Like with plugins, the theme must be defined in wdio.conf.ts.
     * @returns Returns the new sessionId (same as browser.reloadSession()).
     */
    reloadObsidian(params?: {
        vault?: string,
        plugins?: string[], theme?: string,
    }): Promise<string>;
    // This command is implemented in the service hooks.
};

/**
 * Argument passed to the {@link ObsidianBrowserCommands.executeObsidian | executeObsidian} browser command.
 * @category Types
 */
export interface ExecuteObsidianArg {
    /**
     * There is a global "app" instance, but that may be removed in the future so you can use this to access it from
     * tests. See https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines#Avoid+using+global+app+instance
     */
    app: obsidian.App,

    /**
     * The full obsidian API. See https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts
     */
    obsidian: typeof obsidian,

    /**
     * Object containing all installed plugins mapped by their id. Plugin ids are converted to camelCase for ease of
     * destructuring.
     * 
     * If you want to add typings for your plugin(s) you can use something like this in a `.d.ts`:
     * ```ts
     * import type MyPlugin from "../src/main.js"
     * declare module "wdio-obsidian-service" {
     *     interface InstalledPlugins {
     *         myPlugin: MyPlugin,
     *     }
     * }
     * ```
     */
    plugins: InstalledPlugins,

    /**
     * The customized require function Obsidian makes available to plugins. This is also available globally, so you can
     * just use `require` directly instead of from `ExecuteObsidianArg` if you prefer.
     */
    require: NodeJS.Require,
}

/**
 * Installed plugins, mapped by their id converted to camelCase
 * @category Types
 */
export interface InstalledPlugins extends Record<string, obsidian.Plugin> {
}
