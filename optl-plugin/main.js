/** Plugin that is automatically loaded during tests and sets up some global variables. */
const obsidian = require('obsidian');

class OPTLPlugin extends obsidian.Plugin {
    async onload() {
        window.optl = {
            app: this.app,
            obsidian: obsidian,
        }
    };
}

module.exports = OPTLPlugin;
