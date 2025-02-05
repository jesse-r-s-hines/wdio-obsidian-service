import { describe, it } from "mocha";
import { expect } from "chai";
import path from "path"
import fsAsync from "fs/promises"
import { pathToFileURL } from "url";
import semver from "semver";
import { createDirectory } from "../helpers.js"
import { ObsidianDownloader, installPlugins, installThemes, setupConfigAndVault } from "../../src/obsidianUtils.js";
import { fileExists } from "../../src/utils.js";
import { ObsidianVersionInfo } from "../../src/types.js";

const obsidianLauncherOpts = {
    versionsUrl: pathToFileURL("./obsidian-versions.json").toString(),
    communityPluginsUrl: pathToFileURL("./test/data/community-plugins.json").toString(),
    communityThemesUrl: pathToFileURL("./test/data/community-css-themes.json").toString(),
}


describe("installPlugins", () => {
    it("no plugins", async () => {
        const vault = await createDirectory();
        await installPlugins(vault, []);
        const communityPlugins = await fsAsync.readFile(`${vault}/.obsidian/community-plugins.json`, 'utf-8');
        expect(JSON.parse(communityPlugins)).to.eql([]);
    })

    it("empty vault", async () => {
        const plugin = await createDirectory({
            "manifest.json": '{"id": "sample-plugin"}',
            "main.js": "console.log('foo')",
        });
        const vault = await createDirectory();

        await installPlugins(vault, [{path: plugin, enabled: true}]);

        const communityPlugins = await fsAsync.readFile(`${vault}/.obsidian/community-plugins.json`, 'utf-8');
        expect(JSON.parse(communityPlugins)).to.eql(["sample-plugin"]);
        const pluginFiles = await fsAsync.readdir(`${vault}/.obsidian/plugins/sample-plugin`);
        expect(pluginFiles.sort()).to.eql(["main.js", "manifest.json"]);
    })

    it("multiple plugins and existing community-plugins.json", async () => {
        const pluginA = await createDirectory({
            "manifest.json": '{"id": "plugin-a"}',
            "main.js": "console.log('foo')",
        });
        const pluginB = await createDirectory({
            "manifest.json": '{"id": "plugin-b"}',
            "main.js": "console.log('foo')",
            "data.json": "{}",
            "styles.css": "",
            "README.md": "PLUGIN B", // should ignore other files
        });
        const vault = await createDirectory({
            ".obsidian/community-plugins.json": '["dataview", "plugin-b"]',
        });

        await installPlugins(vault, [
            {path: pluginA, enabled: true},
            {path: pluginB, enabled: true},
        ]);

        const communityPlugins = await fsAsync.readFile(`${vault}/.obsidian/community-plugins.json`, 'utf-8');
        expect(JSON.parse(communityPlugins)).to.eql(["dataview", "plugin-b", "plugin-a"]);
        
        const pluginAFiles = await fsAsync.readdir(`${vault}/.obsidian/plugins/plugin-a`);
        expect(pluginAFiles.sort()).to.eql(["main.js", "manifest.json"]);

        const pluginBFiles = await fsAsync.readdir(`${vault}/.obsidian/plugins/plugin-b`);
        expect(pluginBFiles.sort()).to.eql(["data.json", "main.js", "manifest.json", "styles.css"]);
    })

    it("disabled plugins", async () => {
        const pluginA = await createDirectory({
            "manifest.json": '{"id": "plugin-a"}',
            "main.js": "console.log('foo')",
        });
        const pluginB = await createDirectory({
            "manifest.json": '{"id": "plugin-b"}',
            "main.js": "console.log('foo')",
            "data.json": "{}",
            "styles.css": "",
            "README.md": "PLUGIN B", // should ignore other files
        });
        const vault = await createDirectory({
            ".obsidian/community-plugins.json": '["dataview", "plugin-b"]',
        });

        await installPlugins(vault, [
            {path: pluginA, enabled: false},
            {path: pluginB, enabled: false},
        ]);

        const communityPlugins = await fsAsync.readFile(`${vault}/.obsidian/community-plugins.json`, 'utf-8');
        expect(JSON.parse(communityPlugins)).to.eql(["dataview"]);
        
        const pluginAFiles = await fsAsync.readdir(`${vault}/.obsidian/plugins/plugin-a`);
        expect(pluginAFiles.sort()).to.eql(["main.js", "manifest.json"]);

        const pluginBFiles = await fsAsync.readdir(`${vault}/.obsidian/plugins/plugin-b`);
        expect(pluginBFiles.sort()).to.eql(["data.json", "main.js", "manifest.json", "styles.css"]);
    })

    it("overwrites plugins", async () => {
        const pluginA = await createDirectory({
            "manifest.json": '{"id": "plugin-a"}',
            "main.js": "console.log('foo')",
        });
        const vault = await createDirectory({
            ".obsidian/community-plugins.json": '["dataview", "plugin-b"]',
            ".obsidian/plugins/plugin-a/foo.json": '{}',
        });

        await installPlugins(vault, [
            {path: pluginA, enabled: true},
        ]);

        const communityPlugins = await fsAsync.readFile(`${vault}/.obsidian/community-plugins.json`, 'utf-8');
        expect(JSON.parse(communityPlugins)).to.eql(["dataview", "plugin-b", "plugin-a"]);
        
        const pluginAFiles = await fsAsync.readdir(`${vault}/.obsidian/plugins/plugin-a`);
        expect(pluginAFiles.sort()).to.eql(["main.js", "manifest.json"]); // deletes foo.json
    })
})

