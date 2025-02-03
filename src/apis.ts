import _ from "lodash"
import fetch from "node-fetch";
import fsAsync from "fs/promises";
import { fileURLToPath } from "url";


/**
 * GitHub API stores pagination information in in "Link" header. The header will look like this
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


export async function fetchGitHubAPI(url: string, params: Record<string, any> = {}) {
    url = createURL(url, "https://api.github.com", params)
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = token ? {Authorization: "Bearer " + token} : {};
    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`GitHub API error: ${await response.text()}`);
    }
    return await response;
}


export async function fetchGitHubAPIPaginated(url: string, params: Record<string, any> = {}) {
    const results = [];
    let next: string|undefined = createURL(url, "https://api.github.com", { per_page: 100, ...params });
    while (next) {
        const response = await fetchGitHubAPI(next);
        results.push(...await response.json() as any);
        next = parseLinkHeader(response.headers.get('link') ?? '').next?.url;
    }
    return results;
}


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
 * Fetches a URL returning its content as a string. Throws if response is not OK.
 * URL can be a file url.
 */
export async function fetchWithFileUrl(url: string) {
    if (url.startsWith("file:")) {
        return await fsAsync.readFile(fileURLToPath(url), 'utf-8');
    } else {
        const response = await fetch(url);
        if (response.ok) {
            return response.text()
        } else {
            throw Error(`Request failed with ${response.status}: ${response.text()}`)
        }
    }
}
