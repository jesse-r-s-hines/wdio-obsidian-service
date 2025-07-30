import { describe, it } from "mocha";
import { expect } from "chai";
import path from "path"
import fsAsync from "fs/promises"
import { pathToFileURL } from "url";
import semver from "semver";
import { createDirectory } from "../helpers.js"
import { ObsidianLauncher } from "../../src/launcher.js";
import { fileExists } from "../../src/utils.js";
import { ObsidianVersionInfo } from "../../src/types.js";
import ChromeLocalStorage from "../../src/chromeLocalStorage.js";


const obsidianLauncherOpts = {
    versionsUrl: pathToFileURL("../../obsidian-versions.json").toString(),
    communityPluginsUrl: pathToFileURL("./test/data/community-plugins.json").toString(),
    communityThemesUrl: pathToFileURL("./test/data/community-css-themes.json").toString(),
}

describe('ObsdianLauncher resolve versions', () => {
    let launcher: ObsidianLauncher;
    const originalCwd = process.cwd();

    beforeEach(async () => {
        process.chdir(originalCwd);
        const versionsFile = path.resolve("../../obsidian-versions.json");
        let versions = JSON.parse(await fsAsync.readFile(versionsFile, 'utf-8')).versions;
        versions = versions.filter((v: ObsidianVersionInfo) => semver.lte(v.version, "1.8.0"));

        // Create constant version of obsidian-versions.json
        const tmpDir = await createDirectory({
            "obsidian-versions.json": JSON.stringify({
                metadata: {
                    schemaVersion: '2.0.0',
                    commitDate: "2025-01-07T00:00:00Z",
                    commitSha: "0000000"
                },
                versions: versions,
            }),
        });
        const cacheDir = await createDirectory();

        launcher = new ObsidianLauncher({
            ...obsidianLauncherOpts,
            cacheDir,
            versionsUrl: pathToFileURL(`${tmpDir}/obsidian-versions.json`).toString(),
        });
    })

    after(() => {
        process.chdir(originalCwd);
    })

    const resolveVersionTests = [
        [["latest", "latest"], ["1.7.7", "1.7.7"]],
        [["latest-beta", "latest"], ["1.8.0", "1.7.7"]],
    ];
    if (process.platform == "win32" && process.arch == "arm64") {
        // windows arm support was only added in 1.6.5
        resolveVersionTests.push(
            [["latest", "earliest"], ["1.7.7", "1.6.5"]],
        )
    } else {
        resolveVersionTests.push(
            [["latest", "earliest"], ["1.7.7", "1.1.9"]],
            [["0.14.5", "latest"], ["0.14.5", "0.14.5"]],
        )
        if (process.platform == "linux" && process.arch == "arm64") {
            // Linux arm support was added in 0.12.15
            resolveVersionTests.push([["0.14.5", "earliest"], ["0.14.5", "0.12.15"]])
        } else {
            resolveVersionTests.push([["0.14.5", "earliest"], ["0.14.5", "0.11.0"]])
        }
    }

    resolveVersionTests.forEach(([[appVersion, installerVersion], expected]) => {
        it(`resolveVersion("${appVersion}", "${installerVersion}") == ${JSON.stringify(expected)}`, async () => {
            const [resolvedAppVersion, resolvedInstallerVersion] =
                await launcher.resolveVersion(appVersion, installerVersion);
            expect([resolvedAppVersion, resolvedInstallerVersion]).to.eql(expected);
        })
    })

    it('resolveVersion earliest error', async () => {
        const result = await launcher.resolveVersion("earliest").catch(e => e);
        expect(result).to.be.instanceOf(Error);
        expect(result.toString()).includes("minAppVersion");
    })

    it('resolveVersion earliest', async () => {
        const tmpDir = await createDirectory({
            "manifest.json": '{"minAppVersion": "1.7.4"}',
        });
        process.chdir(tmpDir);
        const [appVersion, installerVersion] = await launcher.resolveVersion("earliest", "latest");
        expect([appVersion, installerVersion]).to.eql(["1.7.4", "1.7.4"]);
    })

    it('resolveVersion nested', async () => {
        const tmpDir = await createDirectory({
            "foo/a.md": "Hello",
            "manifest.json": '{"minAppVersion": "1.7.4"}',
        });
        process.chdir(path.join(tmpDir, 'foo'));
        const [appVersion, installerVersion] = await launcher.resolveVersion("earliest", "latest");
        expect([appVersion, installerVersion]).to.eql(["1.7.4", "1.7.4"]);
    })

    it('getVersionInfo basic', async () => {
        const versionInfo = await launcher.getVersionInfo("1.7.7");
        expect(versionInfo.chromeVersion).to.eql('128.0.6613.186');
        expect(versionInfo.installerInfo.appImage!.chrome).to.eql('128.0.6613.186');
    })

    it('getVersionInfo missing', async () => {
        const result = await launcher.getVersionInfo("foo").catch(e => e);
        expect(result).to.be.instanceOf(Error);
        expect(result.toString()).includes("No Obsidian app version");
    });

    const parseVersionsTests: [any, [string, string][]][] = [
        ["", []],
        ["latest/latest", [["1.7.7", "1.7.7"]]],
        ["latest-beta/latest", [["1.8.0", "1.7.7"]]],
        [" latest-beta/latest  latest-beta/latest ", [["1.8.0", "1.7.7"]]],
        [" latest-beta/latest  latest-beta/1.7.0 ", [["1.8.0", "1.7.7"], ["1.8.0", "1.7.0"]]],
        [",latest-beta/latest,latest-beta/1.7.0,", [["1.8.0", "1.7.7"], ["1.8.0", "1.7.0"]]],
        ["latest", [["1.7.7", (process.platform == "win32" && process.arch == "arm64") ? "1.6.5" : "1.1.9"]]],
        ["1.8.0/1.7.7", [["1.8.0", "1.7.7"]]],
    ];
    parseVersionsTests.forEach(([input, expected]) => {
        it(`parseVersions(${JSON.stringify(input)}) == ${JSON.stringify(expected)}`, async function() {
            const actual = await launcher.parseVersions(input);
            expect(actual).to.eql(expected);
        })
    });
})

