/**
 * Script wrapper for 7z-wasm. 7z-wasm comes with it's own CLI, but getting the binary path can be flaky depending on
 * how wdio-obsidian-service is installed. This also lets us customize it a bit. This does need to be called as a
 * subprocess to avoid blocking the main thread.
 */
import path from "path";
import SevenZip from "7z-wasm"

async function main() {
    const sevenZip = await SevenZip.default({
        // stdin: () => {},
        stdout: (charCode) => {
            if (charCode !== null) {
                process.stdout.write(String.fromCharCode(charCode));
            }
        },
        quit: (code) => {
            if (code) {
                process.exit(code);
            }
        }
    });
    // HACK: The WASM 7-Zip sets file mode to 000 when extracting tar archives, making it impossible to extract sub-folders
    const chmodOrig = sevenZip.FS.chmod.bind(sevenZip.FS);
    sevenZip.FS.chmod = function(path, mode, dontFollow) {
        if (!mode) {
            return;
        }
        chmodOrig(path, mode, dontFollow);
    };

    const cwd = process.cwd();
    const hostRoot = path.parse(cwd).root;
    const hostDir = path.relative(hostRoot, cwd).split(path.sep).join("/");
    const mountRoot = "/nodefs";
    sevenZip.FS.mkdir(mountRoot);
    sevenZip.FS.mount(sevenZip.NODEFS, { root: hostRoot }, mountRoot);
    sevenZip.FS.chdir(mountRoot + "/" + hostDir);

    var args = process.argv.slice(2);
    sevenZip.callMain(args);
}

main().catch(e => {
    console.error(e);
    process.exit(-1);
});
