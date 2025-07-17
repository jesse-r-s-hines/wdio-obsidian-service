#!/usr/bin/env node
import { Command } from 'commander';
import _ from "lodash";
import { ObsidianLauncher } from "./launcher.js"
import { watchFiles } from './utils.js';
import { PluginEntry, ThemeEntry } from "./types.js";
import path from "path"
import fsAsync from "fs/promises";


function parsePlugins(plugins: string[] = []): PluginEntry[] {
    return plugins.map((p: string) => {
        if (p.startsWith("id:")) {
            const [id, version] = p.slice(3).split('=');
            return {id, version};
        } else if (p.startsWith("repo:")) {
            const [id, version] = p.slice(5).split('=');
            return {id, version};
        } else {
            return {path: p};
        }
    })
}

function parseThemes(themes: string[] = []): ThemeEntry[] {
    return themes.map((t: string, i: number) => {
        let result: ThemeEntry
        if (t.startsWith("name:")) {
            result = {name: t.slice(5)};
        } else if (t.startsWith("repo:")) {
            result = {repo: t.slice(5)};
        } else {
            result = {path: t};;
        }
        return {...result, enabled: i == themes.length - 1}
    })
}

const collectOpt = (curr: string, prev?: string[]) => [...(prev ?? []), curr];

const versionOptionArgs = [
    '-v, --version <version>',
    "Obsidian app version",
    "latest",
] as const
const installerOptionArgs = [
    '-i, --installer <version>',
    "Obsidian installer version",
    "latest",
] as const
const cacheOptionArgs = [
    '-c, --cache <cache>',
    'Directory to use as the download cache. (default: OBSIDIAN_CACHE env var or ".obsidian-cache")',
] as const
const pluginOptionArgs = [
    '-p, --plugin <plugin>',
    'Plugin to install. Format: "<path>" or "repo:<github-repo>" or "id:<community-id>". Can be repeated.',
    collectOpt,
] as const
const themeOptionArgs = [
    '-t, --theme <plugin>',
    'Theme to install. Format: "<path>" or "repo:<github-repo>" or "name:<community-name>". Can be repeated but only last will be enabled.',
    collectOpt,
] as const

const program = new Command("obsidian-launcher");

program
    .command("download")
    .description("Download Obsidian to the cache")
    .option(...cacheOptionArgs)
    .option(...versionOptionArgs)
    .option(...installerOptionArgs)
    .action(async (opts) => {
        const launcher = new ObsidianLauncher({cacheDir: opts.cache});
        const [appVersion, installerVersion] = await launcher.resolveVersions(opts.version, opts.installerVersion);
        const installerPath = await launcher.downloadInstaller(installerVersion);
        console.log(`Downloaded Obsidian installer to ${installerPath}`)
        const appPath = await launcher.downloadApp(appVersion);
        console.log(`Downloaded Obsidian app to ${appPath}`)
    })

program
    .command("install")
    .description("Install plugins and themes into an Obsidian vault")
    .argument('<vault>', 'Vault to install into')
    .option(...cacheOptionArgs)
    .option(...pluginOptionArgs)
    .option(...themeOptionArgs)
    .action(async (vault, opts) => {
        const launcher = new ObsidianLauncher({cacheDir: opts.cache});
        await launcher.installPlugins(vault, parsePlugins(opts.plugin));
        await launcher.installThemes(vault, parseThemes(opts.theme));
        console.log(`Installed plugins and themes into ${vault}`)
    })


program
    .command("launch")
    .summary("Download and launch Obsidian")
    .description(
        "Download and launch Obsidian, opening the specified vault.\n" +
        "\n" +
        "The Obsidian instance will have a sandboxed configuration directory. You can use this command to test " +
        "plugin behavior on different versions of Obsidian without messing with your system installation of " + 
        "Obsidian.\n" +
        "\n" +
        "You can pass arguments through to the Obsidian executable using\n" +
        "    npx obsidian-launcher ./vault -- --remote-debugging-port=9222"
    )
    .argument('[vault]', 'Vault to open')
    .argument('[obsidian-args...]', 'Arguments to pass to Obsidian')
    .option(...cacheOptionArgs)
    .option(...versionOptionArgs)
    .option(...installerOptionArgs)
    .option(...pluginOptionArgs)
    .option(...themeOptionArgs)
    .option('--copy', "Copy the vault first")
    .action(async (vault: string|undefined, obsidianArgs: string[], opts: any) => {
        const launcher = new ObsidianLauncher({cacheDir: opts.cache});
        const {proc} = await launcher.launch({
            appVersion: opts.version, installerVersion: opts.installer,
            vault: vault,
            copy: opts.copy ?? false,
            args: obsidianArgs,
            plugins: parsePlugins(opts.plugin),
            themes: parseThemes(opts.theme),
            spawnOptions: {
                detached: true,
                stdio: 'ignore',
            }
        })
        proc.unref() // Allow node to exit and leave proc running
        console.log(`Launched obsidian ${opts.version}`)
    })

