#!/bin/env node
import { Command } from 'commander';
import ObsidianLauncher from "./obsidianLauncher.js"
import { PluginEntry, ThemeEntry } from "./types.js";


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


const program = new Command("wdio-obsidian-service");

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
    .action(async (vault, opts) => {
        const launcher = new ObsidianLauncher({cacheDir: opts.cache});

        if (vault && opts.copy) {
            vault = await launcher.copyVault(vault);
        }
    
        const [proc, _configDir] = await launcher.launch({
            appVersion: opts.version, installerVersion: opts.installerVersion,
            vault: vault,
            plugins: parsePlugins(opts.plugin), themes: parseThemes(opts.theme),
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

program.parse();

