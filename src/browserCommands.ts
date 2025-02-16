import { OBSIDIAN_CAPABILITY_KEY } from "./types.js";

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

    /** Enables a plugin */
    async enablePlugin(this: WebdriverIO.Browser, pluginId: string): Promise<void> {
        await this.execute(
            async (pluginId) => await (optl.app as any).plugins.enablePluginAndSave(pluginId),
            pluginId,
        );
    },

    /** Disables a plugin */
    async disablePlugin(this: WebdriverIO.Browser, pluginId: string): Promise<void> {
        await this.execute(
            async (pluginId) => await (optl.app as any).plugins.disablePluginAndSave(pluginId),
            pluginId,
        );
    },

    /**
     * Executes an Obsidian command.
     * @param id Id of the command to run.
     */
    async executeObsidianCommand(this: WebdriverIO.Browser, id: string) {
        const result = await this.execute((id) => (optl.app as any).commands.executeCommandById(id), id);
        if (!result) {
            throw Error(`Obsidian command ${id} not found or failed.`);
        }
    },
} as const

export type ObsidianBrowserCommands = typeof browserCommands;
export default browserCommands;