program
    .command("watch")
    .summary("Launch Obsidian and watch for changes to plugins and themes")
    .description(
        "Downloads Obsidian and opens a vault, then watches for changes to plugins and themes.\n" +
        "\n" +
        'Takes the same arguments as the "launch" command but watches for changes to any local plugins or themes and ' +
        'updates the the vault. Automatically installs "pjeby/hot-reload" so plugins will hot reload as they are ' +
        'updated.'
    )
    .argument('[vault]', 'Vault to open')
    .argument('[obsidian-args...]', 'Arguments to pass to Obsidian')
    .option(...cacheOptionArgs)
    .option(...versionOptionArgs)
    .option(...installerOptionArgs)
    .option(...pluginOptionArgs)
    .option(...themeOptionArgs)
    .option('--copy', "Copy the vault first")
    .action(async (vault: string, obsidianArgs: string[], opts: any) => {
        const launcher = new ObsidianLauncher({cacheDir: opts.cache});
        // Normalize the plugins and themes
        const plugins = await launcher.downloadPlugins(parsePlugins(opts.plugin));
        const themes = await launcher.downloadThemes(parseThemes(opts.theme));
        const copy: boolean = opts.copy ?? false;
        const launchArgs = {
            appVersion: opts.version, installerVersion: opts.installer,
            vault: vault,
            copy: copy,
            args: obsidianArgs,
            plugins: plugins,
            themes: themes,
        } as const

        const {proc, configDir, vault: vaultCopy} = await launcher.launch({
            ...launchArgs,
            plugins: [...plugins, {repo: "pjeby/hot-reload"}],
            spawnOptions: {
                detached: false,
                stdio: "pipe",
            }
        })
        if (copy) {
            console.log(`Vault copied to ${vaultCopy}`);
        }
        proc.stdout!.on('data', data => console.log(`obsidian: ${data}`));
        proc.stderr!.on('data', data => console.log(`obsidian: ${data}`));
        const procExit = new Promise<number>((resolve) => proc.on('exit', (code) => resolve(code ?? -1)));

        for (const plugin of plugins) {
            if (plugin.originalType == "local") {
                watchFiles(
                    ["manifest.json", "main.js", "styles.css", "data.json"].map(f => path.join(plugin.path, f)),
                    async () => {
                        console.log(`Detected change to "${plugin.id}"`);
                        try {
                            await launcher.installPlugins(vaultCopy!, [plugin]);
                        } catch (e) {
                            console.error(`Failed to update plugin "${plugin.id}": ${e}`)
                        }
                    },
                    {interval: 500, persistent: false, debounce: 1000},
                )
            }
        }
        for (const theme of themes) {
            if (theme.originalType == "local") {
                watchFiles(
                    ["manifest.json", "theme.css"].map(f => path.join(theme.path, f)),
                    async () => {
                        console.log(`Detected change to "${theme.name}"`);
                        try {
                            await launcher.installThemes(vaultCopy!, [theme]);
                        } catch (e) {
                            console.error(`Failed to update theme "${theme.name}": ${e}`)
                        }
                    },
                    {interval: 500, persistent: false, debounce: 1000},
                )
            }
        }

        const cleanup = async () => {
            proc.kill("SIGTERM");
            await procExit;
            await fsAsync.rm(configDir, {recursive: true, force: true});
            process.exit(1);
        }
        process.on('SIGINT', cleanup);
        process.on('exit', cleanup);

        console.log("Watching for changes to plugins and themes...")
        await procExit;
    })

program
    .command("update-version-list")
    .summary("Collect Obsidian version information into a single file")
    .description(
        "Collect Obsidian version information into a single file.\n" +
        "\n" +
        "This command is used to collect Obsidian version information in one place including download links, the " +
        "minimum installer version, and the internal Electron version for every Obsidian release and beta version. " +
        "This info is available and automatically kept up to date at " +
        "https://raw.githubusercontent.com/jesse-r-s-hines/wdio-obsidian-service/HEAD/obsidian-versions.json " +
        "but you can use this command to recreate the file manually if you want."
    )
    .argument('dest', 'Path to output. If it already exists, it will update the information instead of creating it from scratch.')
    .option(...cacheOptionArgs)
    .option('--max-instances <count>', "Number of parallel Obsidian instances to launch when checking Electron versions", "1")
    .action(async (dest, opts) => {
        let versionInfos: any;
        try {
            versionInfos = JSON.parse(await fsAsync.readFile(dest, "utf-8"))
        } catch {
            versionInfos = undefined;
        }
        const maxInstances = Number(opts.maxInstances)
        if (isNaN(maxInstances)) {
            throw Error(`Invalid number ${opts.maxInstances}`)
        }

        const launcher = new ObsidianLauncher({cacheDir: opts.cache});
        versionInfos = await launcher.updateObsidianVersionList(versionInfos, { maxInstances });
        await fsAsync.writeFile(dest, JSON.stringify(versionInfos, undefined, 4) + "\n");
        console.log(`Wrote updated version information to ${dest}`)
    })

program
    .parseAsync()
    .catch((err) => {
        console.log(err?.message ?? err.toString())
        process.exit(1);
    });
