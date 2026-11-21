import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import {
  QUIZ_ANSWER_MS,
  QUIZ_FETCH_MS,
  QUIZ_INTRO_MS,
  QUIZ_LEAD_MS,
  QUIZ_LOAD_MAX_MS,
  QUIZ_REVEAL_MS,
  QUIZ_RESULT_MS,
  type QuizAsk,
  type QuizKind,
  type QuizMode,
  type QuizQuestion,
} from "@/lib/squadMode";
import { QuizView, ladleLine, quizPhase, quizRanks, resultLine, type QuizSound } from "./SquadQuiz";
import { forgetSquadPage, loadSquadRoom, squadQuizAnswer, squadQuizAsksNow, squadQuizPicksNow, type QuizPicks } from "./squading";
import { modeRow } from "./SquadPlays";

const NOW = Date.parse("2026-11-20T13:00:00+08:00");
const member = (h: number, more: Partial<SquadMember> = {}): SquadMember => ({
  h,
  name: ["", "银灰厨", "企鹅物流", "漏勺本勺", "小龙"][h] ?? `人机 ${-h}`,
  host: h === 1,
  you: h === 1,
  friend: false,
  inGame: true,
  pose: 0,
  avatar: "hood",
  color: "cyan",
  core: 0,
  strategy: null,
  extras: [],
  ...more,
});
/** Five questions of these kinds from a quiz opened at `at`, as the server times them (each loaded in time: starting at its from), each with what is given */
function questions(at: number, kinds: QuizKind[], more: Partial<QuizQuestion>[] = []): QuizQuestion[] {
  let from = at + QUIZ_LEAD_MS;
  return kinds.map((kind, n) => {
    const timed = { from, at: from, ends: from + (kind === "intro" ? QUIZ_INTRO_MS : QUIZ_ANSWER_MS) };
    from = timed.ends + QUIZ_REVEAL_MS;
    return { n, kind, ...timed, ...more[n] };
  });
}
const KINDS: QuizKind[] = ["sil", "crop", "intro", "meme", "sil"];
/** Opened 3 s ago by you (h 1): its first question starting now */
const quiz = (more: Partial<QuizMode> = {}, qs: Partial<QuizQuestion>[] = []): QuizMode => {
  const at = more.at ?? NOW - 3_000;
  const list = questions(at, KINDS, qs);
  const until = list[4].ends + QUIZ_REVEAL_MS + QUIZ_RESULT_MS;
  return { kind: "quiz", by: 1, at, begun: at, played: 0, next: [], in: [{ h: 1, combo: 0 }, { h: 2, combo: 0 }], endsAt: until, until, questions: list, ...more };
};
const room = (more: Partial<SquadRoom> = {}): SquadRoom => ({
  id: "r1",
  server: "cn",
  level: 3,
  tags: [],
  state: "wait",
  friendsOnly: false,
  stopped: false,
  key: "k",
  keyAt: NOW,
  keyLeft: 3,
  you: 1,
  host: true,
  staff: false,
  members: [member(1), member(2), member(3), member(4)],
  wentAt: null,
  waitedAt: NOW,
  fire: { level: 0, prog: 0, at: NOW, by: null, top: 0, last: null, lastTop: 0, bestTop: 0 },
  stack: { round: 1, at: NOW, n: 0, sum: 0, top: [], swingAt: NOW, best: 0, busy: [] },
  mode: null,
  endsAt: NOW + 3_600_000,
  endsWhy: "idle",
  declared: false,
  invited: [],
  hear: true,
  listen: null,
  now: NOW,
  ...more,
});
const OPTIONS = ["拉普兰德", "德克萨斯", "能天使"];
const ask = (n: number, kind: QuizKind, more: Partial<QuizAsk> = {}): QuizAsk => ({ n, kind, at: 0, ends: 0, options: OPTIONS, now: NOW, ...more });
const nothing = () => {};
function view(
  r: SquadRoom,
  now: number,
  more: { asks?: Record<number, QuizAsk>; picks?: QuizPicks | null; sound?: QuizSound | null; msg?: string | null } = {},
) {
  return renderToStaticMarkup(
    createElement(QuizView, {
      room: r,
      mode: r.mode as QuizMode,
      now,
      asks: more.asks ?? {},
      picks: more.picks ?? null,
      sound: more.sound ?? null,
      busy: false,
      msg: more.msg ?? null,
      onClose: nothing,
      onPick: nothing,
      onJoin: nothing,
      onLeave: nothing,
      onSound: nothing,
    }),
  );
}
const PIC = "data:image/webp;base64,UklGRg==";

