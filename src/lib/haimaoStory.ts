import { T } from "@/i18n";

/**
 * 香艳制作人's story (src/lib/haimao.ts), 今日剧情 on her card: twelve scenes, the next one each day by the player's
 * device clock (from 04:00, src/lib/deviceDay.ts), however many days apart; each ends in three answers that raise her
 * 好感度 by 8, 5 or 3, the cheekiest one answered with dame dame. Right after the twelfth comes ALL END, whichever way
 * they answered: her 好感度 to the top and the badge 被海猫 all 了. After that she has one line a day, the ten in turn,
 * the same one all day, raising nothing.
 *
 * The words are T.lib.haimao.story's, word for word as Breeze approved them; here is who says each line, with which of
 * her faces, and what happens with it. A told line (narration) leaves her face as it was.
 */

export const HAIMAO_DAYS = 12;
/** The badge ALL END gives (src/lib/badges.ts) */
export const HAIMAO_BADGE = "haimaoall";
/** Her lines of a day after ALL END, said in turn */
export const HAIMAO_DAILY = 10;

/** Her faces, each a picture of her (立绘) */
export const HAIMAO_FACES = ["smile", "proud", "shy", "surprised", "aggrieved", "serious", "singing"] as const;
export type HaimaoFace = (typeof HAIMAO_FACES)[number];

/** What a line sets off: what she takes out (the scene's prop), the eggs cracking, her gull */
export type StoryCue = "prop" | "crack" | "meow";
export type StoryProp = "staff" | "dice" | "hammer";

type Beat = { face: HaimaoFace | null; cue?: StoryCue };
type AnswerShape = { love: number; reply: Beat[]; dame?: true; danmaku?: true; all?: true };
type SceneShape = { prop?: StoryProp; eggs?: true; dusk?: true; lines: Beat[]; answers: [AnswerShape, AnswerShape, AnswerShape] };

const her = (face: HaimaoFace, cue?: StoryCue): Beat => (cue ? { face, cue } : { face });
const told = (cue?: StoryCue): Beat => (cue ? { face: null, cue } : { face: null });
const answer = (love: number, ...reply: Beat[]): AnswerShape => ({ love, reply });
/** The cheekiest answer: 3, and she sings dame dame back */
const dame = (): AnswerShape => ({ love: 3, reply: [her("singing")], dame: true });

const SCENES: SceneShape[] = [
  // 1 初遇
  { lines: [her("smile"), her("smile"), her("proud"), told("meow")], answers: [answer(8, her("proud")), answer(5, her("smile")), dame()] },
  // 2 神之一手
  { lines: [her("proud"), her("aggrieved"), her("shy")], answers: [answer(8, her("proud")), answer(5, her("shy")), dame()] },
  // 3 苦难陈述者
  { lines: [her("serious"), her("serious"), told()], answers: [answer(8, her("serious")), answer(5, her("aggrieved")), dame()] },
  // 4 漫展潜行: the staff out of her coat
  { prop: "staff", lines: [her("proud"), her("proud"), told("prop")], answers: [answer(8, her("shy")), answer(5, her("proud")), dame()] },
  // 5 六面都是 all: the die
  {
    prop: "dice",
    lines: [her("smile"), told("prop"), her("proud"), her("smile")],
    answers: [answer(8, her("proud")), answer(5, her("smile")), dame()],
  },
  // 6 被举报了
  { lines: [her("serious"), her("surprised"), her("aggrieved")], answers: [answer(8, her("aggrieved")), answer(5, her("serious"), her("smile")), dame()] },
  // 7 六星撼地者: the hammer, and three eggs cracked open
  {
    prop: "hammer",
    eggs: true,
    lines: [her("proud", "prop"), her("serious"), her("proud"), told("crack")],
    answers: [answer(8, her("proud")), answer(5, her("serious")), dame()],
  },
  // 8 法老大气
  { lines: [her("shy"), her("shy"), told()], answers: [answer(8, her("shy")), answer(5, her("serious")), dame()] },
  // 9 唱一句: everyone sings along, and dame dame flies across the stage
  {
    lines: [her("shy"), her("serious")],
    answers: [{ love: 8, reply: [her("singing"), told()], dame: true, danmaku: true }, answer(5, her("surprised")), dame()],
  },
  // 10 ocean cat
  { lines: [her("proud"), her("smile")], answers: [answer(8, her("proud")), answer(5, her("smile")), dame()] },
  // 11 自制力
  { lines: [her("serious"), told()], answers: [answer(8, her("shy")), answer(5, her("surprised")), dame()] },
  // 12 周年, at dusk
  {
    dusk: true,
    lines: [her("serious"), her("serious"), her("smile")],
    answers: [
      { love: 8, reply: [her("smile")], all: true },
      { love: 5, reply: [her("proud")], all: true },
      dame(),
    ],
  },
];

