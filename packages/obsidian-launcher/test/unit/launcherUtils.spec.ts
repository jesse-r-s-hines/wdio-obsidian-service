import { describe, it } from "mocha";
import { expect } from "chai";
import { normalizeGitHubRepo, parseObsidianDesktopRelease } from "../../src/launcherUtils.js";

describe('launcherUtils', () => {
    [
        ["SilentVoid13/Templater", "SilentVoid13/Templater"],
        ["https://github.com/Vinzent03/obsidian-git", "Vinzent03/obsidian-git"],
        ["github.com/Vinzent03/obsidian-git", "Vinzent03/obsidian-git"],
        ["http://github.com/SilentVoid13/Templater/", "SilentVoid13/Templater"],
    ].forEach(([input, expected]) => {
        it(`normalizeGithubRepo("${input}")`, async () => {
            expect(normalizeGitHubRepo(input)).to.eql(expected);
        })
    });

    [
        [{
            minimumVersion: "0.14.5",
            latestVersion: "1.8.10",
            downloadUrl: "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.8.10/obsidian-1.8.10.asar.gz",
            beta: {
                minimumVersion: "0.14.5",
                latestVersion: "1.9.7",
                downloadUrl: "https://releases.obsidian.md/release/obsidian-1.9.7.asar.gz",
                hash: "7QxsR8DrrT4shE6jSLTsBUtCrqhvZvAJ0EHfhm1svvE=",
                signature: "HRWVLDqOqwVZPC5g/AGXMAdLPl6fnmQjFgZnEp28aVufTndejOs/BG0v43/Eehd9FpEvgyc5Uh5KYa2S76OCVj6x49930yxGAWsGjtMsk5DTNGvw7G4ENdMu2qQYAoy6kKw0rjgj2MarHFz6xbYxKY5wx1isWSZnaz4MLKADKRXS/Mdn7B56cJmc/F5Yn0l1Dd/wgQzI3rukxpzTAcGUjNk/Oits+fQFurNJ40ZRuIpDClkebnI61Rg1LrvFOBdqpe7YWWZgPr6lhd+ng+VhCNLuUviFH7tA4sIgFoauMTXHMf6fvlwqVKhZ0f+9YKJ9/C4IcrMwCIbuuFph42wJCg=="
            }
        }, {
            current: {
                downloads: {
                    asar: "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.8.10/obsidian-1.8.10.asar.gz"
                },
                isBeta: false,
                minInstallerVersion: "1.1.9",
                version: "1.8.10",
            },
            beta: {
                downloads: {
                    "asar": "https://releases.obsidian.md/release/obsidian-1.9.7.asar.gz"
                },
                isBeta: true,
                minInstallerVersion: "1.1.9",
                version: "1.9.7",
            },
        }], [{
            minimumVersion: "0.14.5",
            latestVersion: "1.8.10",
            downloadUrl: "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.8.10/obsidian-1.8.10.asar.gz",
            beta: {
                minimumVersion: "0.14.5",
                latestVersion: "1.8.10",
                downloadUrl: "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.8.10/obsidian-1.8.10.asar.gz",
            },
        }, {
            current: {
                downloads: {
                    asar: "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.8.10/obsidian-1.8.10.asar.gz",
                },
                isBeta: false,
                minInstallerVersion: "1.1.9",
                version: "1.8.10",
            },
        }], [{
            minimumVersion: "0.0.0",
            latestVersion: "0.5.0",
            downloadUrl: "https://github.com/obsidianmd/obsidian-releases/releases/download/v0.5.0/obsidian-0.5.0.asar.gz",
        }, {
            current: {
                downloads: {
                    asar: "https://github.com/obsidianmd/obsidian-releases/releases/download/v0.5.0/obsidian-0.5.0.asar.gz"
                },
                isBeta: false,
                minInstallerVersion: undefined,
                version: "0.5.0",
            },
        }]
    ].forEach(([input, expected]) => {
        it(`parseObsidianDesktopRelease(${JSON.stringify(input)})`, async () => {
            expect(parseObsidianDesktopRelease(input)).to.eql(expected);
        })
    })
});
