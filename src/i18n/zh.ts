/**
 * Every piece of text a player can read, in Chinese: the source the other
 * languages follow (src/i18n/core.ts). Grouped by where it shows; a name says what
 * the text is for, not what it says. {name} is a blank filled in with fmt(), a
 * { other } is a Counted for count().
 *
 * Moved here from the code by scripts/i18n/extract.mts: change the words here, not
 * there. The admin page, the site's own alert emails and console output stay in
 * the code, in Chinese.
 */
export const zh = {
  map: {
    beta: "内测版",
    loading: "地图加载中…",
    radar: "方舟雷达",
    disclaimer: "非官方同人项目 · 与鹰角网络无关 ·",
    contact: "联系与举报",
  },
} as const;
