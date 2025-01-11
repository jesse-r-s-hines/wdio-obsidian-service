const browserCommands = {
    /**
     * Executes an Obsidian command.
     * @param id Id of the command to run.
     */
    async executeObsidianCommand(this: WebdriverIO.Browser, id: string) {
        await this.execute("app.commands.executeCommandById(arguments[0])", [id]);
    }
} as const

export type ObsidianBrowserCommands = typeof browserCommands;
export default browserCommands;
