#!/bin/env node
import { Command } from 'commander';
import { ObsidianLauncher } from "./launcher.js"
import { PluginEntry, ThemeEntry } from "./types.js";
import fsAsync from "fs/promises"


function parsePlugins(plugins: string[]): PluginEntry[] {
    return plugins.map((p: string) => {
        if (p.startsWith("id:")) {
            return {id: p.slice(3)}
        } else if (p.startsWith("repo:")) {
            return {repo: p.slice(5)}
        } else {
            return {path: p}
        }
    })
}

function parseThemes(themes: string[]): ThemeEntry[] {
    return themes.map((t: string, i: number) => {
        let result: ThemeEntry
        if (t.startsWith("name:")) {
            result = {name: t.slice(5)}
        } else if (t.startsWith("repo:")) {
            result = {repo: t.slice(5)}
        } else {
            result = {path: t}
        }
        return {...result, enabled: i == themes.length - 1}
    })
}

const cacheOptionArgs = [
    '-c, --cache <cache>',
    'Directory to use as the download cache',
] as const
const pluginOptionArgs = [
    '-p, --plugin <plugin>',
    `Plugin to install. Format: "<path>" or "repo:<github-repo>" or "id:<community-id>". Can be repeated.`,
    (curr: string, prev: string[]) => [...prev, curr], [] as string[],
] as const
const themeOptionArgs = [
    '-t, --theme <plugin>',
    `Themes to install. Format: "<path>" or "repo:<github-repo>" or "name:<community-name>". Can be repeated but only last will be enabled.`,
    (curr: string, prev: string[]) => [...prev, curr], [] as string[],
] as const


const program = new Command("obsidian-launcher");

program
    .command("download")
    .description("Download Obsidian to the cache")
    .option(...cacheOptionArgs)
    .option('-v, --version <version>', "Obsidian version to run", "latest")
    .option('--installer-version <version>', "Obsidian installer version to run", "latest")
    .action(async (opts) => {
        const launcher = new ObsidianLauncher({cacheDir: opts.cache});
        const [appVersion, installerVersion] = await launcher.resolveVersions(opts.version, opts.installerVersion);
        const installerPath = await launcher.downloadInstaller(installerVersion);
        console.log(`Downloaded Obsidian installer to ${installerPath}`)
        const appPath = await launcher.downloadApp(appVersion);
        console.log(`Downloaded Obsidian app to ${appPath}`)
    })

program
    .command("launch")
    .description("Download and launch Obsidian")
    .argument('[vault]', 'Vault to open')
    .option(...cacheOptionArgs)
    .option('-v, --version <version>', "Obsidian version to run", "latest")
    .option('--installer-version <version>', "Obsidian installer version to run", "latest")
    .option(...pluginOptionArgs)
    .option(...themeOptionArgs)
    .option('--copy', "Copy the vault first.")
    .action(async (vault: string, opts) => {
        const launcher = new ObsidianLauncher({cacheDir: opts.cache});
        const {proc, configDir, vault: vaultCopy} = await launcher.launch({
            appVersion: opts.version, installerVersion: opts.installerVersion,
            vault: vault,
            copy: opts.copy ?? false,
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
    .command("create-versions-list")
    .description("Collect Obsidian version information into a single file")
    .addHelpText('after', "\n" +
        "This command is used to collect Obsidian version information in one place including download links, the " +
        "minimum installer version, and the internal Electron version for every Obsidian release and beta version. " +
        "This info is available and kept up to date at https://raw.githubusercontent.com/jesse-r-s-hines/wdio-obsidian-service/HEAD/obsidian-versions.json, " +
        "but you can use this command to recreate the file manually if you want."
    )
    .argument('dest', 'Path to output. If it already exists, it will update the information instead of creating it from scratch.')
    .option(...cacheOptionArgs)
    .option('--max-instances <version>', "Number of parallel Obsidian instances to launch when checking Electron versions", "1")
    .action(async (dest, opts) => {
        let versionInfos: any;
        try {
            versionInfos = JSON.parse(await fsAsync.readFile(dest, "utf-8"))
        } catch {
            versionInfos = undefined;
        }
        const launcher = new ObsidianLauncher({cacheDir: opts.cache});
        versionInfos = await launcher.updateObsidianVersionInfos(versionInfos, { maxInstances: 1 });
        fsAsync.writeFile(dest, JSON.stringify(versionInfos, undefined, 4));
        console.log(`Wrote updated version information to ${dest}`)
    })

program.parse();
