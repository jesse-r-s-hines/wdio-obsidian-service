import { OBSIDIAN_CAPABILITY_KEY } from "./types.js";
import type * as obsidian from "obsidian"
import obsidianPage, { ObsidianPage } from "./pageobjects/obsidianPage.js"

/**
 * Argument passed to the `executeObsidian` browser command.
 */
export type ExecuteObsidianArg = {
    /**
     * There is a global "app" instance, but that may be removed in the future so you can use this to access it from
     * tests. See https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines#Avoid+using+global+app+instance
     */
    app: obsidian.App,

    /**
     * The full obsidian API. See https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts
     */
    obsidian: typeof obsidian,
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
        func: (obs: ExecuteObsidianArg, ...params: Params) => Return,
        ...params: Params
    ): Promise<Return> {
        return await browser.execute<Return, Params>(
            `return (${func.toString()}).call(null, {...window.wdioObsidianService}, ...arguments)`,
            ...params,
        )
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
     * Returns the path to the vault opened in Obsidian.
     * 
     * wdio-obsidian-service copies your vault before running tests, so this is the path to the temporary copy.
     */
    async getVaultPath(this: WebdriverIO.Browser): Promise<string|undefined> {
        if (this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].vault == undefined) {
            return undefined; // no vault open
        } else { // return the actual path to the vault
            return await this.executeObsidian(({app, obsidian}) => {
                if (app.vault.adapter instanceof obsidian.FileSystemAdapter) {
                    return app.vault.adapter.getBasePath()
                } else { // TODO handle CapacitorAdapater
                    throw new Error(`Unrecognized DataAdapater type`)
                };
            })
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
    }
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
