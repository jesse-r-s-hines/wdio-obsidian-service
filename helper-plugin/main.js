/** Plugin that is automatically loaded during tests and sets up some global variables. */
const obsidian = require('obsidian');

class WdioObsidianServicePlugin extends obsidian.Plugin {
    async onload() {
        window._wdioObsidianService = {
            app: this.app,
            obsidian: obsidian,
        }
    };
}

module.exports = WdioObsidianServicePlugin;
