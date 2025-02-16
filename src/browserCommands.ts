import { OBSIDIAN_CAPABILITY_KEY } from "./types.js";
import type * as obsidian from "obsidian"


type ExecuteObsidianArg = {
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
    /** Returns the Obsidian version this test is running under. */
    async getObsidianVersion(this: WebdriverIO.Browser): Promise<string> {
        return this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].appVersion;
    },

    /** Returns the Obsidian installer version this test is running under. */
    async getObsidianInstallerVersion(this: WebdriverIO.Browser): Promise<string> {
        return this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].installerVersion;
    },

    /** Returns the path to the vault opened in Obsidian */
    async getVaultPath(this: WebdriverIO.Browser): Promise<string|undefined> {
        return this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].vault;
    },

    /**
     * Wrapper around browser.execute that passes the Obsidian API to the function. The function will be run inside
     * Obsidian. The first argument to the function is an object containing keys:
     * - app: Obsidian app instance
     * - obsidian: Full Obsidian API
     * See also: https://webdriver.io/docs/api/browser/execute
     * 
     * Example usage
     * ```ts
     * const file = browser.executeObsidian(({app, obsidian}, path) => {
     *      return app.vault.getMarkdownFiles().find(f => f.path == path)
     * })
     * ```
     */
    async executeObsidian<Return, Params extends unknown[]>(
        func: (obs: ExecuteObsidianArg, ...params: Params) => Return,
        ...params: Params
    ): Promise<Return> {
        return await browser.execute<Return, Params>(
            `
                const obs = {
                    app: window._wdioObsidianService.app,
                    obsidian: window._wdioObsidianService.obsidian,
                };
                const func = (${func.toString()});
                return func(obs, ...arguments);
            `,
            ...params,
        )
    },

    /** Enables a plugin */
    async enablePlugin(this: WebdriverIO.Browser, pluginId: string): Promise<void> {
        await this.executeObsidian(
            async ({app}, pluginId) => await (app as any).plugins.enablePluginAndSave(pluginId),
            pluginId,
        );
    },

    /** Disables a plugin */
    async disablePlugin(this: WebdriverIO.Browser, pluginId: string): Promise<void> {
        await this.executeObsidian(
            async ({app}, pluginId) => await (app as any).plugins.disablePluginAndSave(pluginId),
            pluginId,
        );
    },

    /**
     * Executes an Obsidian command.
     * @param id Id of the command to run.
     */
    async executeObsidianCommand(this: WebdriverIO.Browser, id: string) {
        const result = await this.executeObsidian(({app}, id) => (app as any).commands.executeCommandById(id), id);
        if (!result) {
            throw Error(`Obsidian command ${id} not found or failed.`);
        }
    },
} as const

export type ObsidianBrowserCommands = typeof browserCommands;
export default browserCommands;
