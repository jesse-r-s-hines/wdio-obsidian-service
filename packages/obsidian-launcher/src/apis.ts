import _ from "lodash"
import fs from "fs";
import { finished } from 'stream/promises';
import { Readable } from 'stream';
import { ReadableStream } from "stream/web"
import fsAsync from "fs/promises";
import readlineSync from "readline-sync";

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


function createURL(url: string, base: string, params: Record<string, any> = {}) {
    params =_.pickBy(params, x => x !== undefined);
    const urlObj = new URL(url, base);
    const searchParams = new URLSearchParams({...Object.fromEntries(urlObj.searchParams), ...params});
    if ([...searchParams].length > 0) {
        urlObj.search = '?' + searchParams;
    }
    return urlObj.toString();
}


/**
 * Fetch from the GitHub API. Uses GITHUB_TOKEN if available. You can access the API without a token, but will hit
 * the usage caps very quickly.
 */
export async function fetchGitHubAPI(url: string, params: Record<string, any> = {}) {
    url = createURL(url, "https://api.github.com", params)
    const token = process.env.GITHUB_TOKEN;
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
export async function fetchGitHubAPIPaginated(url: string, params: Record<string, any> = {}) {
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
    // these will be populated by dotenv
    let email = process.env.OBSIDIAN_EMAIL;
    let password = process.env.OBSIDIAN_PASSWORD;
    let mfa: string|undefined;

    if (!email || !password) {
        if (interactive) {
            console.log("Obsidian Insiders account is required to download Obsidian beta versions.")
            email = email || readlineSync.question("Obsidian email: ");
            password = password || readlineSync.question("Obsidian password: ", {hideEchoBack: true});
        } else  {
            throw Error(
                "Obsidian Insiders account is required to download Obsidian beta versions.  Either set the " +
                "OBSIDIAN_EMAIL and OBSIDIAN_PASSWORD env vars (.env is supported) or pre-download the Obsidian beta " +
                "with `npx obsidian-launcher download -v <version>`"
            )
        }
    }

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.183 Safari/537.36',
        "Origin": "app://obsidian.md",
        "Content-Type": "application/json",
    }
    let signin = await fetch("https://api.obsidian.md/user/signin", {
        method: "post",
        headers: headers,
        body: JSON.stringify({email, password, mfa: ''})
    }).then(r => r.json());
    if (signin.error && signin.error.includes("2FA")) {
        if (interactive) {
            mfa = await readlineSync.question("Obsidian 2FA: ");
            signin = await fetch("https://api.obsidian.md/user/signin", {
                method: "post",
                headers: headers,
                body: JSON.stringify({email, password, mfa})
            }).then(r => r.json());
        } else {
            throw Error(
                "Can't login with 2FA in a non-interactive session. To download Obsidian beta versions, either " +
                "disable 2FA on your account or pre-download the Obsidian beta with " +
                "`npx obsidian-launcher download -v <version>`"
            )
        }
    }

    let error: any = undefined;
    if (!signin.token) {
        error = Error(`Obsidian login failed: ${signin.error}`)
    }
    if (!error && !signin.license) {
        error = Error("Obsidian Insiders account is required to download Obsidian beta versions")
    }
    if (error) {
        if (savePath) { // clear credential cache if credentials are invalid
            await fsAsync.rm(savePath, {force: true});
        }
        throw error;
    }

    if (interactive && savePath && (!process.env.OBSIDIAN_EMAIL || !process.env.OBSIDIAN_PASSWORD)) {
        const save = readlineSync.question("Save credentails to disk? [y/n]: ");
        if (['y', 'yes'].includes(save.toLocaleLowerCase())) {
            await fsAsync.writeFile(savePath,
                `OBSIDIAN_EMAIL='${email}'\n` +
                `OBSIDIAN_PASSWORD='${password}'\n`
            );
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
