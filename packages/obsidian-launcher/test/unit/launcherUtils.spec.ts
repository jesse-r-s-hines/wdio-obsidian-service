import { describe, it } from "mocha";
import { expect } from "chai";
import path from "path";
import {
    normalizeGitHubRepo, ParsedDesktopRelease, parseObsidianDesktopRelease, updateObsidianVersionList, GitHubRelease,
    extractInstallerInfo, checkCompatibility,
} from "../../src/launcherUtils.js";
import fs from "fs";
import fsAsync from "fs/promises";
import semver from "semver"
import _ from "lodash";
import { ObsidianVersionInfo, ObsidianVersionList } from "../../src/types.js";
import { ObsidianDesktopRelease } from "../../src/obsidianTypes.js";


function compareVersionLists(actual: ObsidianVersionInfo[], expected: ObsidianVersionInfo[]) {
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
                version: "1.8.10",
            },
            beta: {
                downloads: {
                    "asar": "https://releases.obsidian.md/release/obsidian-1.9.7.asar.gz"
                },
                isBeta: true,
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
                version: "0.5.0",
            },
        }],
    ];
    parseObsidianDesktopReleaseTests.forEach(([input, expected]) => {
        it(`parseObsidianDesktopRelease(${JSON.stringify(input)})`, async () => {
            expect(parseObsidianDesktopRelease(input)).to.eql(expected);
        })
    })
})

