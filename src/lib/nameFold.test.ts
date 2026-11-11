import { describe, expect, it } from "vitest";
import { nameAllowed, nameChecker, nameJudge } from "./nameCheck";
import { fold, foldLoose, hanOnly, soundKey, soundMatcher, soundsOf } from "./nameFold";
import { parseNameWords } from "./nameRules";

// stand-ins for the words kept on the admin page
const WORDS = parseNameWords("台独\n=国家\n~张三丰\n測試員\n~李四\n");

describe("name folding", () => {
  it("reads traditional, variant and radical forms as the simplified character", () => {
    expect(fold("臺獨")).toBe("台独");
    expect(fold("測試員")).toBe("测试员");
    // Japanese shinjitai (沢 for 澤), Taiwan and Hong Kong variants (汙, 綫), radicals (⺠) and compatibility ideographs
    expect(fold("沢図対")).toBe("泽图对");
    expect(fold("汙綫")).toBe("污线");
    expect(fold("江⺠")).toBe("江民");
    expect(fold("六")).toBe("六");
    // the simplified ones stay as they are
    expect(fold("台独国家么着才")).toBe("台独国家么着才");
  });

  it("drops spaces, symbols, emoji, zero-width characters and accents, and reads look-alike letters as Latin", () => {
    expect(fold("台 独")).toBe("台独");
    expect(fold("台‍独")).toBe("台独");
    expect(fold("台🐻独！")).toBe("台独");
    expect(fold("Zhāng Sānfēng")).toBe("zhangsanfeng");
    // Cyrillic а and о, Greek ο
    expect(fold("zhаngsаnfеng")).toBe("zhangsanfeng");
    expect(fold("ΑDMΙΝ")).toBe("admin");
    // full width, circled and bold letters, as NFKC reads them
    expect(fold("ＱＱ")).toBe("qq");
    expect(fold("ⓐⓓⓜⓘⓝ")).toBe("admin");
    expect(fold("𝐚𝐝𝐦𝐢𝐧")).toBe("admin");
    // other scripts' own letters stay
    expect(fold("한국어カタカナ")).toBe("한국어カタカナ");
  });

  it("keeps the dots for telling a link, and can keep only the Chinese characters", () => {
    expect(foldLoose("аbc．соm")).toBe("abc.com");
    expect(hanOnly(fold("台a独1号"))).toBe("台独号");
  });

  it("reads characters as their syllables, without tones, every reading of a character", () => {
    expect([...soundsOf("张")]).toEqual(["zhang"]);
    expect([...soundsOf("乐")].sort()).toEqual(["le", "yue"]);
    expect([...soundsOf("女")]).toEqual(["nu"]);
    expect(soundsOf("a").size).toBe(0);
  });

  it("only takes a sound of three characters or more, all Chinese", () => {
    expect(soundKey("张三丰")?.syllables).toHaveLength(3);
    expect(soundKey("李四")).toBeNull();
    expect(soundKey("张3丰")).toBeNull();
  });

  it("hears a word in characters read the same, in pinyin, or in both mixed", () => {
    const sounds = soundMatcher([soundKey("张三丰")!]);
    for (const name of ["章三峰", "张叁锋", "zhang三丰", "张san丰", "zhangsanfeng", "我是章三峰呀"]) expect(sounds(fold(name)), name).toBe("张三丰");
    // a character with more than one reading sounds like each (长 as zhang, as in 长大)
    expect(sounds(fold("长三丰"))).toBe("张三丰");
    for (const name of ["张三", "三丰", "张三的风", "常三丰", "zhangsan", "zhang3feng"]) expect(sounds(fold(name)), name).toBeNull();
  });
});

describe("names checked folded", () => {
  it("blocks a word however it is written", () => {
    for (const name of ["臺獨", "台 獨", "台‍独", "台-獨", "我是臺獨", "台🐻独", "台a独", "台1独"]) expect(nameAllowed(name, WORDS), name).toBe(false);
    // a word listed in traditional characters blocks the simplified name too
    expect(nameAllowed("测试员", WORDS)).toBe(false);
    expect(nameAllowed("國家", WORDS)).toBe(false);
    expect(nameAllowed("國家隊", WORDS)).toBe(true);
    // letters put round a whole-name word make a longer name, which it allows
    expect(nameAllowed("国家abc", WORDS)).toBe(true);
    expect(nameAllowed("独立宣言爱好者", WORDS)).toBe(true);
  });

  it("blocks the sound of a word marked ~, but a short one only as written", () => {
    for (const name of ["张三丰", "章三峰", "zhangsanfeng", "Zhāng Sān Fēng", "张san丰", "章3三峰"]) expect(nameAllowed(name, WORDS), name).toBe(false);
    expect(nameAllowed("李四", WORDS)).toBe(false);
    expect(nameAllowed("黎思", WORDS)).toBe(true);
    expect(nameAllowed("张三", WORDS)).toBe(true);
  });

  it("sees links, contacts and long numbers through look-alikes and full width", () => {
    expect(nameAllowed("abc。com", [])).toBe(false);
    expect(nameAllowed("аbc．соm", [])).toBe(false);
    expect(nameAllowed("加ＱＱ１２３", [])).toBe(false);
    expect(nameAllowed("ｖх abc", [])).toBe(false);
    expect(nameAllowed("阿白１２３４５６", [])).toBe(false);
    expect(nameAllowed("ΑDMΙΝ", [])).toBe(false);
  });

  it("tells the admin what blocks a name: the word as listed, or the rule", () => {
    const judge = nameJudge(WORDS);
    expect(judge("臺獨")).toBe("台独");
    expect(judge("國家")).toBe("=国家");
    expect(judge("章三峰")).toBe("~张三丰");
    expect(judge("看www.abc")).toBe("网址");
    expect(judge("阿米娅")).toBeNull();
  });

  it("keeps up with tens of thousands of words, some by sound", () => {
    const many = Array.from({ length: 20_000 }, (_, i) => ({ word: i % 100 ? `词${i}` : `~词语${i}`, whole: false }));
    const allowed = nameChecker([...many, ...WORDS]);
    const started = performance.now();
    for (let i = 0; i < 10_000; i++) expect(allowed("阿白的蟑螂本体")).toBe(true);
    expect(allowed("我是臺獨")).toBe(false);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
