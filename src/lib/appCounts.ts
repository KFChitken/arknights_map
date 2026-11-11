/**
 * 存到桌面's counts (src/lib/server/appCounts.ts), by the kind of device: opens from the home-screen
 * icon and in the browser (each once a device a day), taps on 存到桌面, and installs the browser
 * reported; and, counted by the server itself, 桌面登录码 taken and used. Totals only.
 */

export const DEVICES = ["iphone", "android", "harmony", "desktop"] as const;
export type Device = (typeof DEVICES)[number];

/** What a page may report, with its kind of device */
export const PAGE_COUNTS = ["standalone", "browser", "tap", "installed"] as const;
export type PageCount = (typeof PAGE_COUNTS)[number];

/** What the server counts by itself */
export const SERVER_COUNTS = ["code-issued", "code-redeemed"] as const;

/** A count's name: standalone:iphone, tap:desktop, code-issued… */
export type AppCountName = `${PageCount}:${Device}` | (typeof SERVER_COUNTS)[number];

const PAGE_NAMES = new Set<string>(PAGE_COUNTS.flatMap((kind) => DEVICES.map((d) => `${kind}:${d}`)));

/** Whether a page may report this name; anything else is dropped */
export const isPageCountName = (name: unknown): name is `${PageCount}:${Device}` => typeof name === "string" && PAGE_NAMES.has(name);

/** The admin page's 存到桌面 table: each of the last days, newest first, with every count that day */
export type AppCountDay = { day: string; counts: Partial<Record<AppCountName, number>> };