const END: Beat[] = [her("serious"), her("shy"), her("smile")];
const DAILY: HaimaoFace[] = ["smile", "smile", "proud", "singing", "serious", "shy", "aggrieved", "proud", "surprised", "shy"];

export type StoryLine = { text: string; face: HaimaoFace | null; cue?: StoryCue };
export type StoryAnswer = { text: string; love: number; reply: StoryLine[]; dame: boolean; danmaku: boolean; all: boolean };
export type StoryScene = {
  day: number;
  title: string;
  prop: StoryProp | null;
  eggs: boolean;
  /** At dusk (the twelfth, and ALL END), by day otherwise */
  dusk: boolean;
  lines: StoryLine[];
  answers: StoryAnswer[];
};

const lines = (texts: readonly string[], beats: Beat[]): StoryLine[] => beats.map((b, i) => ({ text: texts[i], ...b }));

/** Day n's scene (1–12), its words and how it goes */
export function storyScene(n: number): StoryScene {
  const shape = SCENES[n - 1];
  const words = T.lib.haimao.story.days[n - 1];
  return {
    day: n,
    title: words.title,
    prop: shape.prop ?? null,
    eggs: Boolean(shape.eggs),
    dusk: Boolean(shape.dusk),
    lines: lines(words.lines, shape.lines),
    answers: shape.answers.map((a, k) => ({
      text: words.choices[k],
      love: a.love,
      reply: lines(words.replies[k], a.reply),
      dame: Boolean(a.dame),
      danmaku: Boolean(a.danmaku),
      all: Boolean(a.all),
    })),
  };
}

/** ALL END, at dusk */
export const storyEnd = (): StoryLine[] => lines(T.lib.haimao.story.end, END);

/** The day's line after ALL END: the ten in turn, from the first */
export const dailyLine = (i: number): StoryLine => {
  const k = ((i % HAIMAO_DAILY) + HAIMAO_DAILY) % HAIMAO_DAILY;
  return { text: T.lib.haimao.story.daily[k], face: DAILY[k] };
};

/** The 好感度 an answer brings: the k-th (0–2) of day n's scene */
export const answerLove = (n: number, k: number) => SCENES[n - 1].answers[k].love;

/** How many lines each scene, answer, ALL END and the daily lines have here, to check the words against */
export const storyShape = () => ({
  days: SCENES.map((s) => ({ lines: s.lines.length, replies: s.answers.map((a) => a.reply.length) })),
  end: END.length,
  daily: DAILY.length,
});

/**
 * What 今日剧情 holds for a player today: the day's scene (picked: their answer once it is seen, today's or the
 * twelfth's while ALL END waits), ALL END on the day they saw it, and their line of the day after that.
 */
export type HaimaoToday = { kind: "scene"; day: number; picked: number | null } | { kind: "end" } | { kind: "chat"; line: number };

/** Their story so far: her 好感度, the scenes seen and the answers picked in them, whether ALL END is, and today */
export type HaimaoStory = { love: number; days: number; picks: number[]; end: boolean; today: HaimaoToday };

/** An answer or ALL END taken: the story after it, and how much it raised her 好感度 (0 when it changed nothing) */
export type HaimaoStep = HaimaoStory & { plus: number };

/** Her picture with a face (立绘), from the server's own folder: only while HAIMAO_PICTURE is on */
export const haimaoFaceUrl = (face: HaimaoFace) => `/guide-art/haimao-${face}.webp?v=1`;
/** The street outside her tower that Breeze painted, by day and at dusk */
export const haimaoStreetUrl = (dusk: boolean) => `/guide-art/haimao-${dusk ? "dusk" : "day"}.webp?v=1`;
