import path from "path";
import { describe, it } from "mocha";
import { expect } from "chai";
import { startWdioSession } from "wdio-obsidian-service"
import { fileURLToPath, pathToFileURL } from "url"

const workspacePath = path.resolve(fileURLToPath(import.meta.url), "../../../../..")
const cacheDir = path.join(workspacePath, ".obsidian-cache");
const obsidianVersionsJson = path.join(workspacePath, "obsidian-versions.json");
const obsidianServiceOptions = {
    versionsUrl: pathToFileURL(obsidianVersionsJson).toString(),
}

describe("standalone mode test", function() {
    let browser: WebdriverIO.Browser|undefined;
    before(async function() {
        this.timeout("10m");
        browser = await startWdioSession({
            capabilities: {
                browserName: "obsidian",
                browserVersion: "latest",
                'wdio:obsidianOptions': {
                    installerVersion: "latest",
                    plugins: [
                        "./test/plugins/basic-plugin",
                    ],
                    vault: "./test/vaults/basic",
                },
            },
            cacheDir: cacheDir,
            logLevel: "warn",
        }, obsidianServiceOptions)
    });
    after(async function() {
        await browser?.deleteSession();
    });
    this.timeout("30s");

    it("basic", async function() {
        const vaultPath = await browser!.executeObsidian(({app}) => (app.vault.adapter as any).getFullPath(""));
        expect(path.basename(vaultPath)).to.match(/^basic-/);
    });
})
