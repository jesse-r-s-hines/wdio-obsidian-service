/** Plugin that is automatically loaded during tests and sets up some global variables. */
const obsidian = require('obsidian');

class WdioObsidianServicePlugin extends obsidian.Plugin {
    async onload() {
        const globals = {
            app: this.app,
            obsidian: obsidian,
        }

        window.wdioObsidianService = globals;
        // pop-out windows have separate window objects so the globals don't tranfer by default. webdriverio normally
        // executes in the main window but you can switch that with `switchWindow`. Here we add the global to all
        // windows so executeObsidian still works.
        this.registerEvent(this.app.workspace.on("window-open", (win) => {
            win.win.wdioObsidianService = globals;
        }))
    };
}

module.exports = WdioObsidianServicePlugin;
