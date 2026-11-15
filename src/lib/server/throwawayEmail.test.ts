import { domainToUnicode } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import data from "@/data/throwaway-email-domains.json";
import { THROWAWAY_EMAIL } from "../rules";
import { HttpError } from "./http";
import { isThrowawayEmail, throwawayRefusal } from "./throwawayEmail";

/** Every address Guerrilla Mail hands out, by the domains it offers */
const GUERRILLA = [
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.biz",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamailblock.com",
  "sharklasers.com",
  "grr.la",
  "pokemail.net",
  "spam4.me",
];

/** Other throwaway services, from abroad and from China (临时邮箱, 10分钟邮箱 and the like) */
const OTHER_THROWAWAY = [
  "mailinator.com",
  "10minutemail.com",
  "yopmail.com",
  "temp-mail.org",
  "maildrop.cc",
  "trashmail.com",
  "getnada.com",
  "mail.tm",
  "linshiyouxiang.net",
  "bccto.me",
  "chacuo.net",
  "027168.com",
  "tempmail.cn",
];

/**
 * Mail services people keep their address at, never to be turned away: the big ones in China and abroad, the
 * ISPs', the private ones, the forwarding ones that hide an address (each still lands in a real inbox), and
 * schools' with their students' and staff's names under them.
 */
