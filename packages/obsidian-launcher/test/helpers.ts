import os from "os"
import path from "path"
import fsAsync from "fs/promises"
import serverHandler from "serve-handler";
import http from "http";
import { AddressInfo } from "net";
import { after } from "mocha";
import { atomicCreate } from "../src/utils.js";
import { downloadResponse } from "../src/apis.js";
import { linkOrCp, fileExists } from "../src/utils.js";

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


type Endpoint = {path?: string, content?: string, fetch?: () => Promise<Response>};
export interface MockServer {
    url: string,
    addEndpoints(endpoints: Record<string, Endpoint>): Promise<void>,
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
export async function createServer(cacheDir: string, endpoints: Record<string, Endpoint> = {}): Promise<MockServer> {
    const serverDir = await createDirectory();
    const endpointsMap = new Map<string, Endpoint>()
    async function addEndpoints(endpoints: Record<string, Endpoint>) {
        for (const [servedPath, endpoint] of Object.entries(endpoints)) {
            endpointsMap.set(servedPath, endpoint);
        }
    }
    await addEndpoints(endpoints);

    const server = http.createServer(async (request, response) => {
        try {
            const requestPath = path.posix.normalize(request.url!).replace(/^\//, '');
            const endpoint = endpointsMap.get(requestPath);
            const dest = path.join(serverDir, requestPath);

            if (endpoint && !(await fileExists(dest))) {
                await fsAsync.mkdir(path.dirname(dest), {recursive: true});
                if (endpoint.fetch) {
                    const cacheDest = path.join(cacheDir, requestPath);
                    await atomicCreate(cacheDest, async (scratch) => {
                        await downloadResponse(endpoint.fetch!, path.join(scratch, "out"));
                        return path.join(scratch, "out");
                    }, {replace: false});
                    await linkOrCp(cacheDest, dest);
                } else if (endpoint.content) {
                    await fsAsync.writeFile(dest, endpoint.content);
                } else if (endpoint.path) {
                    await linkOrCp(endpoint?.path, dest);
                } else {
                    throw Error(`Endpoint ${requestPath} must set one of path, content, or fetch`);
                }
            }
            return serverHandler(request, response, {public: serverDir});
        } catch (e: any) {
            console.error(e);
            throw e;
        }
    });

    await new Promise<void>(resolve => server.listen({port: 0}, resolve));
    const port = (server.address() as AddressInfo).port;

    after(async function() {
        server.closeAllConnections();
        server.close();
    });

    return {
        url: `http://localhost:${port}`,
        addEndpoints,
    };
}
