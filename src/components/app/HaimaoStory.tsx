"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { fmt, T } from "@/i18n";
import { HAIMAO, HAIMAO_LOVE_MAX } from "@/lib/haimao";
import { haimaoApi } from "@/lib/haimaoClient";
import {
  dailyLine,
  HAIMAO_BADGE,
  HAIMAO_DAYS,
  haimaoFaceUrl,
  haimaoStreetUrl,
  storyEnd,
  storyScene,
  type HaimaoFace,
  type HaimaoStep,
  type HaimaoStory,
  type StoryLine,
  type StoryProp,
  type StoryScene,
} from "@/lib/haimaoStory";
import { BadgeImg } from "./Badges";
import { HaimaoFigure } from "./Haimao";
import { playSound, preloadClip } from "./haimaoSound";
import Sheet from "./Sheet";

/**
 * 今日剧情 (src/lib/haimaoStory.ts): 香艳制作人 on the street outside her tower, the day's scene of her story told a
 * line at a time, her face changing with what she says, until its three answers; after the twelfth ALL END, at dusk;
 * after that, her line of the day. What the server keeps (src/lib/server/haimao.ts) decides what today holds: an
 * answer shows at once, and the 好感度 it brought once the server has it.
 *
 * 回顾剧情: once today's part is over, any scene seen (and ALL END) from its first line again, the answer picked then
 * marked; another may be picked to hear her reply, which keeps nothing. 回到今天 goes back to where today was.
 */

/** A server call made as the map makes them: a refusal said, or the sign-in asked for; undefined then */
export type HaimaoRun = <R>(call: () => Promise<R>) => Promise<R | undefined>;

type View = { kind: "scene"; scene: StoryScene } | { kind: "end" } | { kind: "chat"; line: number };
/** lines: the scene's; choose: its answers; react: her reply; done: the day's scene over; end: ALL END's lines, then its card */
type Mode = "lines" | "choose" | "react" | "done" | "end" | "endCard" | "chat";
/** What flies across the stage: where, and how; left only where it stays still, w the stage's width to cross */
type Flying = { key: string; text: string; top: number; left: number; dur: number; delay: number; w: number };

/** How fast her lines type out, a character at a time */
const TYPE_MS = 34;

