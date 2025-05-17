import _ from "lodash"
import fs from "fs";
import { finished } from 'stream/promises';
import { Readable } from 'stream';
import { ReadableStream } from "stream/web"

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
 * Fetch from the Obsidian API to download insider versions. Uses OBSIDIAN_USERNAME and
 * OBSIDIAN_PASSWORD environment variables.
 */
export async function fetchObsidianAPI(url: string) {
    url = createURL(url, "https://releases.obsidian.md");

    const username = process.env.OBSIDIAN_USERNAME;
    const password = process.env.OBSIDIAN_PASSWORD;
    if (!username || !password) {
        throw Error("OBSIDIAN_USERNAME or OBSIDIAN_PASSWORD environment variables are required to access the Obsidian API for beta versions.")
    }

    const response = await fetch(url, {
        headers: {
            // For some reason you have to set the User-Agent or it won't let you download
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.183 Safari/537.36',
            "Origin": "app://obsidian.md",
            'Authorization': 'Basic ' + btoa(username + ":" + password),
        },
    })
    return response;
}

/**
 * Downloads a url to disk.
 */
export async function downloadResponse(response: Response, dest: string) {
    const fileStream = fs.createWriteStream(dest, { flags: 'w' });
    // not sure why I have to cast this
    const fetchStream = Readable.fromWeb(response.body as ReadableStream);
    await finished(fetchStream.pipe(fileStream));
}
