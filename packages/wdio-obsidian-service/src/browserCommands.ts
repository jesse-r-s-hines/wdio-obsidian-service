import { OBSIDIAN_CAPABILITY_KEY } from "./types.js";
import type * as obsidian from "obsidian"
import obsidianPage, { ObsidianPage } from "./pageobjects/obsidianPage.js"

/** Installed plugins, mapped by their id converted to camelCase */
export interface InstalledPlugins extends Record<string, obsidian.Plugin> {
}

/**
 * Argument passed to the `executeObsidian` browser command.
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
     * Object containing all installed plugins mapped by their id. Plugin ids are converted to converted to camelCase
     * for ease of destructuring.
     * 
     * You can add types for your plugin(s) here with:
     * ```ts
     * import type MyPlugin from "../src/main.js"
     * declare module "wdio-obsidian-service" {
     *     interface InstalledPlugins {
     *         openTabSettingsPlugin: MyPlugin,
     *     }
     * }
     * ```
     */
    plugins: InstalledPlugins,
}

const browserCommands = {
    /**
     * Returns the Obsidian app version this test is running under.
     */
    async getObsidianVersion(this: WebdriverIO.Browser): Promise<string> {
        return this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].appVersion;
    },

    /**
     * Returns the Obsidian installer version this test is running under.
     */
    async getObsidianInstallerVersion(this: WebdriverIO.Browser): Promise<string> {
        return this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].installerVersion;
    },

    /**
     * Wrapper around browser.execute that passes the Obsidian API to the function. The first argument to the function
     * is an object containing keys:
     * - app: Obsidian app instance
     * - obsidian: Full Obsidian API
     * - plugins: Object of all installed plugins, mapped by plugin id converted to camelCase.
     * 
     * You can use `require` inside the function to fetch Obsidian modules, same as you can inside plugins.
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
     * import { FileView } from Obsidian
     * browser.executeObsidian(({app, obsidian}) => {
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
        if (this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].vault == undefined) {
            throw Error("No vault open")
        }
        return await this.execute<Return, Params>(`
            const require = window.wdioObsidianService.require;
            return (${func.toString()}).call(null, {...window.wdioObsidianService}, ...arguments)
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

    /**
     * Returns the Workspace page object with convenience helper functions.
     * You can also just import the page object directly with
     * ```ts
     * import { obsidianPage } from "wdio-obsidian-service"
     * ```
     */
    async getObsidianPage(this: WebdriverIO.Browser): Promise<ObsidianPage> {
        return obsidianPage;
    },
} as const

/** Define this type separately so we can @inline it in typedoc */
type PlainObsidianBrowserCommands = typeof browserCommands;

/**
 * Extra commands added to the WDIO Browser instance.
 * 
 * See also: https://webdriver.io/docs/api/browser#custom-commands
 * @interface
 */
export type ObsidianBrowserCommands = PlainObsidianBrowserCommands & {
    // This command is implemented in the service hooks.
    /**
     * Relaunch obsidian. Can be used to switch to a new vault, change the plugin list, or just to reboot
     * Obsidian.
     * 
     * As this does a full reboot of Obsidian, avoid calling this too often so you don't slow your tests down.
     * You can also set the vault in the `wdio.conf.ts` capabilities section which may be useful if all your
     * tests use the same vault.
     * 
     * @param params.vault Path to the vault to open. The vault will be copied, so any changes made in your tests won't
     *     be persited to the original. If omitted, it will reboot Obsidian with the current vault, without
     *     creating a new copy of the vault.
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
};
export default browserCommands;