describe("ObsidianLauncher download, install and setup", () => {
    let launcher: ObsidianLauncher;

    before(async () => {
        const cacheDir = await createDirectory();
        launcher = new ObsidianLauncher({
            ...obsidianLauncherOpts,
            cacheDir,
        });
    })

    it("installPlugins no plugins empty vault", async () => {
        const vault = await createDirectory();
        await launcher.installPlugins(vault, []);
        // Shouldn't create the file if there are no changes.
        expect(await fileExists(`${vault}/.obsidian/community-plugins.json`)).to.eql(false);
    })

    it("installPlugins no plugins with existing plugins", async () => {
        const vault = await createDirectory({
            ".obsidian/community-plugins.json": '["plugin-b" ]',
        });
        await launcher.installPlugins(vault, []);
        // Shouldn't update the file if there are no changes.
        const communityPlugins = await fsAsync.readFile(`${vault}/.obsidian/community-plugins.json`, 'utf-8');
        expect(communityPlugins).to.eql('["plugin-b" ]');
    })

    it("installPlugins empty vault", async () => {
        const plugin = await createDirectory({
            "manifest.json": '{"id": "sample-plugin"}',
            "main.js": "console.log('foo')",
        });
        const vault = await createDirectory();

        await launcher.installPlugins(vault, [{path: plugin, enabled: true}]);

        const communityPlugins = await fsAsync.readFile(`${vault}/.obsidian/community-plugins.json`, 'utf-8');
        expect(JSON.parse(communityPlugins)).to.eql(["sample-plugin"]);
        const pluginFiles = await fsAsync.readdir(`${vault}/.obsidian/plugins/sample-plugin`);
        expect(pluginFiles.sort()).to.eql([".hotreload", "main.js", "manifest.json"]);
    })

    it("installPlugins multiple plugins and existing community-plugins.json", async () => {
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

        await launcher.installPlugins(vault, [
            {path: pluginA, enabled: true},
            {path: pluginB, enabled: true},
        ]);

        const communityPlugins = await fsAsync.readFile(`${vault}/.obsidian/community-plugins.json`, 'utf-8');
        expect(JSON.parse(communityPlugins)).to.eql(["dataview", "plugin-b", "plugin-a"]);

        const pluginAFiles = await fsAsync.readdir(`${vault}/.obsidian/plugins/plugin-a`);
        expect(pluginAFiles.sort()).to.eql([".hotreload", "main.js", "manifest.json"]);

        const pluginBFiles = await fsAsync.readdir(`${vault}/.obsidian/plugins/plugin-b`);
        expect(pluginBFiles.sort()).to.eql([".hotreload", "data.json", "main.js", "manifest.json", "styles.css"]);
    })

    it("installPlugins disabled plugins", async () => {
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

        await launcher.installPlugins(vault, [
            {path: pluginA, enabled: false},
            {path: pluginB, enabled: false},
        ]);

        const communityPlugins = await fsAsync.readFile(`${vault}/.obsidian/community-plugins.json`, 'utf-8');
        expect(JSON.parse(communityPlugins)).to.eql(["dataview"]);

        const pluginAFiles = await fsAsync.readdir(`${vault}/.obsidian/plugins/plugin-a`);
        expect(pluginAFiles.sort()).to.eql([".hotreload", "main.js", "manifest.json"]);

        const pluginBFiles = await fsAsync.readdir(`${vault}/.obsidian/plugins/plugin-b`);
        expect(pluginBFiles.sort()).to.eql([".hotreload", "data.json", "main.js", "manifest.json", "styles.css"]);
    })

    it("installPlugins overwrites plugins", async () => {
        const pluginA = await createDirectory({
            "manifest.json": '{"id": "plugin-a"}',
            "main.js": "console.log('foo')",
        });
        const vault = await createDirectory({
            ".obsidian/community-plugins.json": '["dataview", "plugin-b"]',
            ".obsidian/plugins/plugin-a/styles.css": '.foo {}',
            ".obsidian/plugins/plugin-a/data.json": '{}',
            ".obsidian/plugins/plugin-a/foo.json": '{}',
        });

        await launcher.installPlugins(vault, [
            {path: pluginA, enabled: true},
        ]);

        const communityPlugins = await fsAsync.readFile(`${vault}/.obsidian/community-plugins.json`, 'utf-8');
        expect(JSON.parse(communityPlugins)).to.eql(["dataview", "plugin-b", "plugin-a"]);

        const pluginAFiles = await fsAsync.readdir(`${vault}/.obsidian/plugins/plugin-a`);
        // deletes style.css but keeps data.json and foo.json
        expect(pluginAFiles.sort()).to.eql([".hotreload", "data.json", "foo.json", "main.js", "manifest.json"]);
    })

    it("installThemes no themes", async () => {
        const vault = await createDirectory();
        await launcher.installThemes(vault, []);
        expect(await fileExists(`${vault}/.obsidian/themes`)).to.equal(false);
    })

    it("installThemes empty vault", async () => {
        const theme = await createDirectory({
            "manifest.json": '{"name": "sample-theme"}',
            "theme.css": ".foobar {}",
        });
        const vault = await createDirectory();

        await launcher.installThemes(vault, [{path: theme}]);

        const themeFiles = await fsAsync.readdir(`${vault}/.obsidian/themes/sample-theme`);
        expect(themeFiles.sort()).to.eql(["manifest.json", "theme.css"]);
    })

    it("installThemes preserves extra files", async () => {
        const theme = await createDirectory({
            "manifest.json": '{"name": "sample-theme"}',
            "theme.css": ".foobar {}",
        });
        const vault = await createDirectory({
            ".obsidian/appearance.json": '{"cssTheme": "another-theme", "anotherKey": 1}',
            ".obsidian/themes/sample-theme/foo.json": "{}",
        });

        await launcher.installThemes(vault, [{path: theme}]);

        const themeFiles = await fsAsync.readdir(`${vault}/.obsidian/themes/sample-theme`);
        expect(themeFiles.sort()).to.eql(["foo.json", "manifest.json", "theme.css"]);

        const appearancePath = path.join(vault, '.obsidian/appearance.json');
        const appearance = JSON.parse(await fsAsync.readFile(appearancePath, 'utf-8'));
        expect(appearance).to.eql({
            cssTheme: "sample-theme",
            anotherKey: 1,
        });
    })

    it("downloadPlugins", async () => {
        const plugin = await createDirectory({
            "manifest.json": '{"id": "plugin-a"}',
            "main.js": "console.log('foo')",
        });
        const downloaded = await launcher.downloadPlugins([plugin]);
        expect(downloaded[0]).to.eql({
            path: plugin,
            id: "plugin-a",
            enabled: true,
            originalType: "local",
        });

        const reDownloaded = await launcher.downloadPlugins(downloaded);
        // Shouldn't reset the originalType if called twice
        expect(reDownloaded[0]).to.eql(downloaded[0]);
    })

    it("downloadThemes", async () => {
        const theme = await createDirectory({
            "manifest.json": '{"name": "sample-theme"}',
            "theme.css": ".foobar {}",
        });
        const downloaded = await launcher.downloadThemes([theme]);
        expect(downloaded[0]).to.eql({
            path: theme,
            name: "sample-theme",
            enabled: true,
            originalType: "local",
        });

        const reDownloaded = await launcher.downloadThemes(downloaded);
        // Shouldn't reset the originalType if called twice
        expect(reDownloaded[0]).to.eql(downloaded[0]);
    })

    it(`setupConfigDir basic`, async () => {
        const tmpDir = await createDirectory({
            "obsidian-1.7.7.asar": "stuff",
            "my-vault/A.md": "This is a file",
        });
        const vault = path.join(tmpDir, "my-vault");

        const configDir = await launcher.setupConfigDir({
            appVersion: "1.7.7", installerVersion: "1.7.7",
            appPath: `${tmpDir}/obsidian-1.7.7.asar`,
            vault: vault,
        })
        after(() => fsAsync.rm(configDir, { recursive: true, force: true}) );

        expect(await fileExists(`${configDir}/obsidian-1.7.7.asar`)).to.eql(true);
        const obsidianJson = JSON.parse(await fsAsync.readFile(`${configDir}/obsidian.json`, 'utf-8'));
        expect(Object.keys(obsidianJson.vaults).length).to.eql(1);
    })

    it(`setupConfig no vault`, async () => {
        const tmpDir = await createDirectory({
            "obsidian-1.7.7.asar": "stuff",
        });

        const configDir = await launcher.setupConfigDir({
            appVersion: "1.7.7", installerVersion: "1.7.7",
            appPath: `${tmpDir}/obsidian-1.7.7.asar`,
        })
        after(() => fsAsync.rm(configDir, { recursive: true, force: true}) );

        expect(await fileExists(`${configDir}/obsidian-1.7.7.asar`)).to.eql(true);
        const obsidianJson = JSON.parse(await fsAsync.readFile(`${configDir}/obsidian.json`, 'utf-8'));
        expect(obsidianJson).to.not.have.key("vaults");
    })

    it(`setupConfigDir localStorage`, async () => {
        const tmpDir = await createDirectory({
            "obsidian-1.7.7.asar": "stuff",
            "my-vault/A.md": "This is a file",
        });
        const vault = path.join(tmpDir, "my-vault");

        const configDir = await launcher.setupConfigDir({
            appVersion: "1.7.7", installerVersion: "1.7.7",
            appPath: `${tmpDir}/obsidian-1.7.7.asar`,
            vault: vault,
            localStorage: {"$vaultId-foo": "bar"},
        })
        after(() => fsAsync.rm(configDir, { recursive: true, force: true}) );

        const obsidianJson = JSON.parse(await fsAsync.readFile(`${configDir}/obsidian.json`, 'utf-8'));
        const vaultId = Object.keys(obsidianJson.vaults)[0];

        const localStorage = new ChromeLocalStorage(configDir);
        const value = await localStorage.getItem("app://obsidian.md", `${vaultId}-foo`);
        await localStorage.close();
        expect(value).to.equal('bar');
    })

    it(`setupVault basic`, async () => {
        const tmpDir = await createDirectory({
            "my-plugin/manifest.json": '{"id": "plugin-a"}',
            "my-plugin/main.js": "console.log('foo')",
            "my-vault/A.md": "This is a file",
        });
        const vault = path.join(tmpDir, "my-vault");

        const vaultCopy = await launcher.setupVault({
            vault: vault,
            copy: true,
            plugins: [{path: `${tmpDir}/my-plugin`, enabled: true}],
        })
        after(() => fsAsync.rm(vaultCopy, { recursive: true, force: true}) );

        expect(vaultCopy).to.not.eql(vault);
        expect((await fsAsync.readdir(vaultCopy)).sort()).to.eql(['.obsidian', 'A.md']);
        expect(await fsAsync.readdir(path.join(vaultCopy, ".obsidian/plugins"))).to.eql(['plugin-a']);
        expect((await fsAsync.readdir(vault)).sort()).to.eql(['A.md']);

        const noVaultCopy = await launcher.setupVault({
            vault: vault,
            copy: false,
            plugins: [{path: `${tmpDir}/my-plugin`, enabled: true}],
        })
        expect(noVaultCopy).to.eql(vault);
        expect((await fsAsync.readdir(vault)).sort()).to.eql(['.obsidian', 'A.md']);
        expect(await fsAsync.readdir(path.join(vault, ".obsidian/plugins"))).to.eql(['plugin-a']);
    })
})
