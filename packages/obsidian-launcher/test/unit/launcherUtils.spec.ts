import { describe, it } from "mocha";
import { expect } from "chai";
import { normalizeGitHubRepo } from "../../src/launcherUtils.js";

describe('launcherUtils', () => {
    [
        ["SilentVoid13/Templater", "SilentVoid13/Templater"],
        ["https://github.com/Vinzent03/obsidian-git", "Vinzent03/obsidian-git"],
        ["github.com/Vinzent03/obsidian-git", "Vinzent03/obsidian-git"],
        ["http://github.com/SilentVoid13/Templater/", "SilentVoid13/Templater"],
    ].forEach(([input, expected]) => {
        it(`normalizeGithubRepo("${input}") == "${expected}"`, async () => {
            expect(normalizeGitHubRepo(input)).to.eql(expected);
        })
    })
});
