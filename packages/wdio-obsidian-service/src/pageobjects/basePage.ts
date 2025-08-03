import * as wdioGlobals from "@wdio/globals"

/**
 * Base page object for use in the wdio [page object pattern](https://webdriver.io/docs/pageobjects).
 * 
 * You can pass the browser to the page object, which allows using the object even in wdio standalone mode.
 */
export class BasePage {
    private _browser: WebdriverIO.Browser|undefined
    constructor(browser?: WebdriverIO.Browser) {
        this._browser = browser;
    }

    /**
     * Returns the browser instance.
     * @hidden
     */
    protected get browser(): WebdriverIO.Browser {
        return this._browser ?? wdioGlobals.browser;
    }
}
