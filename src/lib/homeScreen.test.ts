import { describe, expect, it } from "vitest";
import { deviceOf, guideOf } from "./homeScreen";

// user agents as these browsers send them (versions vary)
const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1",
  iphoneWechat:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2c) NetType/WIFI Language/zh_CN",
  iphoneBili: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BiliApp/77300100 os/ios",
  iphoneQQ: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 QQ/9.0.20.610 V1_IPH_SQ_9.0.20_1_APP_A Pixel/1170",
  ipadDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  winFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  winQQBrowser:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.71 Safari/537.36 Core/1.94.236.400 QQBrowser/12.4.5620.400",
  winSogou: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 SE 2.X MetaSr 1.0",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 13; SM-S9180 Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36",
  androidWechat:
    "Mozilla/5.0 (Linux; Android 14; 23127PN0CC Build/UKQ1.230804.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.120 Mobile Safari/537.36 XWEB/1220133 MMWEBSDK/20240404 MMWEBID/2307 MicroMessenger/8.0.49.2600(0x2800313D) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64",
  huaweiAndroid:
    "Mozilla/5.0 (Linux; Android 12; HarmonyOS; NOH-AN00; HMSCore 6.13.0.302) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 HuaweiBrowser/15.0.4.312 Mobile Safari/537.36",
  harmonyNext:
    "Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 ArkWeb/4.1.6.1 Mobile HuaweiBrowser/5.0.4.300",
  douyin: "Mozilla/5.0 (Linux; Android 13; V2227A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.153 Mobile Safari/537.36 aweme_290100 JsSdk/1.0",
  weibo: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Weibo (iPhone15,3__weibo__13.11.1__iphone__os17.1)",
};

describe("存到桌面 by device and browser", () => {
  it("tells the kind of device, iPads that say they are Macs and pure HarmonyOS included", () => {
    expect(deviceOf(UA.iphoneSafari, 5)).toBe("iphone");
    expect(deviceOf(UA.ipadDesktop, 5)).toBe("iphone");
    expect(deviceOf(UA.ipadDesktop, 0)).toBe("desktop");
    expect(deviceOf(UA.androidChrome, 5)).toBe("android");
    expect(deviceOf(UA.huaweiAndroid, 5)).toBe("android");
    expect(deviceOf(UA.harmonyNext, 5)).toBe("harmony");
    expect(deviceOf(UA.winEdge, 0)).toBe("desktop");
  });

  it("sends players inside an app to a browser first", () => {
    for (const ua of [UA.iphoneWechat, UA.iphoneBili, UA.iphoneQQ, UA.androidWebView, UA.androidWechat, UA.douyin, UA.weibo]) {
      expect(guideOf(ua, 5), ua).toBe("inApp");
    }
  });

  it("explains the browser's own way everywhere else", () => {
    expect(guideOf(UA.iphoneSafari, 5)).toBe("ios");
    expect(guideOf(UA.iphoneChrome, 5)).toBe("ios");
    expect(guideOf(UA.ipadDesktop, 5)).toBe("ios");
    expect(guideOf(UA.ipadDesktop, 0)).toBe("macSafari");
    expect(guideOf(UA.macChrome, 0)).toBe("chromium");
    expect(guideOf(UA.winEdge, 0)).toBe("chromium");
    expect(guideOf(UA.androidChrome, 5)).toBe("android");
    expect(guideOf(UA.huaweiAndroid, 5)).toBe("android");
    expect(guideOf(UA.harmonyNext, 5)).toBe("harmony");
    for (const ua of [UA.winFirefox, UA.winQQBrowser, UA.winSogou]) expect(guideOf(ua, 0), ua).toBe("desktop");
  });
});
