import os from "os"
import path from "path"
import fsAsync from "fs/promises"
import { after } from "mocha";


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
