import { browser, expect } from '@wdio/globals'
import path from "path"
import { OBSIDIAN_CAPABILITY_KEY } from '../../src/types.js';
import { sleep } from '../../src/utils.js';


describe("Basic obsidian launch", () => {
    it('Basic', async () => {
        // console.log({
        //     settings: await browser.getSettings(),
        //     context: await browser.getContext({returnDetailedContext: true}),
        //     contexts: await browser.getContexts({returnDetailedContexts: true, isAndroidWebviewVisible: false}),
        // })
        // const elem = await browser.$(".status-bar");
        // console.log(elem, await elem.getHTML())
        console.log("localstorage in test", await browser.execute(async () => {
            const rand = Math.trunc(Math.random() * 1_000_000).toString();
            localStorage.setItem(`foo-${rand}`, rand);
            const data: any = {}
            for (let i = 0, len = localStorage.length; i < len; ++i ) {
                const key = localStorage.key(i)!;
                const value = localStorage.getItem(key);
                data[key] = value;
            }
            return data;
        }));
    })

    // it('Vault opened', async () => {
    //     const vaultPath = await browser.executeObsidian(({app}) => (app.vault.adapter as any).getBasePath());

    //     // Should have created a copy of vault
    //     expect(path.basename(vaultPath)).toMatch(/^basic-/)

    //     const vaultFiles = await browser.executeObsidian(({app}) =>dd
    //         app.vault.getMarkdownFiles().map(x => x.path).sort()
    //     );
    //     expect(vaultFiles).toEqual(["Goodbye.md", "Welcome.md"]);
    // })

    it("Wait", async () => {
        while (true) {
            // await browser.execute(() => { return 1 });
            await browser.getSettings()
            await sleep(10 * 1000);
        }
    });
})



