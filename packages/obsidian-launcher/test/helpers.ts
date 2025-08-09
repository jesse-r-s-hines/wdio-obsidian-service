import os from "os"
import path from "path"
import fsAsync from "fs/promises"
import serverHandler from "serve-handler";
import http from "http";
import { AddressInfo } from "net";
import { after } from "mocha";
import { fileExists, atomicCreate } from "../src/utils.js";
import { downloadResponse } from "../src/apis.js";
import { linkOrCp } from "../src/utils.js";

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


/** Downloads downloads url to dest dir if dest doesn't exist, returns the cached path. */
export async function cachedDownload(url: string, cacheDir: string) {
    const dest = path.join(cacheDir, url.split("/").at(-1)!);
    if (!(await fileExists(dest))) {
        await atomicCreate(dest, async (tmpDir) => {
            await downloadResponse(await fetch(url), path.join(tmpDir, "out"));
            return path.join(tmpDir, "out");
        })
    }
    return dest;
}


type Endpoint = {path?: string, content?: string};
export interface MockServer {
    url: string,
    addEndpoints(endpoints: Record<string, Endpoint>): Promise<void>,
}

async function addEndpoints(serverDir: string, endpoints: Record<string, Endpoint>) {
    for (const [servedPath, src] of Object.entries(endpoints)) {
        const dest = path.join(serverDir, servedPath);
        await fsAsync.mkdir(path.dirname(dest), {recursive: true});
        if (src.path) {
            await linkOrCp(src.path, dest);
        } else if (src.content) {
            await fsAsync.writeFile(dest, src.content);
        } else {
            throw Error("Must specify one of path or content");
        }
    }
}

/**
 * Creates a mock http file server.
 * Pass a map of the endpoints to create. Each endpoint can be set to one of:
 * - path: serve a local file
 * - content: serve that string
 * 
 * Returns an object containing the url to the server, e.g. "http://localhost:8080" and a method to add more files
 * later.
 */
export async function createServer(endpoints: Record<string, Endpoint> = {}): Promise<MockServer> {
    const serverDir = await createDirectory();
    await addEndpoints(serverDir, endpoints);
    const server = http.createServer((request, response) => {
        return serverHandler(request, response, {public: serverDir});
    });
    await new Promise<void>(resolve => server!.listen({port: 0}, resolve));
    const port = (server.address() as AddressInfo).port;

    after(async function() {
        server?.closeAllConnections();
        server?.close();
    });

    return {
        url: `http://localhost:${port}`,
        addEndpoints: (endpoints) => addEndpoints(serverDir, endpoints),
    };
}