describe("installThemes", () => {
    it("no themes", async () => {
        const vault = await createDirectory();
        await installThemes(vault, []);
        expect(await fileExists(`${vault}/.obsidian/themes`)).to.equal(false);
    })

    it("empty vault", async () => {
        const theme = await createDirectory({
            "manifest.json": '{"name": "sample-theme"}',
            "theme.css": ".foobar {}",
        });
        const vault = await createDirectory();

        await installThemes(vault, [{path: theme}]);

        const themeFiles = await fsAsync.readdir(`${vault}/.obsidian/themes/sample-theme`);
        expect(themeFiles.sort()).to.eql(["manifest.json", "theme.css"]);
    })

    it("overwrites themes", async () => {
        const theme = await createDirectory({
            "manifest.json": '{"name": "sample-theme"}',
            "theme.css": ".foobar {}",
        });
        const vault = await createDirectory({
            ".obsidian/appearance.json": '{"cssTheme": "another-theme", "anotherKey": 1}',
            ".obsidian/themes/sample-theme/foo.json": "{}",
        });

        await installThemes(vault, [{path: theme}]);

        const themeFiles = await fsAsync.readdir(`${vault}/.obsidian/themes/sample-theme`);
        expect(themeFiles.sort()).to.eql(["manifest.json", "theme.css"]); // deletes foo.json

        const appearancePath = path.join(vault, '.obsidian/appearance.json');
        const appearance = JSON.parse(await fsAsync.readFile(appearancePath, 'utf-8'));
        expect(appearance).to.eql({
            cssTheme: "sample-theme",
            anotherKey: 1,
        });
    })
})

describe("resolveVersions", () => {
    let downloader: ObsidianDownloader|undefined;

    before(async () => {
        let versions = JSON.parse(await fsAsync.readFile(path.resolve("./obsidian-versions.json"), 'utf-8')).versions;
        versions = versions.filter((v: ObsidianVersionInfo) => semver.lte(v.version, "1.8.0"));

        const tmpDir = await createDirectory({
            "obsidian-versions.json": JSON.stringify({
                latest: {
                    "date": "2025-01-07T00:00:00Z",
                    "sha": "0000000"
                },
                versions: versions,
            }),
        });
        const cacheDir = await createDirectory();
    
        downloader = new ObsidianDownloader({
            ...obsidianLauncherOpts,
            cacheDir,
            versionsUrl: pathToFileURL(`${tmpDir}/obsidian-versions.json`).toString(),
        });
    })

    const tests = [
        [["latest", "latest"], ["1.7.7", "1.7.7"]],
        [["latest", "earliest"], ["1.7.7", "1.1.9"]],
        [["latest-beta", "latest"], ["1.8.0", "1.7.7"]],
        [["0.14.5", "earliest"], ["0.14.5", "0.11.0"]],
        [["0.14.5", "latest"], ["0.14.5", "0.14.5"]],
    ]

    tests.forEach(([[appVersion, installerVersion], expected]) => {
        it(`resolveVersions("${appVersion}", "${installerVersion}") == ${expected}`, async () => {
            const {
                appVersionInfo, installerVersionInfo,
            } = await downloader!.resolveVersions(appVersion, installerVersion);
            expect([appVersionInfo.version, installerVersionInfo.version]).to.eql(expected);
        })
    })
})

describe("setup", () => {
    it(`basic`, async () => {
        const tmpDir = await createDirectory({
            "obsidian-1.7.7.asar": "stuff",
            "my-plugin/manifest.json": '{"id": "plugin-a"}',
            "my-plugin/main.js": "console.log('foo')",
            "my-vault/A.md": "This is a file",
        });

        const setupDir = await setupConfigAndVault({
            appVersion: "1.7.7", installerVersion: "1.7.7",
            appPath: `${tmpDir}/obsidian-1.7.7.asar`,
            vault: `${tmpDir}/my-vault`,
            plugins: [{path: `${tmpDir}/my-plugin`, enabled: true}],
        })
        after(() => { fsAsync.rm(setupDir, { recursive: true, force: true}) });

        const setupDirFiles = await fsAsync.readdir(setupDir);
        expect(setupDirFiles.sort()).to.eql(["config", "vault"]);
        expect(await fileExists(`${setupDir}/config/obsidian-1.7.7.asar`)).to.eql(true);
        const obsidianJson = JSON.parse(await fsAsync.readFile(`${setupDir}/config/obsidian.json`, 'utf-8'));
        expect(Object.keys(obsidianJson.vaults).length).to.eql(1);
    })

    it(`no vault`, async () => {
        const tmpDir = await createDirectory({
            "obsidian-1.7.7.asar": "stuff",
            "my-plugin/manifest.json": '{"id": "plugin-a"}',
            "my-plugin/main.js": "console.log('foo')",
        });

        const setupDir = await setupConfigAndVault({
            appVersion: "1.7.7", installerVersion: "1.7.7",
            appPath: `${tmpDir}/obsidian-1.7.7.asar`,
            plugins: [{path: `${tmpDir}/my-plugin`, enabled: true}],
        })
        after(() => { fsAsync.rm(setupDir, { recursive: true, force: true}) });

        const setupDirFiles = await fsAsync.readdir(setupDir);
        expect(setupDirFiles.sort()).to.eql(["config"]);
        expect(await fileExists(`${setupDir}/config/obsidian-1.7.7.asar`)).to.eql(true);
        const obsidianJson = JSON.parse(await fsAsync.readFile(`${setupDir}/config/obsidian.json`, 'utf-8'));
        expect(obsidianJson).to.not.have.key("vaults");
    })
})