const KEPT = [
  ...["qq.com", "vip.qq.com", "foxmail.com", "163.com", "vip.163.com", "126.com", "vip.126.com", "yeah.net", "188.com", "netease.com"],
  ...["sina.com", "sina.cn", "vip.sina.com", "sohu.com", "aliyun.com", "139.com", "189.cn", "wo.cn", "21cn.com", "tom.com", "263.net"],
  ...["88.com", "2980.com", "email.cn", "china.com", "eyou.com", "dingtalk.com", "petalmail.com", "huawei.com", "zohomail.cn"],
  ...["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "live.cn", "outlook.jp", "hotmail.co.uk"],
  ...["icloud.com", "me.com", "mac.com", "yahoo.com", "yahoo.co.jp", "yahoo.com.tw", "yahoo.com.hk", "ymail.com", "aol.com"],
  ...["proton.me", "protonmail.com", "pm.me", "tutanota.com", "tuta.io", "fastmail.com", "zoho.com", "gmx.com", "gmx.de", "web.de"],
  ...["mail.ru", "yandex.ru", "yandex.com", "naver.com", "daum.net", "hanmail.net", "kakao.com", "mail.com", "hey.com", "posteo.de"],
  ...["comcast.net", "att.net", "verizon.net", "sbcglobal.net", "orange.fr", "free.fr", "t-online.de", "libero.it", "hinet.net"],
  ...["duck.com", "privaterelay.appleid.com", "mozmail.com", "simplelogin.com", "slmail.me", "anonaddy.me", "addy.io", "passmail.net"],
  ...["pku.edu.cn", "stu.pku.edu.cn", "mails.tsinghua.edu.cn", "mail.ustc.edu.cn", "zju.edu.cn", "sjtu.edu.cn", "fudan.edu.cn"],
  ...["smail.nju.edu.cn", "mail.sysu.edu.cn", "stu.xjtu.edu.cn", "std.uestc.edu.cn", "mails.ucas.ac.cn", "link.cuhk.edu.hk"],
  ...["connect.hku.hk", "connect.ust.hk", "connect.polyu.hk", "my.cityu.edu.hk", "um.edu.mo", "ntu.edu.tw", "u.nus.edu"],
  ...["e.ntu.edu.sg", "uchicago.edu", "mit.edu", "g.ucla.edu", "nyu.edu", "ox.ac.uk", "cam.ac.uk", "mail.utoronto.ca"],
  ...["student.unimelb.edu.au", "ed.ac.uk"],
];

afterEach(() => {
  delete process.env.THROWAWAY_CHECK;
  delete process.env.THROWAWAY_OK_DOMAINS;
});

describe("the list of throwaway mail services", () => {
  it("is the public list, at a commit, dedicated to the public domain", () => {
    expect(data.source).toBe("https://github.com/disposable-email-domains/disposable-email-domains");
    expect(data.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(data.license).toBe("CC0-1.0");
    expect(data.domains.length).toBeGreaterThan(5000);
  });

  it("holds domains of their own, written once each, in order", () => {
    const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
    for (const d of data.domains) expect(d).toMatch(new RegExp(`^${label}(?:\\.${label})+$`));
    expect([...data.domains].sort()).toEqual(data.domains);
    expect(new Set(data.domains).size).toBe(data.domains.length);
    // none a name anyone registers domains under: that would turn away every address there
    for (const suffix of ["edu.cn", "ac.cn", "com.cn", "edu.hk", "edu.tw", "co.uk", "ac.uk", "co.jp", "com.au", "edu.au"]) {
      expect(data.domains).not.toContain(suffix);
    }
  });
});

describe("a throwaway address", () => {
  it("is every Guerrilla Mail address", () => {
    for (const d of GUERRILLA) expect(isThrowawayEmail(`someone@${d}`), d).toBe(true);
  });

  it("is one at other throwaway services too", () => {
    for (const d of OTHER_THROWAWAY) expect(isThrowawayEmail(`someone@${d}`), d).toBe(true);
  });

  it("goes by the domain however it is written: a name under it, capitals, a dot at the end, full-width letters", () => {
    expect(isThrowawayEmail("someone@mail.guerrillamailblock.com")).toBe(true);
    expect(isThrowawayEmail("someone@a.b.sharklasers.com")).toBe(true);
    expect(isThrowawayEmail("Someone@GuerrillaMailBlock.COM")).toBe(true);
    expect(isThrowawayEmail("someone@grr.la.")).toBe(true);
    expect(isThrowawayEmail(" someone@grr.la ")).toBe(true);
    expect(isThrowawayEmail("someone@ｇｒｒ．ｌａ")).toBe(true);
    expect(isThrowawayEmail("someone@grr。la")).toBe(true);
    // a name typed in its own letters, which the list writes in ASCII
    expect(data.domains).toContain("xn--9kq967o.com");
    expect(domainToUnicode("xn--9kq967o.com")).not.toMatch(/^xn--/);
    expect(isThrowawayEmail(`someone@${domainToUnicode("xn--9kq967o.com")}`)).toBe(true);
    // only the part after the last @ is the domain
    expect(isThrowawayEmail('"grr.la@qq.com"@grr.la')).toBe(true);
    expect(isThrowawayEmail('"x@grr.la"@qq.com')).toBe(false);
  });

  it("is never one at a mail service people keep, a school's included", () => {
    for (const d of KEPT) {
      expect(isThrowawayEmail(`someone@${d}`), d).toBe(false);
      expect(isThrowawayEmail(`someone@sub.${d}`), `sub.${d}`).toBe(false);
    }
  });

  it("is not a name that only looks like one, nor a domain of one label", () => {
    expect(isThrowawayEmail("someone@notguerrillamail.com")).toBe(false);
    expect(isThrowawayEmail("someone@guerrillamail.com.qq.com")).toBe(false);
    expect(isThrowawayEmail("someone@la")).toBe(false);
    expect(isThrowawayEmail("someone@")).toBe(false);
    expect(isThrowawayEmail("")).toBe(false);
  });
});

describe("the switches on the server", () => {
  it("THROWAWAY_CHECK=off lets every address make an account again", () => {
    process.env.THROWAWAY_CHECK = "off";
    for (const d of GUERRILLA) expect(isThrowawayEmail(`someone@${d}`), d).toBe(false);
    process.env.THROWAWAY_CHECK = "on";
    expect(isThrowawayEmail("someone@grr.la")).toBe(true);
  });

  it("THROWAWAY_OK_DOMAINS lets those domains through, with the names under them, and no others", () => {
    process.env.THROWAWAY_OK_DOMAINS = " GRR.LA., @sharklasers.com ,";
    expect(isThrowawayEmail("someone@grr.la")).toBe(false);
    expect(isThrowawayEmail("someone@mail.grr.la")).toBe(false);
    expect(isThrowawayEmail("someone@sharklasers.com")).toBe(false);
    expect(isThrowawayEmail("someone@guerrillamailblock.com")).toBe(true);
    // a name under a listed domain does not let the domain above it through
    process.env.THROWAWAY_OK_DOMAINS = "mail.guerrillamail.com";
    expect(isThrowawayEmail("someone@mail.guerrillamail.com")).toBe(false);
    expect(isThrowawayEmail("someone@guerrillamail.com")).toBe(true);
  });
});

describe("the refusal", () => {
  it("is a 403 with the code the sign-in sheet goes back to the email by, naming neither the domain nor the list", () => {
    const e = throwawayRefusal();
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(403);
    expect(e.code).toBe(THROWAWAY_EMAIL);
    expect(e.message).toBe("这个邮箱看起来是临时邮箱，不能用来注册新账号。请换一个常用的邮箱，比如 QQ、163 或 Outlook。");
    for (const d of GUERRILLA) expect(e.message).not.toContain(d);
  });
});
