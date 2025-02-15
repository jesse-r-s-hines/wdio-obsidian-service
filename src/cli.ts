#!/bin/env node
import path from "path"
import { Command } from 'commander';
import child_process from "child_process"
import ObsidianLauncher from "./obsidianLauncher.js"
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
    .option('--copy', "Copy the vault first.")
    .action(async (vault, opts) => {
        vault = path.resolve(vault)
        const launcher = new ObsidianLauncher()
        const [appVersion, installerVersion] = await launcher.resolveVersions(opts.version, opts.installerVersion);

        const appPath = await launcher.downloadApp(appVersion);
        const installerPath = await launcher.downloadInstaller(installerVersion);

        const plugins: PluginEntry[] = opts.plugin.map((p: string) => {
            if (p.startsWith("id:")) {
                return {id: p.slice(3)}
            } else if (p.startsWith("repo:")) {
                return {repo: p.slice(5)}
            } else {
                return {path: p}
            }
        })

        const themes: ThemeEntry[] = opts.theme.map((t: string, i: number) => {
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
        
        if (opts.copy) {
            vault = await launcher.copyVault(vault);
        }

        const configDir = await launcher.setupConfigDir({
            appVersion: appVersion, installerVersion: installerVersion,
            appPath: appPath,
            vault: vault,
            plugins: plugins, themes: themes,
        });

        // Spawn child and detach
        const proc = child_process.spawn(installerPath, [
            `--user-data-dir=${configDir}`,
        ], {
            detached: true,
            stdio: 'ignore',
        })
        proc.unref()

        console.log(`Launched obsidian ${appVersion}`)
    })

program
  .version(process.env.npm_package_version ?? "dev")
  .addCommand(launch)

program.parse();

