export async function fetchGitHubAPI(url: string, params: Record<string, any> = {}) {
    url = `${new URL(url, "https://api.github.com")}?${new URLSearchParams(params)}`;
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = token ? {Authorization: "Bearer " + token} : {};
    const response = await fetch(url, {headers});
    if (!response.ok) {
        throw new Error(`GitHub API error: ${await response.text()}`);
    }
    return await response.json();
}


export async function fetchGitHubAPIPaginated(url: string, params: Record<string, any> = {}) {
    const results = [];
    let page = 1;
    while (true) {
        const response = await fetchGitHubAPI(url, {
            per_page: 100, page: page,
            ...params,
        })
        results.push(...response);
        page += 1;
        if (response.length <= 0) break;
    }
    return results;
}


export async function fetchObsidianAPI(url: string) {
    url = new URL(url, "https://releases.obsidian.md").toString()

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
