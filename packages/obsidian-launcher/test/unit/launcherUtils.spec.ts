import { describe, it } from "mocha";
import { expect } from "chai";
import path from "path";
import {
    normalizeGitHubRepo, ParsedDesktopRelease, parseObsidianDesktopRelease, updateObsidianVersionList,
} from "../../src/launcherUtils.js";
import fsAsync from "fs/promises";
import _ from "lodash";
import { DeepPartial } from "ts-essentials";
import { ObsidianVersionInfo } from "../../src/types.js";
import { ObsidianDesktopRelease } from "../../src/obsidianTypes.js";


function compareVersionLists(actual: DeepPartial<ObsidianVersionInfo>[], expected: DeepPartial<ObsidianVersionInfo>[]) {
    expect(actual.map(v => v.version)).to.eql(expected.map(v => v.version));
    for (let i = 0; i < actual.length; i++) {
        expect(actual[i]).to.eql(expected[i]);
        expect(JSON.stringify(actual[i])).to.eql(JSON.stringify(expected[i]));
    }
}

async function readJson(name: string) {
    const filePath = path.resolve("./test/data", name) + ".json";
    return JSON.parse(await fsAsync.readFile(filePath, 'utf-8'));

}

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

    const parseObsidianDesktopReleaseTests: [ObsidianDesktopRelease, ParsedDesktopRelease][] = [
        [{
            minimumVersion: "0.14.5",
            latestVersion: "1.8.10",
            downloadUrl: "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.8.10/obsidian-1.8.10.asar.gz",
            hash: "",
            signature: "",
            beta: {
                minimumVersion: "0.14.5",
                latestVersion: "1.9.7",
                downloadUrl: "https://releases.obsidian.md/release/obsidian-1.9.7.asar.gz",
                hash: "",
                signature: ""
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
            hash: "",
            signature: "",
            beta: {
                minimumVersion: "0.14.5",
                latestVersion: "1.8.10",
                downloadUrl: "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.8.10/obsidian-1.8.10.asar.gz",
                hash: "",
                signature: "",
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
            hash: "",
            signature: "",
        }, {
            current: {
                downloads: {
                    asar: "https://github.com/obsidianmd/obsidian-releases/releases/download/v0.5.0/obsidian-0.5.0.asar.gz"
                },
                isBeta: false,
                minInstallerVersion: undefined,
                version: "0.5.0",
            },
        }],
    ];
    parseObsidianDesktopReleaseTests.forEach(([input, expected]) => {
        it(`parseObsidianDesktopRelease(${JSON.stringify(input)})`, async () => {
            expect(parseObsidianDesktopRelease(input)).to.eql(expected);
        })
    })

    it("updateObsidianVersionList no change", async function () {
        const sampleObsidianVersions = await readJson("sample-obsidian-versions");
        const actual = updateObsidianVersionList({
            original: sampleObsidianVersions.versions,
        });
        compareVersionLists(actual, sampleObsidianVersions.versions);
    })

    it("updateObsidianVersionList new versions", async function () {
        const sampleObsidianVersions = await readJson("sample-obsidian-versions");
        const newObsidianVersions = await readJson("new-obsidian-versions");
        const actual = updateObsidianVersionList({
            original: sampleObsidianVersions.versions,
            destkopReleases: await readJson("new-desktop-releases"),
            gitHubReleases: await readJson("new-github-releases"),
            installerInfos: await readJson('new-installer-infos'),
        });
        compareVersionLists(actual, sampleObsidianVersions.versions.concat(newObsidianVersions));
    })

    it("updateObsidianVersionList no installer infos", async function () {
        const sampleObsidianVersions = await readJson("sample-obsidian-versions");
        const newObsidianVersions = await readJson("new-obsidian-versions");
        const actual = updateObsidianVersionList({
            original: sampleObsidianVersions.versions,
            destkopReleases: await readJson("new-desktop-releases"),
            gitHubReleases: await readJson("new-github-releases"),
        });
        compareVersionLists(actual, [
            ...sampleObsidianVersions.versions,
            ...newObsidianVersions.map((v: any) => _.omit(
                {...v, installers: _.mapValues(v.installers, i => ({digest: i!.digest}))},
                ["electronVersion", "chromeVersion"],
            )),
        ]);
    })

    it("updateObsidianVersionList change installer info", async function () {
        const sampleObsidianVersions = await readJson("sample-obsidian-versions");
        const newObsidianVersions = await readJson("new-obsidian-versions");
        const newGithubReleases = await readJson("new-github-releases");
        const asset = newGithubReleases.at(-1).assets.find((a: any) => a.name == "Obsidian-1.8.9-arm64.AppImage")!
        asset.digest = 'sha256:deadbeaf';
        const actual = updateObsidianVersionList({
            original: sampleObsidianVersions.versions.concat(newObsidianVersions),
            destkopReleases: [],
            gitHubReleases: newGithubReleases,
        });
        const expected: DeepPartial<ObsidianVersionInfo>[] = sampleObsidianVersions.versions.concat(newObsidianVersions);
        const version = expected.find(v => v.version == "1.8.9")!;
        version.installers!.appImageArm = {digest: 'sha256:deadbeaf'}
        compareVersionLists(actual, expected);
    })
});
