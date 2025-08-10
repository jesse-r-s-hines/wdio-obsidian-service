import { execFileSync } from "child_process"
import fs from "fs"
import path from "path";
import { createInterface } from 'readline/promises';

async function main() {
    const versionArg = process.argv[2];
    if (!versionArg) {
        console.log("Please pass major|minor|patch|premajor|preminor|prepatch|prerelease");
        process.exit(1);
    }
    execFileSync("pnpm", ["version", versionArg, "--no-git-tag-version", '--preid', 'beta'], {encoding: 'utf-8'});
    const version = JSON.parse(fs.readFileSync("package.json", 'utf-8')).version;
    const isPrerelease = version.includes("-")

    const pkgs = fs.readdirSync("packages");
    for (let pkg of pkgs) {
        const pkgJsonPath = path.join("packages", pkg, "package.json");
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        pkgJson.version = version;
        // Update the inter-package dependencies
        for (let depPkg of pkgs) {
            if (pkgJson.dependencies?.[depPkg]) {
                pkgJson.dependencies[depPkg] = version;
            }
            if (pkgJson.devDependencies?.[depPkg]) {
                pkgJson.devDependencies[depPkg] = version;
            }
        }
        fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, undefined, 4) + "\n");
    }
    execFileSync("pnpm", ["install"]);
    console.log()

    let notes = "";
    if (!isPrerelease) {
        let changelog = fs.readFileSync("CHANGELOG.md", 'utf-8').trim()
        changelog += `\n\n## ${version}\n`;
        fs.writeFileSync("CHANGELOG.md", changelog);

        const rl = await createInterface({input: process.stdin, output: process.stdout});
        await rl.question("Add release notes in CHANGELOG.md, press ENTER when done...");
        changelog = fs.readFileSync("CHANGELOG.md", 'utf-8');
        const regex = new RegExp(`\n## ${version.replaceAll('.', '\\.')}(.*?)(\n## |$)`, 's');
        notes = changelog.match(regex)?.[1]?.trim() ?? '';
        await rl.close();
    }

    execFileSync("git", ["add",
        "package.json", "package-lock.json", "packages/*/package.json",
        "CHANGELOG.md",
    ]);
    execFileSync("git", ["commit", '-m', `Release ${version}`]);
    execFileSync("git", ["tag", '-a', version, '-m', notes]);

    console.log(`Release notes:`)
    console.log(`## ${version}` )
    console.log(notes)
    console.log()
    console.log(`Release ${version} ready. To finalize run:`)
    console.log(`    git push && git push origin tag ${version}`)
}

await main();



