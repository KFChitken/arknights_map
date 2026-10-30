/**
 * Names nobody may use. The rules here are fine to read in public; the list of
 * sensitive words lives in the database (name_words) and is kept on the admin
 * page, so it is not in the repository for anyone to learn how to get around.
 * Names are cleaned before they are compared, and so are the words.
 */

/** Full-width to half-width, lower case, no spaces or zero-width characters: 「ＱＱ 群」 reads 「qq群」. */
export const loose = (name: string) =>
  name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s​-‏⁠﻿]/gu, "");

/** Only letters, digits and Chinese characters, so 「台 独」, 「台-独」 and 「台.独」 all read the same. */
export const bare = (name: string) => loose(name).replace(/[^\p{L}\p{N}]/gu, "");

/** A blocked word, cleaned as bare(); whole: only the whole name counts, for words fine inside a longer one */
export type NameWord = { word: string; whole: boolean };

/** Passing for the site or its staff. 鹰角 is not here: 「鹰角厨」 is a fine name, and 「鹰角官方」 is caught by 官方. */
export const CODE_WORDS: NameWord[] = [
  ...["官方", "客服", "站长", "舟p地图"].map((word) => ({ word, whole: false })),
  // fine inside a longer name; 管理员 is not here at all, since it is what Endfield calls its main character
  ...["管理组", "系统", "系统消息", "系统通知", "admin", "administrator", "舟p", "匿名舟p"].map((word) => ({
    word,
    whole: true,
  })),
];

// Pointing people elsewhere: links on the loose name, contacts and long numbers on the bare one
const LINK = /https?:|www\.|\.(com|cn|net|org|top|xyz|cc|vip|me|io|link|site|club|shop)(?![a-z])/;
const CONTACT = /(qq|扣扣|q群|加群|群号)\d|(微信|威信|薇信|vx|wx|v信|加v|weixin|wechat)[a-z0-9]/;
const LONG_NUMBER = /\d{6,}/;

/**
 * Whether a name may be used, given the words kept on the admin page. The list can
 * run to tens of thousands, so every piece of the (short) name is looked up in a
 * set instead of the name being searched for every word.
 */
export function nameChecker(words: NameWord[]) {
  const all = [...CODE_WORDS, ...words];
  const inside = new Set(all.filter((w) => !w.whole).map((w) => w.word));
  const whole = new Set(all.filter((w) => w.whole).map((w) => w.word));
  return (name: string) => {
    const b = bare(name);
    if (LINK.test(loose(name)) || CONTACT.test(b) || LONG_NUMBER.test(b) || whole.has(b)) return false;
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j <= b.length; j++) if (inside.has(b.slice(i, j))) return false;
    }
    return true;
  };
}

export const nameAllowed = (name: string, words: NameWord[]) => nameChecker(words)(name);

/**
 * The admin page's 批量添加: one word a line, 「=」 in front for the whole name only.
 * Blank lines and Markdown leftovers (「#」 headings, 「```」 fences) are skipped.
 */
export function parseNameWords(text: string): NameWord[] {
  const words = new Map<string, boolean>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("```")) continue;
    const whole = line.startsWith("=");
    const word = bare(whole ? line.slice(1) : line);
    if (word) words.set(word, whole);
  }
  return [...words].map(([word, whole]) => ({ word, whole }));
}
