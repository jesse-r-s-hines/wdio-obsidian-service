import _ from "lodash"
import fs from "fs";
import { finished } from 'stream/promises';
import { Readable } from 'stream';
import { ReadableStream } from "stream/web"
import fsAsync from "fs/promises";
import readlineSync from "readline-sync";
import dotenv from "dotenv";
import path from "path";
import { consola } from "consola";
import { env } from "process";
import { sleep, retry, RetryOpts } from "./utils.js";

/**
 * GitHub API stores pagination information in the "Link" header. The header looks like this:
 * ```
 * <https://api.github.com/repositories/1300192/issues?page=2>; rel="prev", <https://api.github.com/repositories/1300192/issues?page=4>; rel="next"
 * ```
 */
export function parseLinkHeader(linkHeader: string): Record<string, Record<string, string>> {
    function parseLinkData(linkData: string) {
        return Object.fromEntries(
            linkData.split(";").flatMap(x => {
                const partMatch = x.trim().match(/^([^=]+?)\s*=\s*"?([^"]+)"?$/);
                return partMatch ? [[partMatch[1], partMatch[2]]] : [];
            })
        )
    }

    const linkDatas = linkHeader
        .split(/,\s*(?=<)/)
        .flatMap(link => {
            const linkMatch = link.trim().match(/^<([^>]*)>(.*)$/);
            if (linkMatch) {
                return [{
                    url: linkMatch[1],
                    ...parseLinkData(linkMatch[2]),
                } as Record<string, string>];
            } else {
                return [];
            }
        })
        .filter(l => l.rel)
    return Object.fromEntries(linkDatas.map(l => [l.rel, l]));
};

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


/**
 * Fetch from the GitHub API. Uses GITHUB_TOKEN if available. You can access the API without a token, but will hit
 * the usage caps very quickly.
 * 
 * Note that I'm not using the Octokit client, as it required `moduleResolution: node16` or higher, and I want to keep
 * support for old plugins and build setups. So I'm only using the Octokit package for types.
 */
export async function fetchGitHubAPI(url: string, params: SearchParamsDict = {}) {
    url = createURL(url, "https://api.github.com", params)
    const token = env.GITHUB_TOKEN;
    const headers: Record<string, string> = token ? {Authorization: "Bearer " + token} : {};
    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`GitHub API error: ${await response.text()}`);
    }
    return response;
}


/**
 * Fetch all data from a paginated GitHub API request.
 */
export async function fetchGitHubAPIPaginated(url: string, params: SearchParamsDict = {}) {
    const results: any[] = [];
    let next: string|undefined = createURL(url, "https://api.github.com", { per_page: 100, ...params });
    while (next) {
        const response = await fetchGitHubAPI(next);
        results.push(...await response.json());
        next = parseLinkHeader(response.headers.get('link') ?? '').next?.url;
    }
    return results;
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
    const cached = savePath ? dotenv.parse(await fsAsync.readFile(savePath).catch(() => '')) : {};
    let email = env.OBSIDIAN_EMAIL ?? cached.OBSIDIAN_EMAIL;
    let password = env.OBSIDIAN_PASSWORD ?? cached.OBSIDIAN_PASSWORD;
    let promptedCredentials = false;

    if (!email || !password) {
        if (interactive) {
            consola.log("Obsidian Insiders account is required to download Obsidian beta versions.")
            email = email || readlineSync.question("Obsidian email: ");
            password = password || readlineSync.question("Obsidian password: ", {hideEchoBack: true});
            promptedCredentials = true;
        } else  {
            throw Error(
                "Obsidian Insiders account is required to download Obsidian beta versions. Either set the " +
                "OBSIDIAN_EMAIL and OBSIDIAN_PASSWORD env vars (.env file is supported) or pre-download the " +
                "Obsidian beta with `npx obsidian-launcher download app -v <version>`"
            )
        }
    }

    type SigninResult = {token?: string, error?: string, license?: string};
    function parseSignin(r: any): SigninResult {
        return {token: r.token ? 'token' : undefined, error: r.error?.toString(), license: r.license}
    }

    let needsMfa = false;
    let retries = 0;
    let signin: SigninResult|undefined = undefined;
    while (!signin?.token && retries < 3) {
        // exponential backoff with random offset. Always trigger in CI to avoid multiple jobs hitting the API at once
        if (retries > 0 || env.CI) {
            await sleep(2*Math.random() + retries*retries * 3);
        }

        let mfa = '';
        if (needsMfa && interactive) {
            mfa = readlineSync.question("Obsidian 2FA: ");
        }

        const response = await fetch("https://api.obsidian.md/user/signin", {
            method: "post",
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.183 Safari/537.36',
                "Origin": "app://obsidian.md",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({email, password, mfa})
        }).then(r => r.json());
        signin = parseSignin(response);

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
            consola.warn(`Obsidian login failed: ${signin.error}`);
            consola.warn("Retrying obsidian login...")
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

    if (savePath && promptedCredentials) {
        const save = readlineSync.question("Cache credentails to disk? [y/n]: ");
        if (['y', 'yes'].includes(save.toLowerCase())) {
            // you don't need to escape ' in dotenv, it still reads to the last quote (weird...)
            await fsAsync.writeFile(savePath,
                `OBSIDIAN_EMAIL='${email}'\n` +
                `OBSIDIAN_PASSWORD='${password}'\n`
            );
            consola.log(`Saved Obsidian credentials to ${path.relative(process.cwd(), savePath)}`);
        }
    }

    return signin.token;
}

/**
 * Fetch from the Obsidian API to download insider versions.
 */
export async function fetchObsidianApi(url: string, opts: {token: string}) {
    if (!opts.token) {
        throw Error("Obsidian credentials required to download Obsidian beta release")
    }
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
 * Downloads a url to disk. Retries on failure.
 */
export async function downloadResponse(func: () => Promise<Response>, dest: string, opts: RetryOpts = {}) {
    await retry(async () => {
        const response = await func();
        if (!response.ok) {
            const error: any = Error(`${response.url} failed with ${response.status}`);
            error.status = response.status;
            throw error;
        }
        const fileStream = fs.createWriteStream(dest, { flags: 'w' });
        // not sure why I have to cast this
        const fetchStream = Readable.fromWeb(response.body as ReadableStream);
        await finished(fetchStream.pipe(fileStream));
    }, {
        retryIf: (e) => !e.status || !([401, 403, 404].includes(e.status)),
        ...opts,
    });
}
