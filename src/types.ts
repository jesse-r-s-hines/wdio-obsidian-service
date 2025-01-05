/**
 * Type of the obsidian-versions.json file.
 */
export type ObsidianVersionInfos = {
    latestSha: string,
    versions: ObsidianVersionInfo[],
}


export type ObsidianVersionInfo = {
    version: string,
    minInstallerVersion: string,
    maxInstallerVersion: string,
    isBeta: boolean,
    githubRelease?: string,
    downloads: {
        appImage?: string,
        appImageArm?: string,
        apk?: string,
        asar?: string,
        dmg?: string,
        exe?: string,
    },
    electronVersion?: string,
    chromeVersion?: string,
}
