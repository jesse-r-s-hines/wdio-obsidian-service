/**
 * Script to test downloading and launching all listed Obsidian versions.
 */
import { pathToFileURL, fileURLToPath } from "url"
import path from "path"
import fsAsync from "fs/promises"
import CDP from 'chrome-remote-interface'
import { makeTmpDir, withTimeout, pool, maybe, sleep, Maybe } from "../src/utils.js"
import { ObsidianLauncher } from "../src/launcher.js"
import { ChildProcess } from "child_process"
import { ObsidianVersionInfo } from "../src/types.js"

const rootPath = path.resolve(path.join(fileURLToPath(import.meta.url), "../../../.."))
const obsidianVersionsJson = path.join(rootPath, "obsidian-versions.json");

async function checkVaultPath(proc: ChildProcess): Promise<string> {
    // Wait for the logs showing that Obsidian is ready, and pull the chosen DevTool Protocol port from it
    const portPromise = new Promise<number>((resolve, reject) => {
        proc.stderr!.on('data', data => {
            const port = data.toString().match(/ws:\/\/[\w.]+?:(\d+)/)?.[1];
            if (port) {
                resolve(Number(port));
            }
        });
    })
    const port = await withTimeout(portPromise, 2000);
    const client = await CDP({port: port});
    let response: any
    while (!response || response.exceptionDetails) {
        response = await client.Runtime.evaluate({ expression: "app.vault.adapter.getBasePath()" });
    }
    return response.result.value;
}

async function testVersion(appVersion: string, installerVersion: string): Promise<string> {
    const launcher = new ObsidianLauncher({
        versionsUrl: pathToFileURL(obsidianVersionsJson).toString(),
    })

    const vault = await makeTmpDir('obs-launcher-vault-');
    
    const { proc, configDir } = await launcher.launch({
        appVersion, installerVersion,
        vault: vault,
        args: [
            `--remote-debugging-port=0`, // 0 will make it choose a random available port
            '--no-sandbox',
            '--test-type=webdriver',
        ],
    })
    const procExit = new Promise<number>((resolve) => proc.on('exit', (code) => resolve(code ?? -1)));
    // proc.stdout.on('data', data => console.log(`stdout: ${data}`));
    // proc.stderr.on('data', data => console.log(`stderr: ${data}`));

    try {
        return await withTimeout(checkVaultPath(proc), 10 * 1000);
    } finally {
        proc.kill("SIGKILL")
        proc.kill("SIGTERM")
        await procExit;
        await sleep(1000); // Need to wait a bit or sometimes the rm fails because something else is writing to it
        fsAsync.rm(configDir, {recursive: true, force: true});
        fsAsync.rm(vault!, {recursive: true, force: true});
    }
}


async function main() {
    const allVersions: ObsidianVersionInfo[] = JSON.parse(await fsAsync.readFile(obsidianVersionsJson, 'utf-8')).versions;

    const versions = allVersions
        .filter(v => v.minInstallerVersion && v.maxInstallerVersion && v.downloads.asar)
        .flatMap(v => [
            [v.version, v.minInstallerVersion!],
            [v.version, v.maxInstallerVersion!],
        ])
        .reverse()
    
    const results = await pool(16,
        versions,
        async ([appVersion, installerVersion]) => {
            console.log(`Testing ${appVersion} ${installerVersion}`)
            return [
                appVersion, installerVersion,
                await maybe(testVersion(appVersion, installerVersion)),
            ] as [string, string, Maybe<string>]
        }
    )

    console.log("\n\n");
    console.log("Results:");
    for (const [appVersion, installerVersion, result] of results) {
        console.log(`${appVersion} ${installerVersion}: ${result.success ? "SUCCESS" : "FAIL"} ${result.result ?? result.error}`);
    }
}

main()
