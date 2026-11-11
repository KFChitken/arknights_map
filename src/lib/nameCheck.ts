import { fold, foldLoose, hanOnly, isHan, soundKey, soundMatcher, type SoundKey } from "./nameFold";
import { CODE_WORDS, CONTACT, LINK, LONG_NUMBER, SOUND, type NameWord } from "./nameRules";

/**
 * Checking a name against the rules (src/lib/nameRules.ts) and the words kept on the admin page.
 * Both are folded first (src/lib/nameFold.ts), so traditional and variant characters, full width,
 * look-alike letters, accents and anything put between the characters change nothing. Server side:
 * the folding tables are big.
 */

/** Only the Chinese characters and the Latin letters, for hearing a sound through digits, kana or the like */
const hanAndLatin = (folded: string) =>
  Array.from(folded)
    .filter((c) => (c >= "a" && c <= "z") || isHan(c))
    .join("");

/**
 * What stops a name, given the words: the word as the admin page lists it (「台独」, 「=国家」, 「~张三丰」)
 * or the rule's name, or null when it may be used. Only ever shown to the admin, never to the player, so
 * nobody can feel their way round the list. The list can run to tens of thousands, so every piece of the
 * (short) name is looked up in a map instead of the name being searched for every word.
 */
export function nameJudge(words: NameWord[]): (name: string) => string | null {
  const inside = new Map<string, string>();
  const whole = new Map<string, string>();
  const keys: SoundKey[] = [];
  for (const w of [...CODE_WORDS, ...words]) {
    const sound = w.word.startsWith(SOUND);
    const word = fold(sound ? w.word.slice(SOUND.length) : w.word);
    if (!word) continue;
    const shown = w.whole ? `=${w.word}` : w.word;
    const into = w.whole ? whole : inside;
    if (!into.has(word)) into.set(word, shown);
    const key = sound ? soundKey(word, shown) : null;
    if (key) keys.push(key);
  }
  const soundsLike = soundMatcher(keys);
  const within = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j <= s.length; j++) {
        const hit = inside.get(s.slice(i, j));
        if (hit) return hit;
      }
    }
    return null;
  };

  return (name: string) => {
    // 「。」 is how a dot is typed in Chinese
    if (LINK.test(foldLoose(name).replace(/。/g, "."))) return "网址";
    const folded = fold(name);
    if (CONTACT.test(folded)) return "QQ 或微信号";
    if (LONG_NUMBER.test(folded)) return "6 位以上的数字";
    const hit = whole.get(folded) ?? within(folded);
    if (hit) return hit;
    // a word with other letters or digits put between its characters: 「台a独」
    const han = hanOnly(folded);
    const between = han !== folded ? within(han) : null;
    if (between) return between;
    const heard = hanAndLatin(folded);
    return soundsLike(heard) ?? (han !== heard ? soundsLike(han) : null);
  };
}

/** Whether a name may be used, given the words kept on the admin page */
export function nameChecker(words: NameWord[]) {
  const judge = nameJudge(words);
  return (name: string) => judge(name) === null;
}

export const nameAllowed = (name: string, words: NameWord[]) => nameChecker(words)(name);
