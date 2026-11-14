/**
 * Words a player typed for someone else to read as they are: a report's note, an appeal. Shared by the server,
 * which keeps them cleaned, and the 管理台, which cleans what older rows still hold before showing it.
 */

/** Line breaks and tabs, which become spaces */
const BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
/** Controls, format characters (all but the zero-width joiner emoji are built with) and lone surrogates */
const HIDDEN = /(?!\u200d)[\p{Cc}\p{Cf}\p{Cs}]/gu;
/** Combining marks kept on one character; a pile of them runs over the lines around it */
export const MARKS_MAX = 3;
const MANY_MARKS = new RegExp(`(\\p{M}{${MARKS_MAX}})\\p{M}+`, "gu");

/**
 * What cannot be seen, or would move the words around it (a right-to-left override, say), goes; so do more than
 * MARKS_MAX combining marks on one character. Line breaks and tabs become spaces, runs of spaces one, and what is
 * left is cut at max characters, an emoji counting as one.
 */
export function cleanPlayerText(text: string, max = Infinity): string {
  const plain = text.replace(BREAKS, " ").replace(HIDDEN, "").replace(MANY_MARKS, "$1").replace(/\s+/g, " ").trim();
  const chars = [...plain];
  return chars.length > max ? chars.slice(0, max).join("").trim() : plain;
}

/** Whether cleanPlayerText takes away more than spaces and line breaks: characters that cannot be seen, or a pile of marks */
export function hasHidden(text: string) {
  const spaced = text.replace(BREAKS, " ");
  return spaced.replace(HIDDEN, "") !== spaced || spaced.replace(MANY_MARKS, "$1") !== spaced;
}