const reduced = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** What she takes out (the design's own drawings) */
const PROPS: Record<StoryProp, ReactNode> = {
  staff: (
    <svg viewBox="0 0 40 80">
      <rect x="18" y="18" width="4.5" height="60" rx="2.2" fill="#2a3550" stroke="#0d0e10" strokeWidth="1.6" />
      <circle cx="20.2" cy="14" r="11" fill="none" stroke="#f2a33a" strokeWidth="3" />
      <circle cx="20.2" cy="14" r="6" fill="#8fe3ff" stroke="#0d0e10" strokeWidth="1.6" />
      <path d="M22 24 C30 28 34 36 30 44" fill="none" stroke="#f2a33a" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  ),
  hammer: (
    <svg viewBox="0 0 64 64">
      <rect x="29" y="22" width="6" height="40" rx="3" fill="#8a5a2b" stroke="#0d0e10" strokeWidth="2" />
      <rect x="10" y="6" width="44" height="20" rx="5" fill="#8fa3bf" stroke="#0d0e10" strokeWidth="2.4" />
      <rect x="10" y="6" width="9" height="20" rx="3" fill="#cf3668" stroke="#0d0e10" strokeWidth="2" />
      <rect x="45" y="6" width="9" height="20" rx="3" fill="#cf3668" stroke="#0d0e10" strokeWidth="2" />
      <text x="32" y="20.5" textAnchor="middle" fontSize="10" fill="#0d0e10">
        ALL
      </text>
    </svg>
  ),
  dice: (
    <svg viewBox="0 0 64 64">
      <path d="M32 6 L56 18 L32 30 L8 18 Z" fill="#ffffff" stroke="#0d0e10" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M8 18 L32 30 L32 58 L8 46 Z" fill="#f3efe6" stroke="#0d0e10" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M56 18 L32 30 L32 58 L56 46 Z" fill="#ddd5ec" stroke="#0d0e10" strokeWidth="2.4" strokeLinejoin="round" />
      <g fill="#cf3668" fontSize="9" textAnchor="middle">
        <text transform="matrix(1 -.5 1 .5 8 18)" x="12" y="15">
          ALL
        </text>
        <text transform="matrix(1 .5 0 1 8 18)" x="12" y="18">
          ALL
        </text>
        <text transform="matrix(1 -.5 0 1 32 30)" x="12" y="18">
          ALL
        </text>
      </g>
    </svg>
  ),
};

/** One of the eggs of day 7, ALL inside */
function Egg({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 40 54" className={open ? "cracked" : undefined}>
      <path
        d="M3 30 C3 44 11 52 20 52 C29 52 37 44 37 30 L31 27 L26 32 L20 26 L14 32 L9 27 Z"
        fill="#f2c230"
        stroke="#0d0e10"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <text x="20" y="44" textAnchor="middle" fontSize="11" fill="#3b2a00">
        ALL
      </text>
      <path
        className="top"
        d="M3 30 C3 14 11 2 20 2 C29 2 37 14 37 30 L31 27 L26 32 L20 26 L14 32 L9 27 Z"
        fill="#ffd95a"
        stroke="#0d0e10"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const HEART = "M12 21 C5 15.5 1.5 12 1.5 7.4 C1.5 4 4 1.5 7.2 1.5 C9.3 1.5 11 2.6 12 4.3 C13 2.6 14.7 1.5 16.8 1.5 C20 1.5 22.5 4 22.5 7.4 C22.5 12 19 15.5 12 21 Z";

/** Her faces a view will want, so they are fetched before she makes them */
function facesOf(view: View | null): HaimaoFace[] {
  const lines: StoryLine[] = !view
    ? []
    : view.kind === "scene"
      ? [...view.scene.lines, ...view.scene.answers.flatMap((a) => a.reply)]
      : view.kind === "end"
        ? storyEnd()
        : [dailyLine(view.line)];
  return [...new Set<HaimaoFace>(["smile", ...lines.flatMap((l) => (l.face ? [l.face] : []))])];
}

/**
 * review: opened as 回顾剧情, with the list of the scenes seen first; trial: for 站长 and the admins, 试玩 under the
 * stage, the next day at once or the story from its start (their own)
 */
export default function HaimaoStorySheet({
  run,
  review = false,
  trial = false,
  onClose,
}: {
  run: HaimaoRun;
  review?: boolean;
  trial?: boolean;
  onClose: () => void;
}) {
  const S = T.guides.haimao.stage;
  const [story, setStory] = useState<HaimaoStory | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [mode, setMode] = useState<Mode>("lines");
  const [line, setLine] = useState<StoryLine | null>(null);
  const [typed, setTyped] = useState(0);
  const [face, setFace] = useState<HaimaoFace>("smile");
  const [propOn, setPropOn] = useState(false);
  const [cracked, setCracked] = useState(0);
  const [float, setFloat] = useState<{ n: number; at: number } | null>(null);
  const [flying, setFlying] = useState<Flying[] | null>(null);
  const [busy, setBusy] = useState(false);
  // her pictures are off (HAIMAO_PICTURE) or will not load: her Q figure stands in
  const [plain, setPlain] = useState(false);
  // the streets fetched so far: each only once it is wanted
  const [streets, setStreets] = useState({ day: false, dusk: false });
  // 回顾剧情: its list over the stage; a scene seen being seen again; today's new scene, waiting while the list was
  // opened first
  const [listOpen, setListOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [held, setHeld] = useState<StoryScene | null>(null);
  const queue = useRef<StoryLine[]>([]);
  // when the line now typing began: its characters come at TYPE_MS each however slowly the page draws
  const typingFrom = useRef(0);
  const timers = useRef<number[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLButtonElement>(null);
  const firstAnswer = useRef<HTMLButtonElement>(null);
  const firstDay = useRef<HTMLButtonElement>(null);

  const chars = useMemo(() => Array.from(line?.text ?? ""), [line]);
  const typing = typed < chars.length;
  const dusk = view ? view.kind === "end" || (view.kind === "scene" && view.scene.dusk) : null;
  const faces = useMemo(() => facesOf(view), [view]);

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // a line types out a character at a time
  useEffect(() => {
    if (!typing) return;
    const t = window.setInterval(
      () => setTyped(Math.min(chars.length, Math.floor((performance.now() - typingFrom.current) / TYPE_MS) + 1)),
      TYPE_MS,
    );
    return () => window.clearInterval(t);
  }, [typing, chars.length]);

  useEffect(() => {
    if (dusk === null) return;
    setStreets((s) => (dusk ? (s.dusk ? s : { ...s, dusk: true }) : s.day ? s : { ...s, day: true }));
  }, [dusk]);

  useEffect(() => {
    if (mode === "choose") firstAnswer.current?.focus({ preventScroll: true });
  }, [mode]);

  useEffect(() => {
    if (listOpen) firstDay.current?.focus({ preventScroll: true });
  }, [listOpen]);

  /** A line said (or told), with what it sets off: her face, what she takes out, the eggs, her gull */
  const say = (l: StoryLine, instant = false) => {
    setLine(l);
    typingFrom.current = performance.now();
    setTyped(instant || reduced() ? Array.from(l.text).length : 0);
    if (l.face) setFace(l.face);
    if (l.cue === "prop") setPropOn(true);
    else if (l.cue === "crack") crack();
    else if (l.cue === "meow") playSound("meow");
  };

  const crack = () => {
    if (reduced()) {
      setCracked(3);
      playSound("ding");
      return;
    }
    for (let i = 0; i < 3; i++) {
      later(250 + i * 380, () => {
        setCracked(i + 1);
        playSound("ding");
      });
    }
  };

  /** Everyone sings along: dame dame flies across the stage (still, where motion is reduced) */
  const fly = () => {
    const still = reduced();
    const at = Date.now();
    const w = stage.current?.clientWidth ?? 600;
    setFlying(
      Array.from({ length: 10 }, (_, i) => ({
        key: `${at}-${i}`,
        text: S.danmaku[i % S.danmaku.length],
        top: 14 + Math.random() * 40,
        left: still ? 4 + Math.random() * 56 : -1,
        dur: 4 + Math.random() * 2.5,
        delay: Math.random() * 1.2,
        w,
      })),
    );
    later(still ? 3000 : 8500, () => setFlying((f) => (f?.[0]?.key.startsWith(`${at}-`) ? null : f)));
  };

  /** A scene set (or none): its prop out and its eggs open if it is over; what the last one had going, stopped */
  const setting = (scene: StoryScene | null, over: boolean) => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPropOn(over && Boolean(scene?.prop));
    setCracked(over && scene?.eggs ? 3 : 0);
    setFlying(null);
  };

  /** The day's scene, from its first line */
  const playScene = (scene: StoryScene) => {
    setView({ kind: "scene", scene });
    setMode("lines");
    setting(scene, false);
    queue.current = scene.lines.slice(1);
    say(scene.lines[0]);
  };

  /** The day's scene over (answered): as it ended, and what comes next; instant: opened so, her face back to a smile */
  const sceneDone = (scene: StoryScene, instant: boolean) => {
    setView({ kind: "scene", scene });
    setMode("done");
    if (instant) {
      setting(scene, true);
      setFace("smile");
    }
    queue.current = [];
    say({ text: scene.day < HAIMAO_DAYS ? S.done : S.last, face: null }, instant);
  };

  const playEnd = () => {
    const lines = storyEnd();
    setView({ kind: "end" });
    setMode("end");
    setting(null, false);
    queue.current = lines.slice(1);
    say(lines[0]);
  };

  /** ALL END seen today: its card */
  const endCard = () => {
    setView({ kind: "end" });
    setMode("endCard");
    setting(null, false);
    setFace("smile");
    queue.current = [];
    setLine(null);
  };

  const playChat = (i: number, instant = false) => {
    setView({ kind: "chat", line: i });
    setMode("chat");
    setting(null, false);
    queue.current = [];
    say(dailyLine(i), instant);
  };

  /** Where today is, as the server keeps it; instant: back to it, as it stands */
  const toToday = (s: HaimaoStory, instant: boolean) => {
    const t = s.today;
    if (t.kind === "end") endCard();
    else if (t.kind === "chat") playChat(t.line, instant);
    else if (t.picked === null) playScene(storyScene(t.day));
    else sceneDone(storyScene(t.day), true);
  };

  /** Today's new scene, behind the list it was opened with: on its street, not begun */
  const hold = (scene: StoryScene) => {
    setHeld(scene);
    setView({ kind: "scene", scene });
    setMode("lines");
    setting(scene, false);
    queue.current = [];
    setLine(null);
  };

  /** 回顾剧情's list, closed: today's new scene begins, if it was waiting */
  const closeList = () => {
    setListOpen(false);
    if (held && !reviewing) {
      setHeld(null);
      playScene(held);
    } else box.current?.focus({ preventScroll: true });
  };

  /** A scene seen (n), or ALL END (0), from its first line again */
  const seeAgain = (n: number) => {
    setListOpen(false);
    setReviewing(true);
    if (n > 0) playScene(storyScene(n));
    else playEnd();
    box.current?.focus({ preventScroll: true });
  };

  const backToToday = () => {
    setReviewing(false);
    if (held) {
      setHeld(null);
      playScene(held);
    } else if (story) toToday(story, true);
    box.current?.focus({ preventScroll: true });
  };

  /** A scene seen again, over */
  const seenAgain = () => {
    setMode("done");
    queue.current = [];
    say({ text: S.reviewDone, face: null });
  };

  const took = (step: HaimaoStep) => {
    setStory(step);
    if (step.plus > 0) setFloat({ n: step.plus, at: Date.now() });
  };

  // what today holds, as the server keeps it; her damedane on its way, for her dame dame replies
  useEffect(() => {
    let gone = false;
    preloadClip();
    void run(() => haimaoApi.story()).then((s) => {
      if (gone) return;
      if (!s) return onClose();
      setStory(s);
      const t = s.today;
      if (review && s.days > 0) {
        setListOpen(true);
        if (t.kind === "scene" && t.picked === null) return hold(storyScene(t.day));
      }
      toToday(s, false);
    });
    return () => {
      gone = true;
    };
    // once, as it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A tap on what she says: the rest of the line at once, else what comes next */
  const advance = () => {
    if (!line) return;
    if (typing) return setTyped(chars.length);
    if (mode !== "lines" && mode !== "react" && mode !== "end") return;
    const next = queue.current.shift();
    if (next) return say(next);
    if (mode === "lines") return setMode("choose");
    if (mode === "react" && view?.kind === "scene") return reviewing ? seenAgain() : sceneDone(view.scene, false);
    if (mode === "end") {
      setMode("endCard");
      playSound("all", true);
    }
  };

  /** Their answer: her reply at once, and the 好感度 it brings once the server has kept it; seen again, nothing kept */
  const pick = (k: number) => {
    if (view?.kind !== "scene" || mode !== "choose") return;
    const { scene } = view;
    const a = scene.answers[k];
    setMode("react");
    if (a.dame) {
      playSound("dame", true);
      if (a.danmaku) fly();
    } else if (a.all) playSound("all", true);
    else playSound("ding");
    queue.current = a.reply.slice(1);
    say(a.reply[0]);
    box.current?.focus({ preventScroll: true });
    if (!reviewing) void run(() => haimaoApi.pick(scene.day, k)).then((step) => step && took(step));
  };

  /** 试玩: the next day, or the story from its start, then what today holds from its beginning */
  const tryOut = async (what: "next" | "restart") => {
    setBusy(true);
    const s = await run(() => haimaoApi.trial(what));
    setBusy(false);
    if (!s) return;
    setStory(s);
    setListOpen(false);
    setReviewing(false);
    setHeld(null);
    setFloat(null);
    toToday(s, false);
  };

  const seeEnd = async () => {
    setBusy(true);
    const step = await run(() => haimaoApi.end());
    setBusy(false);
    if (!step) return;
    took(step);
    if (step.end) playEnd();
  };

  const love = Math.min(HAIMAO_LOVE_MAX, Math.max(0, story?.love ?? 0));
  const scene = view?.kind === "scene" ? view.scene : null;
  const where = !view
    ? null
    : view.kind === "scene"
      ? fmt(S.day, { n: view.scene.day, title: view.scene.title })
      : view.kind === "end"
        ? S.end
        : S.daily;
  const label = where && reviewing ? fmt(S.reviewing, { what: where }) : where;
  const more = !typing && Boolean(line) && (mode === "lines" || mode === "react" || mode === "end");
  const toEnd = mode === "done" && !reviewing && scene?.day === HAIMAO_DAYS && story && !story.end;
  const seen = story?.days ?? 0;
  // 回顾剧情 once today's part (or the scene seen again) is over
  const canReview = seen > 0 && !listOpen && (mode === "done" || mode === "endCard" || mode === "chat");
  // the answer picked the day the scene was first seen
  const was = reviewing && scene ? story?.picks[scene.day - 1] : undefined;
  const again = seen > 0 && (
    <button type="button" className="hm-st-again" disabled={!canReview} onClick={() => setListOpen(true)}>
      {T.guides.haimao.review}
    </button>
  );
  const foot = reviewing ? (
    <div className="hm-st-foot">
      <button type="button" className="primary" onClick={backToToday}>
        {S.back}
      </button>
      {again}
    </div>
  ) : toEnd || again ? (
    <div className="hm-st-foot">
      {toEnd && (
        <button type="button" className="primary" disabled={busy} onClick={() => void seeEnd()}>
          {S.seeEnd}
        </button>
      )}
      {again}
    </div>
  ) : null;

  return (
    <Sheet
      title={T.guides.haimao.today}
      className="hm-story"
      onClose={onClose}
      footer={
        foot || trial ? (
          <>
            {foot}
            {trial && (
              <div className="hm-st-trial">
                <span>{T.guides.haimao.trial.label}</span>
                <button type="button" className="pill" disabled={busy || !story} onClick={() => void tryOut("next")}>
                  {T.guides.haimao.trial.next}
                </button>
                <button type="button" className="pill" disabled={busy || !story} onClick={() => void tryOut("restart")}>
                  {T.guides.haimao.trial.restart}
                </button>
              </div>
            )}
          </>
        ) : undefined
      }
    >
      <div ref={stage} className="hm-st">
        {streets.day && <div className="hm-st-bg" style={{ backgroundImage: `url(${haimaoStreetUrl(false)})` }} />}
        {streets.dusk && <div className={`hm-st-bg dusk${dusk ? " on" : ""}`} style={{ backgroundImage: `url(${haimaoStreetUrl(true)})` }} />}
        <div className="hm-st-hud">
          <div
            className="hm-st-meter"
            role="meter"
            aria-label={T.guides.haimao.love}
            aria-valuemin={0}
            aria-valuemax={HAIMAO_LOVE_MAX}
            aria-valuenow={love}
          >
            <svg viewBox="0 0 24 22" aria-hidden="true">
              <path d={HEART} fill="#e0447a" />
            </svg>
            <span>{T.guides.haimao.love}</span>
            <span className="hm-st-bar">
              <i style={{ width: `${(love / HAIMAO_LOVE_MAX) * 100}%` }} />
            </span>
            <b>{love}</b>
          </div>
          {label && <div className="hm-st-day">{label}</div>}
        </div>
        {float && (
          <span key={float.at} className="hm-st-float" aria-hidden="true">
            +{float.n} ♥
          </span>
        )}
        {scene?.eggs && (
          <div className="hm-st-eggs" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <Egg key={i} open={i < cracked} />
            ))}
          </div>
        )}
        {view &&
          (plain ? (
            <div className="hm-st-q" aria-hidden="true">
              <HaimaoFigure size={240} />
            </div>
          ) : (
            <div className="hm-st-lh" aria-hidden="true">
              {faces.map((f) => (
                // her picture with this face, from the server's own folder
                // eslint-disable-next-line @next/next/no-img-element
                <img key={f} className={f === face ? "on" : undefined} src={haimaoFaceUrl(f)} alt="" onError={() => setPlain(true)} />
              ))}
            </div>
          ))}
        {scene?.prop && (
          <div className={`hm-st-prop ${scene.prop}${propOn ? " on" : ""}`} aria-hidden="true">
            {PROPS[scene.prop]}
          </div>
        )}
        {flying && (
          <div className="hm-st-dm" aria-hidden="true">
            {flying.map((f) =>
              f.left >= 0 ? (
                <span key={f.key} className="still" style={{ top: `${f.top}%`, left: `${f.left}%` }}>
                  {f.text}
                </span>
              ) : (
                <span
                  key={f.key}
                  style={
                    {
                      top: `${f.top}%`,
                      "--w": `${f.w}px`,
                      animationDuration: `${f.dur.toFixed(2)}s`,
                      animationDelay: `${f.delay.toFixed(2)}s`,
                    } as CSSProperties
                  }
                >
                  {f.text}
                </span>
              ),
            )}
          </div>
        )}
        {mode === "choose" && scene && (
          <div className="hm-st-choices">
            {scene.answers.map((a, k) => (
              <button
                key={k}
                ref={k === 0 ? firstAnswer : undefined}
                type="button"
                className={k === was ? "was" : undefined}
                onClick={() => pick(k)}
              >
                {a.text}
                {k === was && <span className="hm-st-was">{S.was}</span>}
              </button>
            ))}
          </div>
        )}
        <button ref={box} type="button" className="hm-st-box" onClick={advance}>
          {line?.face && <span className="hm-st-name">{HAIMAO.name}</span>}
          <span className={line && !line.face ? "hm-st-text narr" : "hm-st-text"} aria-hidden="true">
            {line ? chars.slice(0, typed).join("") : view ? "" : "…"}
          </span>
          <span className="hm-st-sr" aria-live="polite">
            {line?.text ?? ""}
          </span>
          {more && (
            <span className="hm-st-more" aria-hidden="true">
              {S.more}
            </span>
          )}
        </button>
        {mode === "endCard" && (
          <div className="hm-st-end">
            <div>
              <p className="hm-st-end-t">{S.end}</p>
              <BadgeImg id={HAIMAO_BADGE} size={120} alt="" />
              <p className="hm-st-end-s">{S.badge}</p>
              {!reviewing && <p className="hm-st-end-n">{S.endNote}</p>}
            </div>
          </div>
        )}
        {listOpen && story && (
          <div className="hm-st-list">
            <div className="hm-st-list-in" role="dialog" aria-label={T.guides.haimao.review}>
              <p className="hm-st-list-t">{T.guides.haimao.review}</p>
              <p className="hm-st-list-s">{S.reviewHint}</p>
              <div className="hm-st-list-days">
                {Array.from({ length: Math.min(seen, HAIMAO_DAYS) }, (_, i) => (
                  <button key={i} ref={i === 0 ? firstDay : undefined} type="button" onClick={() => seeAgain(i + 1)}>
                    <b>{fmt(S.listDay, { n: i + 1 })}</b>
                    {storyScene(i + 1).title}
                  </button>
                ))}
                {story.end && (
                  <button type="button" onClick={() => seeAgain(0)}>
                    <b>{S.listEnd}</b>
                    {S.end}
                  </button>
                )}
              </div>
              <button type="button" className="hm-st-list-x" onClick={closeList}>
                {S.close}
              </button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
