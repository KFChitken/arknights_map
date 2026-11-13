import { fmt, T } from "@/i18n";
import { characterName } from "@/i18n/names";
import { GAME_NAMES, type Game } from "./games";

/**
 * 求助 among 触须之交 (the server side is src/lib/server/help.ts): 缺线索, 来线索交流 and
 * 借助战, all picked from lists, never typed. Only the asker's 触须之交 who play that game see
 * one, and nothing is pushed at them: no message, no pop-up, only a dot on the 触须之交 card
 * until they have looked (Breeze, 2026-11-10).
 */

export const HELP_KINDS = ["clues", "exchange", "support"] as const;
export type HelpKind = (typeof HELP_KINDS)[number];
export const isHelpKind = (x: unknown): x is HelpKind => (HELP_KINDS as readonly unknown[]).includes(x);

export const HELP_NAMES: Record<HelpKind, string> = {
  get clues() {
    return T.lib.help.names.clues;
  },
  get exchange() {
    return T.lib.help.names.exchange;
  },
  get support() {
    return T.lib.help.names.support;
  },
};

/** The games each is for: 借助战 only in 明日方舟 */
export const HELP_GAMES: Record<HelpKind, Game[]> = { clues: ["arknights", "endfield"], exchange: ["arknights", "endfield"], support: ["arknights"] };

/** 线索 1–7, in both games (明日方舟's 基建 and 终末地's 帝江号会客室) */
export const CLUES = [1, 2, 3, 4, 5, 6, 7] as const;
/** 借助战: which skill, 0 for 不限 */
export const SKILLS = [1, 2, 3, 0] as const;

/** A request is up this long, unless its asker closes it first */
export const HELP_HOURS = 24;
/** Requests of one kind, for one game, a player may put up a day (Beijing date) */
export const HELP_PER_DAY = 3;
/** Requests and their answers are deleted after this many days */
export const HELP_KEEP_DAYS = 7;

/** What a request says */
export type HelpAsk = { kind: HelpKind; game: Game; clues?: number[]; operator?: string; skill?: number };

const clueList = (clues: number[]) =>
  fmt(T.lib.help.clueNumbers, { numbers: [...clues].sort((a, b) => a - b).join(T.common.listSep), n: clues.length });

/** 「明日方舟 · 缺 3、5 号线索」 */
export function helpText(r: HelpAsk) {
  const game = GAME_NAMES[r.game];
  switch (r.kind) {
    case "clues":
      return fmt(T.lib.help.text.clues, { game, clues: clueList(r.clues ?? []) });
    case "exchange":
      return fmt(T.lib.help.text.exchange, { game, place: r.game === "endfield" ? T.lib.help.places.endfield : T.lib.help.places.arknights });
    case "support":
      return fmt(T.lib.help.text.support, { game, operator: r.operator && characterName(r.operator), skill: r.skill ? fmt(T.lib.help.skill, { n: r.skill }) : " " });
  }
}

/** The button a 触须之交 answers with */
export const HELP_ANSWER: Record<HelpKind, string> = {
  get clues() {
    return T.lib.help.answers.clues;
  },
  get exchange() {
    return T.lib.help.answers.exchange;
  },
  get support() {
    return T.lib.help.answers.support;
  },
};

/** What the asker reads: 「Dr. B 送了你 3 号线索」 */
export function helpAnswerText(r: HelpAsk, who: string, clues?: number[]) {
  switch (r.kind) {
    case "clues":
      return fmt(T.lib.help.answered.clues, { who, clues: clueList(clues ?? []) });
    case "exchange":
      return fmt(T.lib.help.answered.exchange, { who });
    case "support":
      return fmt(T.lib.help.answered.support, { who, operator: r.operator && characterName(r.operator) });
  }
}
