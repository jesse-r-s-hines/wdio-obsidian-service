// Used in the npm version script
import {execFileSync} from "child_process"
import fs from "fs"

const version = process.env.npm_package_version;
execFileSync("npm", ["version", version, "--no-git-tag-version", "--workspaces"]);
const servicePackageJsonPath = "packages/wdio-obsidian-service/package.json"
const servicePackageJson = JSON.parse(fs.readFileSync(servicePackageJsonPath, "utf-8"));
// Update the inter-package dependencies
servicePackageJson.dependencies["obsidian-launcher"]=`^${version}`;
servicePackageJson.devDependencies["wdio-obsidian-reporter"]=`^${version}`;
fs.writeFileSync(servicePackageJsonPath, JSON.stringify(servicePackageJson, undefined, 4) + "\n");
execFileSync("npm", ["install"]);
