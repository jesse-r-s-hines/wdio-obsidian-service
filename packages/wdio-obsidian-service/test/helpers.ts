import { browser } from '@wdio/globals'
import fsAsync from "fs/promises"
import path from "path";
import os from "os";
import crypto from "crypto";

type FileInfo = {content?: string, mtime?: number, type?: 'file'|'folder'}
export async function getAllFiles(opts: {
    content?: boolean,
    mtime?: boolean,
    config?: boolean,
    folders?: boolean,
}): Promise<Record<string, FileInfo>> {
    return await browser.executeObsidian(async ({ app }, opts) => {
        async function listRecursive(path: string): Promise<Record<string, FileInfo>> {
            const result: Record<string, FileInfo> = {};
            const { folders, files } = await app.vault.adapter.list(path);
            for (const folder of folders) {
                if (opts.config || folder != ".obsidian") {
                    Object.assign(result, await listRecursive(folder));
                    if (opts.folders) {
                        result[folder] = {type: "folder"};
                    }
                }
            }
            for (const file of files) {
                const fileInfo: FileInfo = {};
                if (opts.content) {
                    fileInfo.content = (await app.vault.adapter.read(file)).replace(/\r\n/g, '\n');
                }
                if (opts.mtime) {
                    fileInfo.mtime = (await app.vault.adapter.stat(file))!.mtime;
                }
                if (opts.folders) {
                    fileInfo.type = "file";
                }
                result[file] = fileInfo;
            }
            return result;
        }
        return listRecursive("/");
    }, opts);
}

/**
 * Creates a temporary directory with the given files and contents. Cleans up the directory after the tests.
 * @param files Map of file path to file content.
 */
export async function createDirectory(files: Record<string, string> = {}) {
    const tmpDir = await fsAsync.mkdtemp(path.join(os.tmpdir(), "mocha-"));
    // after hook works even if its called within a test, though it doesn't run until the end of the test suite.
    after(async () => {
        await fsAsync.rm(tmpDir, { recursive: true, force: true });
    });

    for (const [file, content] of Object.entries(files)) {
        const dest = path.join(tmpDir, file);
        await fsAsync.mkdir(path.dirname(dest), { recursive: true });
        await fsAsync.writeFile(dest, content);
    }

    return tmpDir;
}

/** To make comparing binaries easier and with less log spam */
export function hash(buffer: ArrayBuffer|Buffer|Uint8Array) {
    return crypto.createHash("SHA256").update(new Uint8Array(buffer)).digest("hex");
}
