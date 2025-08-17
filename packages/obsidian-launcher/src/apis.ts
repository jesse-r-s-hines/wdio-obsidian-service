import _ from "lodash"
import fs from "fs";
import { finished } from 'stream/promises';
import { Readable } from 'stream';
import { ReadableStream } from "stream/web"
import fsAsync from "fs/promises";
import readlineSync from "readline-sync";
import dotenv from "dotenv";
import path from "path";
import { Octokit } from "octokit";
import { env } from "process";
import { sleep } from "./utils.js";


type SearchParamsDict = Record<string, string|number|undefined>;
function createURL(url: string, base: string, params: SearchParamsDict = {}) {
    const cleanParams = _(params).pickBy(x => x !== undefined).mapValues(v => String(v)).value();
    const urlObj = new URL(url, base);
    const searchParams = new URLSearchParams({...Object.fromEntries(urlObj.searchParams), ...cleanParams});
    if ([...searchParams].length > 0) {
        urlObj.search = '?' + searchParams;
    }
    return urlObj.toString();
}

export function getGithubClient(): Octokit {
    return new Octokit({auth: env.GITHUB_TOKEN});
}

/**
 * Login and returns the token from the Obsidian API.
 * @param opts.interactive if true, we can prompt the user for credentials
 * @param opts.savePath Save/cache Obsidian credentials to this path
 */
export async function obsidianApiLogin(opts: {
    interactive?: boolean,
    savePath?: string,
}): Promise<string> {
    const {interactive = false, savePath} = opts;
    // you can also just use a regular .env file, but we'll prompt to cache credentials for convenience
    // The root .env is loaded elsewhere
    if (savePath) dotenv.config({path: [savePath], quiet: true});

    let email = env.OBSIDIAN_EMAIL;
    let password = env.OBSIDIAN_PASSWORD;
    if (!email || !password) {
        if (interactive) {
            console.log("Obsidian Insiders account is required to download Obsidian beta versions.")
            email = email || readlineSync.question("Obsidian email: ");
            password = password || readlineSync.question("Obsidian password: ", {hideEchoBack: true});
        } else  {
            throw Error(
                "Obsidian Insiders account is required to download Obsidian beta versions. Either set the " +
                "OBSIDIAN_EMAIL and OBSIDIAN_PASSWORD env vars (.env file is supported) or pre-download the " +
                "Obsidian beta with `npx obsidian-launcher download app -v <version>`"
            )
        }
    }

    let needsMfa = false;
    let retries = 0;
    type SigninResult = {token?: string, error?: string, license?: string};
    let signin: SigninResult|undefined = undefined;
    while (!signin?.token && retries < 3) {
        // exponential backoff with random offset. Always trigger in CI to avoid multiple jobs hitting the API at once
        if (retries > 0 || env.CI) {
            await sleep(2*Math.random() + retries*retries * 2);
        }

        let mfa = '';
        if (needsMfa && interactive) {
            mfa = readlineSync.question("Obsidian 2FA: ");
        }

        signin = await fetch("https://api.obsidian.md/user/signin", {
            method: "post",
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.183 Safari/537.36',
                "Origin": "app://obsidian.md",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({email, password, mfa})
        }).then(r => r.json()) as SigninResult;

        const error = signin.error?.toLowerCase();
        if (error?.includes("2fa") && !needsMfa) {
            needsMfa = true; // when interactive, continue to next loop
            if (!interactive) {
                throw Error(
                    "Can't login with 2FA in a non-interactive session. To download Obsidian beta versions, either " +
                    "disable 2FA on your account or pre-download the Obsidian beta with " +
                    "`npx obsidian-launcher download app -v <version>`"
                );
            }
        } else if (["please wait", "try again"].some(m => error?.includes(m))) {
            console.warn(`Obsidian login failed: ${signin.error}`);
            retries++; // continue to next loop
        } else if (!signin.token) { // fatal error
            throw Error(`Obsidian login failed: ${signin.error ?? 'unknown error'}`);
        }
    }

    if (!signin?.token) {
        throw Error(`Obsidian login failed: ${signin?.error ?? 'unknown error'}`);
    } else if (!signin?.license) {
        throw Error("Obsidian Insiders account is required to download Obsidian beta versions");
    }

    if (interactive && savePath && (!env.OBSIDIAN_EMAIL || !env.OBSIDIAN_PASSWORD)) {
        const save = readlineSync.question("Cache credentails to disk? [y/n]: ");
        if (['y', 'yes'].includes(save.toLowerCase())) {
            // you don't need to escape ' in dotenv, it still reads to the last quote (weird...)
            await fsAsync.writeFile(savePath,
                `OBSIDIAN_EMAIL='${email}'\n` +
                `OBSIDIAN_PASSWORD='${password}'\n`
            );
            console.log(`Saved Obsidian credentials to ${path.relative(process.cwd(), savePath)}`);
        }
    }

    return signin.token;
}

/**
 * Fetch from the Obsidian API to download insider versions.
 */
export async function fetchObsidianApi(url: string, opts: {token: string}) {
    url = createURL(url, "https://releases.obsidian.md");
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.183 Safari/537.36',
            "Origin": "app://obsidian.md",
            'Authorization': 'Bearer ' + opts.token,
        },
    })
    return response;
}

/**
 * Downloads a url to disk.
 */
export async function downloadResponse(response: Response, dest: string) {
    if (!response.ok) {
        throw Error(`${response.url} failed with ${response.status}`);
    }
    const fileStream = fs.createWriteStream(dest, { flags: 'w' });
    // not sure why I have to cast this
    const fetchStream = Readable.fromWeb(response.body as ReadableStream);
    await finished(fetchStream.pipe(fileStream));
}
