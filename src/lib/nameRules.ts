/**
 * Names nobody may use. The rules here are fine to read in public; the list of
 * sensitive words lives in the database (name_words) and is kept on the admin
 * page, so it is not in the repository for anyone to learn how to get around.
 * Names are folded before they are compared, and so are the words; the checking
 * itself is in src/lib/nameCheck.ts, which the admin page's code does not need.
 */

/** Full-width to half-width, lower case, no spaces or zero-width characters: 「ＱＱ 群」 reads 「qq群」. */
export const loose = (name: string) =>
  name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s​-‏⁠﻿]/gu, "");

/** Only letters, digits and Chinese characters, so 「台 独」, 「台-独」 and 「台.独」 all read the same. */
export const bare = (name: string) => loose(name).replace(/[^\p{L}\p{N}]/gu, "");

/**
 * A blocked word, cleaned as bare(); whole: only the whole name counts, for words fine inside a longer one.
 * A word with 「~」 in front (SOUND) blocks what sounds like it too (src/lib/nameFold.ts soundMatcher).
 */
export type NameWord = { word: string; whole: boolean };

/** In front of a word blocked by its sound as well: 「~张三丰」 stops 「章三峰」 and 「zhang三丰」 too */
export const SOUND = "~";

/** Passing for the site or its staff. 鹰角 is not here: 「鹰角厨」 is a fine name, and 「鹰角官方」 is caught by 官方. */
export const CODE_WORDS: NameWord[] = [
  // 阿米娅向导, 佩丽卡监督, 塔露拉干员, 明河都尉 and 祀掌柜 are the site's own guides (src/lib/guides.ts); the characters' names alone are any fan's
  ...["官方", "客服", "站长", "舟p地图", "阿米娅向导", "佩丽卡监督", "塔露拉干员", "明河都尉", "祀掌柜"].map((word) => ({
    word,
    whole: false,
  })),
  // fine inside a longer name; 管理员 is not here at all, since it is what Endfield calls its main character
  ...["管理组", "系统", "系统消息", "系统通知", "admin", "administrator", "舟p", "匿名舟p"].map((word) => ({
    word,
    whole: true,
  })),
];

// Pointing people elsewhere: links on the loose name, contacts and long numbers on the bare one
export const LINK = /https?:|www\.|\.(com|cn|net|org|top|xyz|cc|vip|me|io|link|site|club|shop)(?![a-z])/;
export const CONTACT = /(qq|扣扣|q群|加群|群号)\d|(微信|威信|薇信|vx|wx|v信|加v|weixin|wechat)[a-z0-9]/;
export const LONG_NUMBER = /\d{6,}/;

/**
 * The admin page's 批量添加: one word a line, 「=」 in front for the whole name only, 「~」 for
 * its sound too (full width 「＝」 「～」 as typed in Chinese do as well). Blank lines and Markdown
 * leftovers (「#」 headings, 「```」 fences) are skipped.
 */
export function parseNameWords(text: string): NameWord[] {
  const words = new Map<string, boolean>();
  for (const raw of text.split("\n")) {
    const line = raw.normalize("NFKC").trim();
    if (!line || line.startsWith("#") || line.startsWith("```")) continue;
    if (line.startsWith(SOUND)) {
      const word = bare(line.slice(SOUND.length));
      if (word) words.set(SOUND + word, false);
      continue;
    }
    const whole = line.startsWith("=");
    const word = bare(whole ? line.slice(1) : line);
    if (word) words.set(word, whole);
  }
  return [...words].map(([word, whole]) => ({ word, whole }));
}
