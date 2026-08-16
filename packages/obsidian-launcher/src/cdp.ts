import fsAsync from "fs/promises"
import path from "path"
import semver from "semver"
import CDP from "chrome-remote-interface";
import { ObsidianLauncher } from "./launcher.js";
import { consola, maybe, withTimeout, until, retry, UntilOpts, tryParseJson } from "./utils/misc.js";


/**
 * Launches Obsidian. Returns a CDP client connected to it and a function to cleanup the process and resources.
 * Mostly used for testing, but also used in updateVersionList.
 * 
 * This logic is somewhat duplicated with wdio-obsidian-service's setup, but I don't want obsidian-launcher to depend
 * on wdio or wdio-obsidian-service.
 */
export async function getCdpSession(
    launcher: ObsidianLauncher, params: Parameters<ObsidianLauncher['launch']>[0] & {vault: string},
) {
    const [appVersion, installerVersion] = await launcher.resolveVersion(
        params.appVersion ?? "latest",
        params.installerVersion ?? "latest",
    );

    const cleanup: (() => Promise<void>)[] = [];
    const doCleanup = async () => {
        for (const func of [...cleanup].reverse()) {
            await func()
        }
    }

    const pluginDir = path.join(params.vault, ".obsidian", "plugins", "obsidian-launcher");
    await fsAsync.mkdir(pluginDir, {recursive: true});
    await fsAsync.writeFile(path.join(pluginDir, "manifest.json"), JSON.stringify({
        id: "obsidian-launcher", name: "Obsidian Launcher",
        version: "1.0.0", minAppVersion: "0.0.1",
        description: "", author: "obsidian-launcher", isDesktopOnly: false
    }));
    await fsAsync.writeFile(path.join(pluginDir, "main.js"), `
        const obsidian = require('obsidian');
        class ObsidianLauncherPlugin extends obsidian.Plugin {
            async onload() { window.obsidianLauncher = {app: this.app, obsidian: obsidian}; };
        }
        module.exports = ObsidianLauncherPlugin;
    `);
    const communityPluginsPath = path.join(params.vault, ".obsidian", "community-plugins.json"); 
    let communityPlugins = ["obsidian-launcher"]
    communityPlugins = [...(await tryParseJson(communityPluginsPath) ?? []), ...communityPlugins];
    await fsAsync.writeFile(communityPluginsPath, JSON.stringify(communityPlugins));

    try {
        const launchResult = await launcher.launch({
            ...params,
            // will choose a random available port
            args: [`--remote-debugging-port=0`, '--test-type=webdriver', ...(params.args ?? [])],
        });
        if (params.copy) {
            cleanup.push(() => fsAsync.rm(launchResult.vault!, {recursive: true, force: true}));
        }
        const {proc} = launchResult;
        cleanup.push(() => retry(
            // Windows can hold resources afterafter the process exits, causing EBUSY
            () => fsAsync.rm(launchResult.configDir, {recursive: true, force: true}),
            {retries: 5, backoff: 200, retryIf: (e) => ["EBUSY", "EPERM", "ENOTEMPTY"].includes(e?.code)},
        ));
        const procExit = new Promise<number>((resolve) => proc.on('close', (code) => resolve(code ?? -1)));
        cleanup.push(async () => {
            proc.kill("SIGTERM");
            const timeout = await maybe(withTimeout(procExit, 5 * 1000));
            if (!timeout.success) {
                consola.warn(`Stuck process ${proc.pid}, using SIGKILL`);
                proc.kill("SIGKILL");
            }
            await procExit;
        });

        // Wait for the logs showing that Obsidian is ready, and pull the chosen DevTool Protocol port from it
        const portPromise = new Promise<number>((resolve, reject) => {
            void procExit.then(() => reject(Error("Processed ended without opening a port")));
            proc.stderr!.on('data', data => {
                const port = data.toString().match(/ws:\/\/[\w.]+?:(\d+)/)?.[1];
                if (port) {
                    resolve(Number(port));
                }
            });
        });
        const port = await maybe(withTimeout(portPromise, 20 * 1000));
        if (!port.success) {
            throw new Error("Timed out waiting for Chrome DevTools protocol port");
        }

        const client = await CDP({port: port.result});
        cleanup.push(() => client.close());

        const expr = semver.gte(appVersion, '0.12.8') ? "!!window.obsidianLauncher" : "!!window.app.workspace";
        await until(
            () => client.Runtime.evaluate({expression: expr}).then(r => r.result.value),
            {timeout: 5000},
        );

        return {
            ...launchResult,
            client,
            cleanup: doCleanup,
            vault: launchResult.vault!,
        };
    } catch (e: any) {
        await doCleanup();
        throw e;
    }
}

export async function cdpEvaluate(client: CDP.Client, expression: string) {
    const response = await client.Runtime.evaluate({ expression, returnByValue: true });
    if (response.exceptionDetails) {
        throw Error(response.exceptionDetails.text);
    }
    return response.result.value;
}

export async function cdpEvaluateUntil(client: CDP.Client, expression: string, opts: UntilOpts) {
    return await until(() => cdpEvaluate(client, expression), opts);
}
