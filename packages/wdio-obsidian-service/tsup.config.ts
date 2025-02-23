import { defineConfig } from "tsup";
import fs from "fs";
const packageJson = JSON.parse(await fs.readFileSync("./package.json", 'utf-8'))

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["cjs", "esm"], // Build for commonJS and ESmodules
    dts: true, // Generate declaration file (.d.ts)
    sourcemap: true,
    clean: true,
    shims: true,
    env: {
        npm_package_version: packageJson.version,
    },
});
