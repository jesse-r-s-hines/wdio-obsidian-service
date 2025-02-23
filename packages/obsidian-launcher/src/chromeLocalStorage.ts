import path from "path"
import { ClassicLevel } from "classic-level"


/**
 * Class to directly manipulate chrome/electron local storage.
 *
 * Normally you'd just manipulate `localStorage` directly during the webdriver tests. However, there's not a built in
 * way to set up localStorage values *before* the app boots. We need to set `enable-plugins` and some other keys for
 * Obsidian to read during the boot process. This class lets us setup the local storage before launching Obsidian.
 */
export default class ChromeLocalStorage {
    private db: ClassicLevel;

    /** Pass the path to the user data dir for Chrome/Electron. If it doesn't exist it will be created. */
    constructor(public readonly userDataDir: string) {
        this.db = new ClassicLevel(path.join(userDataDir, 'Local Storage/leveldb/'));
    }

    private encodeKey = (domain: string, key: string) => `_${domain}\u0000\u0001${key}`;
    private decodeKey = (key: string) => key.slice(1).split("\u0000\u0001") as [string, string];
    private encodeValue = (value: string) => `\u0001${value}`;
    private decodeValue = (value: string) => value.slice(1);

    /**
     * Get a value from localStorage
     * @param domain Domain the value is under, e.g. "https://example.com" or "app://obsidian.md"
     * @param key Key to retreive
     */
    async getItem(domain: string, key: string): Promise<string|null> {
        const value = await this.db.get(this.encodeKey(domain, key));
        return (value === undefined) ? null : this.decodeValue(value);
    }

    /**
     * Set a value in localStorage
     * @param domain Domain the value is under, e.g. "https://example.com" or "app://obsidian.md"
     * @param key Key to set
     * @param value Value to set
     */
    async setItem(domain: string, key: string, value: string) {
        await this.db.put(this.encodeKey(domain, key), this.encodeValue(value))
    }

    /**
     * Removes a key from localStorage
     * @param domain Domain the values is under, e.g. "https://example.com" or "app://obsidian.md"
     * @param key key to remove.
     */
    async removeItem(domain: string, key: string) {
        await this.db.del(this.encodeKey(domain, key))
    }

    /** Get all items in localStorage as [domain, key, value] tuples */
    async getAllItems(): Promise<[string, string, string][]> {
        const result: [string, string, string][] = []
        for await (const pair of this.db.iterator()) {
            if (pair[0].startsWith("_")) { // ignore the META values
                const [domain, key] = this.decodeKey(pair[0]);
                const value = this.decodeValue(pair[1]);
                result.push([domain, key, value]);
            }
        }
        return result;
    }

    /**
     * Write multiple values to localStorage in batch
     * @param domain Domain the values are under, e.g. "https://example.com" or "app://obsidian.md"
     * @param data key/value mapping to write
     */
    async setItems(domain: string, data: Record<string, string>) {
        await this.db.batch(
            Object.entries(data).map(([key, value]) => ({
                type: "put",
                key: this.encodeKey(domain, key),
                value: this.encodeValue(value),
            }))
        )
    }

    /**
     * Close the localStorage database.
     */
    async close() {
        await this.db.close();
    }
}
