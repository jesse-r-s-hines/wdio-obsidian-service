import { browser, expect } from '@wdio/globals'

export async function getAllFiles(opts: {content?: boolean, mtime?: boolean, config?: boolean}) {
    type FileInfo = {content?: string, mtime?: number}
    return await browser.executeObsidian(async ({ app }, opts) => {
        async function listRecursive(path: string): Promise<Record<string, FileInfo>> {
            const result: Record<string, FileInfo> = {};
            const { folders, files } = await app.vault.adapter.list(path);
            for (const folder of folders) {
                Object.assign(result, await listRecursive(folder));
            }
            for (const file of files) {
                if (opts.config || !file.startsWith(".obsidian/")) {
                    const fileInfo: FileInfo = {};
                    if (opts.content) {
                        fileInfo.content = (await app.vault.adapter.read(file)).replace(/\r\n/g, '\n');
                    }
                    if (opts.mtime) {
                        fileInfo.mtime = (await app.vault.adapter.stat(file))!.mtime;
                    }
                    result[file] = fileInfo;
                }
            }
            return result;
        }
        return listRecursive("/");
    }, opts);
}
