import { defineConfig } from "tsup";
import fs from "fs";
const packageJson = JSON.parse(fs.readFileSync("./package.json", 'utf-8'))

export default defineConfig({
    entry: {
        index: "src/index.ts",
        cli: "src/cli.ts",
        "7z": "src/utils/7z.js", // output at root
    },
    format: ["cjs", "esm"], // Build for commonJS and ESmodules
    dts: true, // Generate declaration file (.d.ts)
    splitting: true,
    sourcemap: true,
    clean: true,
    shims: true,
    env: {
        npm_package_version: packageJson.version,
    },
    minify: false,
});
