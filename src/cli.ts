#!/bin/env node
import path from "path"
import { Command } from 'commander';
import child_process from "child_process"
import { setupConfigAndVault, ObsidianDownloader } from "./obsidianUtils.js"
import { PluginEntry, ThemeEntry } from "./types.js";

const program = new Command("obsidian-plugin-testing-library");

const launch = new Command("launch")
    .argument('<vault>', 'Vault to open')
    .option('-v, --version <version>', "Obsidian version to run", "latest")
    .option('--installer-version <version>', "Obsidian installer version to run", "latest")
    .option<string[]>('-p, --plugin <plugin>',
        `Plugin to install. Format: "<path>" or "repo:<github-repo>" or "id:<community-id>". Can be repeated.`,
        (curr, prev) => [...prev, curr], [],
    )
    .option<string[]>('-t, --theme <plugin>',
        `Themes to install. Format: "<path>" or "repo:<github-repo>" or "name:<community-name>". Can be repeated but only last will be enabled.`,
        (curr, prev) => [...prev, curr], [],
    )
    .option('--no-copy', "Don't copy the vault")
    .action(async (vault, opts) => {
        vault = path.resolve(vault)
        const downloader = new ObsidianDownloader()
        const { appVersionInfo, installerVersionInfo } = await downloader.resolveVersions(
            opts.version, opts.installerVersion
        );

        const installerPath = await downloader.downloadInstaller(installerVersionInfo.version);
        const appPath = await downloader.downloadApp(appVersionInfo.version);

        const pluginEntries: PluginEntry[] = opts.plugin.map((p: string) => {
            if (p.startsWith("id:")) {
                return {id: p.slice(3)}
            } else if (p.startsWith("repo:")) {
                return {repo: p.slice(5)}
            } else {
                return {path: p}
            }
        })
        const plugins = await downloader.downloadPlugins(pluginEntries);

        const themeEntries: ThemeEntry[] = opts.theme.map((t: string, i: number) => {
            let result: ThemeEntry
            if (t.startsWith("name:")) {
                result = {name: t.slice(5)}
            } else if (t.startsWith("repo:")) {
                result = {repo: t.slice(5)}
            } else {
                result = {path: t}
            }
            return {...result, enabled: i == opts.theme.length - 1}
        })
        const themes = await downloader.downloadThemes(themeEntries)
        

        const tmpDir = await setupConfigAndVault({
            appVersion: appVersionInfo.version, installerVersion: installerVersionInfo.version,
            appPath: appPath,
            vault: vault, copyVault: opts.copy,
            plugins: plugins, themes: themes,
        });

        // Spawn child and detach
        const proc = child_process.spawn(installerPath, [
            `--user-data-dir=${tmpDir}/config`,
        ], {
            detached: true,
            stdio: 'ignore',
        })
        proc.unref()

        console.log(`Launched obsidian ${appVersionInfo.version}`)
    })

program
  .version(process.env.npm_package_version ?? "dev")
  .addCommand(launch)

program.parse();