describe("凯尔希随堂测's card", () => {
  it("goes from its start to five questions, each answered then shown, and its results, on the server's clock", () => {
    const m = quiz();
    const [q0, q1, , , q4] = m.questions;
    expect(quizPhase(m, NOW - 1)).toEqual({ at: "lead", q: q0 });
    expect(quizPhase(m, NOW)).toEqual({ at: "ask", q: q0 });
    expect(quizPhase(m, NOW + QUIZ_ANSWER_MS - 1).at).toBe("ask");
    expect(quizPhase(m, NOW + QUIZ_ANSWER_MS)).toEqual({ at: "reveal", q: q0 });
    expect(quizPhase(m, q1.at)).toEqual({ at: "ask", q: q1 });
    // an intro is answered for as long as it plays
    expect(m.questions[2].ends - m.questions[2].at).toBe(QUIZ_INTRO_MS);
    expect(quizPhase(m, q4.ends + QUIZ_REVEAL_MS - 1)).toEqual({ at: "reveal", q: q4 });
    expect(quizPhase(m, q4.ends + QUIZ_REVEAL_MS).at).toBe("results");
    expect(quizPhase(m, m.until + 4_000).at).toBe("results");
  });

  it("counts down to its first question, its three not shown yet", () => {
    const r = room({ mode: quiz() });
    const html = view(r, NOW - 2_200);
    expect(html).toContain("凯尔希随堂测 · 3 秒后开始");
    expect(html).toContain('<span class="lead">3</span>');
    // the first's kind lit among the four
    expect(html).toContain('<span class="on">干员剪影</span><span class="">立绘局部</span><span class="">BGM 前奏</span><span class="">方舟梗</span>');
    expect(html).not.toContain("这是谁的剪影？");
    expect(html.match(/<button type="button" class="opt" disabled="">/g)).toHaveLength(3);
    expect(html).toContain("<span>…</span>");
    // everyone in it with their points, you marked; 不答了 to you
    expect(html).toContain('class="pl you"');
    expect(html).toContain("<small>你</small><b>0</b>");
    expect(html).toContain("<small>企鹅物流</small><b>0</b>");
    expect(html).toContain("不答了，去围观");
  });

  it("waits for everyone answering to have a question loaded, saying how many have, its three not shown yet", () => {
    // the first could have started now; one of the two has it, so it waits (8 s at most), and those after it with it
    const base = quiz();
    const late = (q: QuizQuestion) => ({ ...q, at: q.at + QUIZ_LOAD_MAX_MS, ends: q.ends + QUIZ_LOAD_MAX_MS });
    const m = { ...base, questions: base.questions.map((q) => (q.n ? { ...late(q), from: q.from + QUIZ_LOAD_MAX_MS } : { ...late(q), wait: { ready: 1, of: 2 } })) };
    expect(quizPhase(m, NOW + 500)).toEqual({ at: "load", q: m.questions[0] });
    expect(quizPhase(m, NOW + QUIZ_LOAD_MAX_MS)).toEqual({ at: "ask", q: m.questions[0] });
    const r = room({ mode: m });
    const waiting = view(r, NOW + 500, { asks: { 0: ask(0, "sil", { pic: PIC }) } });
    expect(waiting).toContain("凯尔希随堂测 · 第 1 / 5 题");
    expect(waiting).toContain('<span class="say">等大家把题目加载好…（1/2）</span>');
    expect(waiting).toContain('class="stage k-sil k-lead"');
    expect(waiting).not.toContain('<img class="sil"');
    expect(waiting).not.toContain("这是谁的剪影？");
    expect(waiting.match(/<button type="button" class="opt" disabled="">/g)).toHaveLength(3);
    expect(waiting).not.toContain('class="secs"');
    // this page's own not here yet: still coming
    expect(view(r, NOW + 500)).toContain('<span class="say">出题中…</span>');
  });

  it("asks a silhouette with its picture, the seconds left and a bar running down, its three to pick from", () => {
    const r = room({ mode: quiz() });
    const html = view(r, NOW + 1_200, { asks: { 0: ask(0, "sil", { pic: PIC }) } });
    expect(html).toContain("凯尔希随堂测 · 第 1 / 5 题");
    expect(html).toContain(`<img class="sil" src="${PIC}" alt="干员剪影" draggable="false"/>`);
    expect(html).toContain('<span class="secs">2s</span>');
    expect(html).toContain('class="run" style="animation-duration:3000ms;animation-delay:-1200ms"');
    expect(html).toContain('<p class="ask">这是谁的剪影？</p>');
    expect(html).toContain('<button type="button" class="opt"><b>A</b><span>拉普兰德</span></button>');
    expect(html).toContain("<b>C</b><span>能天使</span>");
    // its picture not here yet: 出题中
    expect(view(r, NOW + 200)).toContain("出题中…");
    // the three from the room's own view when the page has not got them
    const fromRoom = room({ mode: quiz({}, [{ options: ["陈", "星熊", "诗怀雅"] }]) });
    expect(view(fromRoom, NOW + 200)).toContain("<b>B</b><span>星熊</span>");
    // a part of a 立绘, on its dark ground
    const crop = view(r, quiz().questions[1].at + 100, { asks: { 1: ask(1, "crop", { pic: PIC }) } });
    expect(crop).toContain('class="stage k-crop"');
    expect(crop).toContain('<img class="crop"');
    expect(crop).toContain("这块立绘是谁身上的？");
  });

  it("shows your pick as sent, then the right one with who was first and how fast, and what comes next", () => {
    const at = NOW;
    const mine = (pick: QuizPicks["picks"][number]): QuizPicks => ({ at: NOW - 3_000, picks: { 0: pick } });
    const r = room({ mode: quiz() });
    // sent, not judged yet: yours marked, nothing more to pick
    const sent = view(r, at + 900, { picks: mine({ pick: 1 }), asks: { 0: ask(0, "sil", { pic: PIC }) } });
    expect(sent).toContain('class="opt mine" disabled=""><b>B</b><span>德克萨斯</span><small>你选的</small>');
    expect(sent.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
    // yours the first right: the point, the room's view with it
    const won = room({ mode: quiz({ in: [{ h: 1, combo: 1 }, { h: 2, combo: 0 }] }, [{ options: OPTIONS, answer: 1, first: { h: 1, ms: 1_234 } }]) });
    const right = view(won, at + 1_300, { picks: mine({ pick: 1, right: true, first: true, answer: 1 }) });
    expect(right).toContain('class="opt ok" disabled=""><b>B</b><span>德克萨斯</span><small>你 1.2 秒</small>');
    expect(right).toContain('<span class="ok">答对了！你最快，+1 分</span>');
    // the next once it is decided, on the server's clock
    expect(right).toContain("<small>下一题 4 秒后</small>");
    expect(right).toContain("<small>你</small><b>1</b>");
    // no bar once someone got it
    expect(right).not.toContain('class="run"');
    // yours wrong, another first: TA's on the right one, yours marked
    const lost = room({ mode: quiz({ in: [{ h: 1, combo: 0 }, { h: 2, combo: 1 }] }, [{ options: OPTIONS, answer: 2, first: { h: 2, ms: 800 } }]) });
    const wrong = view(lost, at + 1_500, { picks: mine({ pick: 0, right: false, first: false, answer: 2 }) });
    expect(wrong).toContain('class="opt bad" disabled=""><b>A</b><span>拉普兰德</span><small>你选的</small>');
    expect(wrong).toContain('class="opt ok" disabled=""><b>C</b><span>能天使</span><small>企鹅物流 0.8 秒</small>');
    expect(wrong).toContain('<span class="bad">企鹅物流 先答对了，+1 分</span>');
    // right, but TA was faster
    const late = view(lost, at + 1_500, { picks: mine({ pick: 2, right: true, first: false, answer: 2 }) });
    expect(late).toContain("<span>答对了，不过 企鹅物流 更快</span>");
  });

  it("says no one got it once its time is up, and after the last question that it was the last", () => {
    const m = quiz({}, [{ options: OPTIONS, answer: 0 }, {}, {}, {}, { options: OPTIONS, answer: 2 }]);
    const r = room({ mode: m });
    const none = view(r, NOW + QUIZ_ANSWER_MS + 300);
    expect(none).toContain("<span>时间到，没人答对</span>");
    expect(none).toContain('class="opt ok" disabled=""><b>A</b>');
    expect(none).toContain("<small>下一题 2 秒后</small>");
    // yours wrong, before anyone got it; then no one did
    const picks: QuizPicks = { at: m.begun, picks: { 0: { pick: 1, right: false, first: false, answer: 0 } } };
    expect(resultLine(r, m.questions[0], picks.picks[0], NOW + 1_000)).toEqual({ text: "答错了", tone: "bad" });
    expect(resultLine(r, m.questions[0], picks.picks[0], NOW + QUIZ_ANSWER_MS)).toEqual({ text: "时间到，没人答对", tone: "bad" });
    // nothing to say yet
    expect(resultLine(r, quiz().questions[0], undefined, NOW + 1_000)).toBeNull();
    const last = view(r, m.questions[4].ends + 500);
    expect(last).toContain("凯尔希随堂测 · 第 5 / 5 题");
    expect(last).toContain("<small>最后一题完了</small>");
  });

  it("plays an intro to one who can hear it, and says why not, or asks for a tap first", () => {
    const m = quiz();
    const q = m.questions[2];
    const r = room({ mode: m });
    const at = q.at + 2_000;
    const asks = { 2: ask(2, "intro", { url: "/m/s1.mp3", options: ["Operation Pyrite", "Speed of Light", "Renegade"] }) };
    const on = view(r, at, { asks, sound: "on" });
    expect(on).toContain('class="stage k-intro"');
    expect(on).toContain('<span class="eq on" aria-hidden="true">');
    expect(on).toContain("♪ 前奏放着");
    expect(on).toContain('<span class="secs">4s</span>');
    expect(on).toContain("这是哪首歌的前奏？");
    expect(on).toContain("<b>B</b><span>Speed of Light</span>");
    expect(view(r, at, { asks, sound: "none" })).toContain("听歌没开给你，听不到前奏");
    expect(view(r, at, { asks, sound: "else" })).toContain("你在听歌，前奏放不出来");
    expect(view(r, at, { asks, sound: "blocked" })).toContain('<button type="button" class="play">▶ 点一下放前奏</button>');
  });

  it("writes a 方舟梗 question's own words on the blackboard", () => {
    const m = quiz();
    const q = m.questions[3];
    const html = view(room({ mode: m }), q.at + 500, { asks: { 3: ask(3, "meme", { ask: "“刀客塔”说的是？", options: ["阿米娅", "博士", "凯尔希"] }) } });
    expect(html).toContain('class="stage k-meme"');
    expect(html).toContain('<b class="board">“刀客塔”说的是？</b>');
    expect(html).not.toContain('<p class="ask">');
    expect(html).toContain("<b>B</b><span>博士</span>");
  });

  it("leaves one not in the round to watch it, asking for the next round (下一局算我), and says so once asked", () => {
    const m = quiz({ in: [{ h: 2, combo: 0 }], by: 2 });
    const r = room({ mode: m });
    const watching = view(r, NOW + 1_000, { asks: { 0: ask(0, "sil", { pic: PIC }) } });
    expect(watching).toContain(">这局先围观 · 下一局算我</button>");
    expect(watching).not.toContain("不答了，去围观");
    expect(watching.match(/class="opt" disabled=""/g)).toHaveLength(3);
    // asked for the next: in it once this one is over, nothing to pick in this one
    const queued = view(room({ mode: quiz({ in: [{ h: 2, combo: 0 }], by: 2, next: [1] }) }), NOW + 1_000, { asks: { 0: ask(0, "sil", { pic: PIC }) } });
    expect(queued).toContain('<p class="qline">排进下一局了：这局跑完你就在里面</p>');
    expect(queued).not.toContain("下一局算我</button>");
    expect(queued.match(/class="opt" disabled=""/g)).toHaveLength(3);
  });

  it("gives everyone's place at the end, those with the same sharing it, and who wears 漏勺", () => {
    const m = quiz({ in: [{ h: 1, combo: 2 }, { h: 2, combo: 3 }, { h: 3, combo: 0 }, { h: 4, combo: 2 }] });
    const r = room({ mode: m });
    expect(quizRanks(r, m).map((x) => [x.m.h, x.place, x.ladle])).toEqual([
      [2, 1, false],
      [1, 2, false],
      [4, 2, false],
      [3, 4, true],
    ]);
    const html = view(r, m.until - 1_000);
    expect(html).toContain("凯尔希随堂测 · 这一局完了");
    expect(html).toContain("<h3>这一局</h3>");
    expect(html).toContain('<span class="pn">第 1</span>');
    expect(html).toContain('<span class="nm">漏勺本勺</span><em>扣漏勺</em><b>0 分</b>');
    expect(html).toContain('<li class="you"><span class="pn">第 2</span>');
    expect(html).toContain("漏勺本勺 头上扣漏勺 1 分钟");
    // no 不答了 nor 加入 once it is over
    expect(html).not.toContain("不答了，去围观");
    expect(html).not.toContain("下一题加入");
    // two at the bottom both wear it; all the same, no one; one alone practised
    const two = quiz({ in: [{ h: 1, combo: 0 }, { h: 2, combo: 3 }, { h: 3, combo: 0 }] });
    expect(ladleLine(r, two)).toBe("你、漏勺本勺 头上扣漏勺 1 分钟");
    expect(ladleLine(r, quiz({ in: [{ h: 1, combo: 1 }, { h: 2, combo: 1 }] }))).toBe("同分，谁都不扣漏勺");
    expect(ladleLine(r, quiz({ in: [{ h: 1, combo: 4 }] }))).toBe("一个人自己练，不扣漏勺");
  });

  it("is a match of 玩点什么: 发起 while nothing plays, 下一局 to one not in a round of it", () => {
    expect(modeRow(room(), "quiz", NOW)).toEqual({ kind: "quiz", label: "发起", does: "open" });
    expect(modeRow(room({ mode: quiz({ in: [{ h: 2, combo: 0 }], by: 2 }) }), "quiz", NOW)).toEqual({ kind: "quiz", label: "下一局", does: "next", tag: "下一局" });
    expect(modeRow(room({ mode: quiz() }), "gift", NOW).does).toBeNull();
  });
});

describe("the quiz on the page", () => {
  afterEach(() => {
    forgetSquadPage();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** The room as the server gives it, answers and joining as given; what was sent, kept */
  function server(r: SquadRoom, answer: (body: Record<string, unknown>) => { status: number; json: unknown }) {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("window", {
      __ZP_I18N: globalThis.__ZP_I18N_SERVER!(),
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      sent.push({ url, body });
      if (url === "/api/squad/room") return new Response(JSON.stringify({ room: r, now: Date.now() }));
      if (url === "/api/squad/modein") return new Response(JSON.stringify({ now: Date.now() }));
      const res = answer(body);
      return new Response(JSON.stringify(res.json), { status: res.status });
    });
    return sent;
  }

  it("sends your pick once a question at the server's clock, shows it at once and then as judged, and takes it back if refused", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW + 1_000);
    const m = quiz();
    let res: { status: number; json: unknown } = { status: 200, json: { right: true, first: true, answer: 1, now: NOW + 1_000 } };
    const sent = server(room({ mode: m, now: NOW + 1_000 }), () => res);
    await loadSquadRoom();
    const going = squadQuizAnswer(0, 1);
    // shown at once as picked
    expect(squadQuizPicksNow()?.picks[0]).toEqual({ pick: 1 });
    const picked = await going;
    expect(picked).toMatchObject({ right: true, first: true, answer: 1 });
    expect(sent.find((s) => s.url === "/api/squad/answer")?.body).toEqual({ n: 0, pick: 1, at: NOW + 1_000 });
    // once a question: nothing sent again
    expect(await squadQuizAnswer(0, 2)).toBeNull();
    expect(sent.filter((s) => s.url === "/api/squad/answer")).toHaveLength(1);
    // refused: taken back, so another try may go
    vi.setSystemTime(m.questions[1].at + 200);
    res = { status: 409, json: { error: "这题时间到了。", code: "late" } };
    await expect(squadQuizAnswer(1, 0)).rejects.toThrow("这题时间到了。");
    expect(squadQuizPicksNow()?.picks[1]).toBeUndefined();
    res = { status: 200, json: { right: false, first: false, answer: 2, now: m.questions[1].at + 300 } };
    expect(await squadQuizAnswer(1, 0)).toMatchObject({ right: false, answer: 2 });
    // as judged, for this round
    expect(squadQuizPicksNow()).toEqual({
      at: m.begun,
      picks: { 0: { pick: 1, right: true, first: true, answer: 1 }, 1: { pick: 0, right: false, first: false, answer: 2 } },
    });
  });

  it("asks for each question ahead, card open or not, and says it has it loaded to the server; one watching only looks", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW - 3_000);
    // a page whose own timers go off as its clock is moved on
    let id = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    let loaded = 503;
    vi.stubGlobal("window", {
      __ZP_I18N: globalThis.__ZP_I18N_SERVER!(),
      setTimeout: (fn: () => void, ms = 0) => {
        timers.set(++id, { at: Date.now() + ms, fn });
        return id;
      },
      clearTimeout: (k: number) => void timers.delete(k),
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    const base = quiz({ begun: NOW - 3_000 });
    const late = (q: QuizQuestion) => ({ ...q, at: q.at + QUIZ_LOAD_MAX_MS, ends: q.ends + QUIZ_LOAD_MAX_MS });
    const m = { ...base, questions: base.questions.map((q) => (q.n ? { ...late(q), from: q.from + QUIZ_LOAD_MAX_MS } : { ...late(q), wait: { ready: 0, of: 2 } })) };
    let r = room({ mode: m, now: NOW - 3_000 });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      sent.push({ url, body });
      if (url === "/api/squad/room") return new Response(JSON.stringify({ room: r, now: Date.now() }));
      if (url === "/api/squad/question") return new Response(JSON.stringify(ask(body.n as number, "meme", { ask: "“刀客塔”说的是？", now: Date.now() })));
      if (url === "/api/squad/loaded") return new Response(JSON.stringify(loaded === 200 ? { now: Date.now() } : { error: "忙" }), { status: loaded });
      return new Response("{}");
    });
    const settle = async () => {
      for (let i = 0; i < 4; i++) await new Promise((done) => setTimeout(done, 0));
    };
    const go = async (t: number) => {
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= t).sort((p, q) => p[1].at - q[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        vi.setSystemTime(Math.max(Date.now(), due[1].at));
        due[1].fn();
        await settle();
      }
      vi.setSystemTime(t);
      await settle();
    };
    await loadSquadRoom();
    // not yet: nothing asked for
    await go(NOW - QUIZ_FETCH_MS - 100);
    expect(sent.filter((x) => x.url === "/api/squad/question")).toEqual([]);
    // from just before it could start: asked for, kept, and said loaded (the server busy at first: again in a while)
    await go(NOW - QUIZ_FETCH_MS + 400);
    expect(sent.filter((x) => x.url === "/api/squad/question").map((x) => x.body)).toEqual([{ n: 0 }]);
    expect(squadQuizAsksNow()).toMatchObject({ begun: NOW - 3_000, got: { 0: { n: 0, ask: "“刀客塔”说的是？" } } });
    expect(sent.filter((x) => x.url === "/api/squad/loaded").map((x) => x.body)).toEqual([{ n: 0 }]);
    loaded = 200;
    await go(NOW - QUIZ_FETCH_MS + 1_200);
    expect(sent.filter((x) => x.url === "/api/squad/loaded")).toHaveLength(2);
    // once said, never again; the next not asked for while this one waits
    await go(NOW + 2_000);
    expect(sent.filter((x) => x.url === "/api/squad/loaded")).toHaveLength(2);
    expect(sent.filter((x) => x.url === "/api/squad/question")).toHaveLength(1);
    // its wait over by itself: the room read again for it
    const reads = sent.filter((x) => x.url === "/api/squad/room").length;
    await go(NOW + QUIZ_LOAD_MAX_MS + 400);
    expect(sent.filter((x) => x.url === "/api/squad/room").length).toBeGreaterThan(reads);
    // one watching (not in the round) asks for it to see it, never says it has it
    forgetSquadPage();
    sent.length = 0;
    r = room({ mode: { ...m, in: [{ h: 2, combo: 0 }] }, now: Date.now() });
    vi.setSystemTime(NOW - 3_000);
    await loadSquadRoom();
    await go(NOW - QUIZ_FETCH_MS + 400);
    expect(sent.filter((x) => x.url === "/api/squad/question")).toHaveLength(1);
    expect(sent.filter((x) => x.url === "/api/squad/loaded")).toEqual([]);
  });

  it("keeps your answers by round: the next round of the same match starts with none", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW + 1_000);
    const m = quiz();
    server(room({ mode: m, now: NOW + 1_000 }), () => ({ status: 200, json: { right: true, first: true, answer: 1, now: NOW + 1_000 } }));
    await loadSquadRoom();
    await squadQuizAnswer(0, 1);
    expect(squadQuizPicksNow()?.at).toBe(m.begun);
    // the next round, begun later from the same start: its question 0 is new to you
    const later = m.until + 10_000;
    const m2 = quiz({ at: m.at, begun: later, played: 1 });
    vi.setSystemTime(later + 1_000);
    server(room({ mode: { ...m2, questions: m2.questions.map((q) => ({ ...q, at: q.at - m.at + later, ends: q.ends - m.at + later })) }, now: later + 1_000 }), () => ({
      status: 200,
      json: { right: false, first: false, answer: 0, now: later + 1_000 },
    }));
    await loadSquadRoom();
    expect(await squadQuizAnswer(0, 2)).toMatchObject({ right: false });
    expect(squadQuizPicksNow()).toEqual({ at: later, picks: { 0: { pick: 2, right: false, first: false, answer: 0 } } });
  });
});
