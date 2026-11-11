import type { Device } from "./appCounts";

/**
 * 存到桌面: what kind of device and browser a page is in, from its user agent and how many touch
 * points it has, to say how to put the site on the desktop or home screen there. A guess from the
 * user agent: a browser that offers its own install prompt (Chrome, Edge) is asked directly instead.
 */

/** iPads say they are Macs, but have a touch screen; pure HarmonyOS (NEXT) says OpenHarmony and not Android */
export function deviceOf(ua: string, touchPoints: number): Device {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return "iphone";
  if (/OpenHarmony|HarmonyOS/.test(ua) && !/Android/.test(ua)) return "harmony";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

/** Apps that open links in a browser of their own, which cannot add to the home screen */
const IN_APP = /MicroMessenger|\bQQ\/|BiliApp|Weibo|__weibo__|XiaoHongShu|xhsdiscover|aweme|DingTalk|AlipayClient|baiduboxapp/i;

/**
 * inApp: inside an app (WeChat, QQ, bilibili…); ios: iPhone or iPad; macSafari: Safari on a Mac
 * (添加到程序坞); harmony and android: a phone browser without an install prompt; chromium: Chrome or
 * Edge on a computer whose prompt has not come (yet); desktop: any other computer browser.
 */
export type Guide = "inApp" | "ios" | "macSafari" | "harmony" | "android" | "chromium" | "desktop";

/** Chinese computer browsers built on Chromium say Chrome too, with a word of their own */
const OTHER_CHROMIUM = /OPR\/|QQBrowser|MetaSr|UBrowser|LBBROWSER|Maxthon|2345Explorer|360SE|360EE|QIHU|BIDUBrowser|TheWorld/;

export function guideOf(ua: string, touchPoints: number): Guide {
  const device = deviceOf(ua, touchPoints);
  // an Android app's web view says "; wv)"; an iPhone app's leaves out Safari/
  if (IN_APP.test(ua) || (device === "android" && /; wv\)/.test(ua)) || (device === "iphone" && !/Safari\//.test(ua))) return "inApp";
  if (device !== "desktop") return device === "iphone" ? "ios" : device;
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|Firefox\//.test(ua)) return "macSafari";
  if (/Edg\//.test(ua) || (/Chrome\//.test(ua) && !OTHER_CHROMIUM.test(ua))) return "chromium";
  return "desktop";
}