describe("updateObsidianVersionList", function() {
    const obsidianVersionsPath = path.resolve("../../obsidian-versions.json");
    const fullVersionList: ObsidianVersionList = JSON.parse(fs.readFileSync(obsidianVersionsPath, 'utf-8'));
    const fullVersionsMap = _.keyBy(fullVersionList.versions, v => v.version);
    const timestamp = new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago

    async function updateObsidianVersionListMocked(
        original: ObsidianVersionInfo[]|undefined,
        opts: {
            destkopReleases: ObsidianDesktopRelease[],
            githubReleases: GitHubRelease[],
            _extractInstallerInfo?: typeof extractInstallerInfo,
            _checkCompatibility?: typeof checkCompatibility,
        },
    ) {
        const { destkopReleases, githubReleases, _extractInstallerInfo, _checkCompatibility } = opts;
        const metadata = { // dummy metadata
            schemaVersion: "2.0.0",
            commitDate: "1970-01-01T00:00:00Z",
            commitSha: "0000000000000000000000000000000000000000",
            timestamp: timestamp,
        }
        return await updateObsidianVersionList(
            original ? {metadata, versions: original} : undefined,
            {
                maxInstances: 1,
                _fetchObsidianDesktopReleases: async () => [destkopReleases, {
                    commitDate: "1970-01-01T00:00:00Z",
                    commitSha: "0000000000000000000000000000000000000000",
                }],
                _fetchObsidianGitHubReleases: async () => githubReleases,
                // these are tested individually elsewhere, we'll mock them in these tests so we can run them quickly
                // without downloading or launching obsidian.
                _extractInstallerInfo: _extractInstallerInfo ?? (async (version, key) => {
                    const installerInfo = fullVersionsMap[version].installers[key];
                    if (!installerInfo) {
                        throw Error(`No installer info for ${version} found`);
                    }
                    return installerInfo;
                }),
                _checkCompatibility: _checkCompatibility ?? (async (_, appVersion, installerVersion) => {
                    if (!fullVersionsMap[appVersion].minInstallerVersion) {
                        throw Error(`No minInstallerVersion for ${appVersion}`);
                    }
                    return semver.gte(installerVersion, fullVersionsMap[appVersion].minInstallerVersion);
                }),
            },
        );
    }

    it("basic", async function() {
        // regression test, make sure that updateVersionList matches up with our obsidian-versions.json
        const expected = fullVersionList.versions.filter(v => semver.lte(v.version, '1.4.16'));
        const actual = await updateObsidianVersionListMocked(undefined, {
            destkopReleases: await readJson("desktop-releases-1"),
            githubReleases: await readJson("github-releases-1"),
        });
        compareVersionLists(actual.versions, expected);
    });

    it("update existing", async function() {
        const original = fullVersionList.versions.filter(v => semver.lte(v.version, '1.4.16'));
        const expected = fullVersionList.versions.filter(v => semver.lte(v.version, '1.5.3'));
        const actual = await updateObsidianVersionListMocked(original, {
            destkopReleases: await readJson("desktop-releases-2"),
            githubReleases: [...await readJson("github-releases-1"), ...await readJson("github-releases-2")],
        });
        compareVersionLists(actual.versions, expected);
        expect(new Date(actual.metadata.timestamp)).to.be.gt(new Date(timestamp));
    });

    it("release beta", async function() {
        const original = fullVersionList.versions.filter(v => semver.lte(v.version, '1.4.16'));
        original[original.length - 1] = {
            "version": "1.4.16",
            "minInstallerVersion": "1.4.13",
            "maxInstallerVersion": "1.4.14",
            "isBeta": true,
            "downloads": {
                "asar": "https://releases.obsidian.md/release/obsidian-1.4.16.asar.gz"
            },
            "installers": {}
        };
        const expected = fullVersionList.versions.filter(v => semver.lte(v.version, '1.4.16'));
        const actual = await updateObsidianVersionListMocked(original, {
            destkopReleases: [{
                minimumVersion: "0.14.5",
                latestVersion: "1.4.16",
                downloadUrl: "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.4.16/obsidian-1.4.16.asar.gz",
                hash: "deadbeaf",
                signature: "deadbeaf",
                beta: {
                    minimumVersion: "0.14.5",
                    latestVersion: "1.4.16",
                    downloadUrl: "https://github.com/obsidianmd/obsidian-releases/releases/download/v1.4.16/obsidian-1.4.16.asar.gz",
                    hash: "deadbeaf",
                    signature: "deadbeaf"
                }
            }],
            githubReleases: await readJson("github-releases-1"),
        });
        compareVersionLists(actual.versions, expected);
        expect(new Date(actual.metadata.timestamp)).to.be.gt(new Date(timestamp));
    });

    it("no change", async function() {
        const original = fullVersionList.versions.filter(v => semver.lte(v.version, '1.4.16'));
        const actual = await updateObsidianVersionListMocked(original, {
            destkopReleases: await readJson("desktop-releases-1"),
            githubReleases: await readJson("github-releases-1"),
        });
        compareVersionLists(actual.versions, original);
        expect(actual.metadata.timestamp).to.eql(timestamp);
    });

    it("no change 2", async function() {
        const original = fullVersionList.versions.filter(v => semver.lte(v.version, '1.4.16'));
        const actual = await updateObsidianVersionListMocked(original, {
            destkopReleases: [],
            githubReleases: [],
        });
        compareVersionLists(actual.versions, original);
        expect(actual.metadata.timestamp).to.eql(timestamp);
    });

    it("changed installer", async function() {
        const original = fullVersionList.versions.filter(v => semver.lte(v.version, '1.4.16'));
        const githubReleases: GitHubRelease[] = await readJson("github-releases-1");
        const asset = githubReleases.at(-1)!.assets.find(a => a.name.match(/-arm64.AppImage$/))!;

        asset.digest = "sha256:012345678";
        const actual = await updateObsidianVersionListMocked(original, {
            destkopReleases: [],
            githubReleases: githubReleases,
            _extractInstallerInfo: async () => ({
                electron: "999.0.0", chrome: "999.0.0.0",
                platforms: ["linux-arm64"],
            })
        });
        const expected = _.cloneDeep(original);
        expected.at(-1)!.installers.appImageArm = {
            digest: "sha256:012345678",
            electron: "999.0.0", chrome: "999.0.0.0",
            platforms: ["linux-arm64"],
        };

        // should update the installer with the changed digest. Should only call extractInstallerInfo once.
        compareVersionLists(actual.versions, expected);
        expect(new Date(actual.metadata.timestamp)).to.be.gt(new Date(timestamp));
    });
});
