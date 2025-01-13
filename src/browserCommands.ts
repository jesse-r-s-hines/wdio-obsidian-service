const browserCommands = {
    /** Returns the Obsidian version this test is running under. */
    getObsidianVersion(this: WebdriverIO.Browser): string {
        return this.requestedCapabilities['wdio:obsidianOptions'].appVersion;
    },

    /** Returns the Obsidian installer version this test is running under. */
    getObsidianInstallerVersion(this: WebdriverIO.Browser): string {
        return this.requestedCapabilities['wdio:obsidianOptions'].installerVersion;
    },

    /**
     * Executes an Obsidian command.
     * @param id Id of the command to run.
     */
    async executeObsidianCommand(this: WebdriverIO.Browser, id: string) {
        await this.execute("app.commands.executeCommandById(arguments[0])", [id]);
    },
} as const

export type ObsidianBrowserCommands = typeof browserCommands;
export default browserCommands;
