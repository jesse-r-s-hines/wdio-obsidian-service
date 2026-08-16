import { describe, it } from "mocha";
import { expect } from "chai";
import { loadEnv } from "../../src/utils/misc.js";
import { obsidianApiLogin } from "../../src/apis.js";

loadEnv();

describe("ObsidianLauncher login", function() {
    this.timeout("300s");

    before(async function() {
        if (process.env.TEST_LEVEL != "all" || !process.env.OBSIDIAN_PASSWORD) this.skip();
    })

    it("test login", async function() {
        const token = await obsidianApiLogin({interactive: false});
        expect(!!token).to.eql(true);
    })

    it("test login error", async function() {
        const pwdBefore = process.env.OBSIDIAN_PASSWORD;
        after(() => { process.env.OBSIDIAN_PASSWORD = pwdBefore });
        process.env.OBSIDIAN_PASSWORD = "incorrect-password";
        const result = await obsidianApiLogin({interactive: false}).catch(e => e);
        expect(result).to.be.instanceOf(Error);
        expect(result.toString()).includes("login failed");
    })
})
