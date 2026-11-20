"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { itemOf, type FishSpot } from "@/lib/fish/items";
import {
  BANK_POLL_MS,
  CASTS_A_DAY,
  FISH_FULL,
  NET_MAX,
  netHeld,
  RING_MS,
  ZHI_EVERY_MS,
  type FishCatch,
  type FishHaul,
  type FishLine,
  type FishShadow,
  type FishShout,
  type FishState,
} from "@/lib/fish/rules";
import { fishApi, FishRefused } from "@/lib/fishClient";
import { TICKETS_CAP } from "@/lib/passes";
import { roachIconUrl, usesPicture } from "@/lib/roachImages";
import { roachDataUrl } from "@/lib/roachSvg";
import type { RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded } from "@/lib/world/types";
import CatchPage from "./CatchPage";
import FishCard, { nameOf, picOf, weightAfterName, weightText } from "./FishCard";
import NetPage from "./NetPage";
import { CAST_MS, LEAP_MS, REEL_MS, type FishPhase } from "./pose";
import WinScene, { type PondFlag, type PondSeat } from "./WinScene";
import "./fish.css";

const FishDex = dynamic(() => import("./FishDex"), { ssr: false });
const Bottle = dynamic(() => import("./Bottle"), { ssr: false });

/**
 * 钓鳞, inside its small window (FishWin.tsx), over the map and never in its way: the bank, or 卫戍池塘 (pond) while
 * one is in a room of 一起卫戍, as the window says; open (the scene, and under it the buttons), or small (a strip, a
 * ball). 甩竿 puts a line in (the server keeps the day's 100 and draws what is on it); while
 * it waits, shadows pass the float, the bigger the bigger the catch; at the server's bite 咕咚, the float dips and a yellow
 * ring closes in on it every 1.4 s; 拉杆 pulls (on time in the ring's last 0.4 s, by the server's clock), the line comes
 * in, the catch leaps out by the roach, and a strip says what it is, a page of its own for the first of one, a record
 * size, or purple and better. While the window is open it asks how the bank stands every 15 s (and once as it opens
 * again): the others there (no names), and anything purple or better caught there, said with nobody named. 吱 is the player's own roach, heard by them alone. A 寻访券
 * goes into the wallet (the map's 寻访 button told); a 漂流瓶 opens on a page of its own (Bottle.tsx) once its catch is
 * put down, or later from 有 n 个漂流瓶没打开. 自动钓 (the bank's alone, 自动) counts a cast every 3 min while it is on,
 * the page open or not; the line over the buttons says how many it holds, and 收网 pulls them in (NetPage.tsx). The
 * catch's strip, its 获得物资 and 收网's page come up over the scene; the dex and a 漂流瓶 take the whole screen.
 */

type Look = { color: string; avatar: string; style?: RoachStyle };

/**
 * 卫戍池塘 as the room has it (SquadPond.tsx usePondView): the room round the pond, the window's title's line (who
 * fishes), and over the buttons this 局's 鳞 and how far to 爆护; the bank has none
 */
export type PondView = {
  seats: PondSeat[];
  flags: PondFlag[];
  fire: boolean;
  school: boolean;
  /** Who fishes, for the title bar's small line */
  fishing: string;
  /** A 鱼群 on, and its time left */
  schoolBadge: string | null;
  /** This 局's 鳞, and how far to 爆护 */
  tally: string;
  /** What the room is saying now (a teammate's purple catch, someone in or out) */
  toast: string | null;
  /** The room's 篝火 by the pond, its level now */
  camp: number;
};
type Said = FishState & { lastShout: number };

/** The player's roach as a picture, as RoachIcon draws it */
function useRoachPic(look: Look) {
  const opts = { avatar: look.avatar as RoachAvatar, style: look.style };
  const key = JSON.stringify([look.color, opts]);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!usesPicture(opts)) {
      setSrc(roachDataUrl(look.color as RoachColor, opts));
      return;
    }
    let live = true;
    void roachIconUrl(look.color as RoachColor, opts, 144).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return src;
}

export default function Fish({
  look,
  pond,
  holder,
  view,
  awake,
  phone,
  pending,
  notice,
  onRefused,
  onPasses,
  onLine,
  onBite,
  onExpand,
  tapRef,
}: {
  look: Look;
  /** 卫戍池塘 rather than the bank */
  pond?: PondView;
  /** The name printed on the player's passes (a 漂流瓶's) */
  holder: string;
  /** The window open (the scene and its buttons), or small (a strip on a computer, a ball on a phone) */
  view: "open" | "small";
  /** The window open: the bank asked how it stands now and then (not while small or hidden) */
  awake: boolean;
  phone: boolean;
  /** The scene the window goes to once this line is done (a room joined or left meanwhile) */
  pending: FishSpot | null;
  /** The window's own word over the scene a moment (a scene changed) */
  notice: string | null;
  onRefused: (e: unknown) => void;
  /** A 寻访券 went into the wallet: the tickets now, and the dot of the map's 寻访 button */
  onPasses?: (p: { tickets: number; dot: boolean }) => void;
  /** How the line stands: where it is (null: none, its catch put down), whether it has bitten; the day's casts */
  onLine: (spot: FishSpot | null, bite: boolean, casts: number | null) => void;
  /** 咕咚 out loud, as the window would have it */
  onBite: () => void;
  /** The strip or ball tapped: the window open again */
  onExpand: () => void;
  /** What a tap on the ball does (the window tells it from a drag) */
  tapRef: { current: (() => void) | null };
}) {
  const spot: FishSpot = pond ? "pond" : "pier";
  const roach = useRoachPic(look);
  const [st, setSt] = useState<Said | null>(null);
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState<FishPhase>("idle");
  const [ms, setMs] = useState(0);
  const [line, setLine] = useState<FishLine | null>(null);
  const [caught, setCaught] = useState<FishCatch | null>(null);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [shadow, setShadow] = useState<FishShadow | null>(null);
  const [zhi, setZhi] = useState(false);
  const [shout, setShout] = useState<FishShout | null>(null);
  const [dex, setDex] = useState(false);
  // a 漂流瓶 open on its page, by id
  const [bottle, setBottle] = useState<number | null>(null);
  // 收网's page
  const [haul, setHaul] = useState<FishHaul | null>(null);
  // the one just caught, opened once its catch is put down
  const bottleNext = useRef<number | null>(null);
  // the server's clock against this one's, from each answer
  const offset = useRef(0);
  const zhiAt = useRef(0);
  const queue = useRef<FishShout[]>([]);
  const lastShout = useRef<number | undefined>(undefined);
  const serverNow = () => Date.now() + offset.current;
  // 咕咚's sound at the bite, as the window has it now
  const biteSound = useRef(onBite);
  biteSound.current = onBite;
  // the window's own word, and 自动钓's: over the scene a moment
  const [said, setSaid] = useState<string | null>(null);
  const sayWin = (text: string) => {
    setSaid(text);
    window.setTimeout(() => setSaid((x) => (x === text ? null : x)), 2_600);
  };

  /** An answer's time taken as the server's now at the middle of the ask */
  const timed = useCallback(async <R extends { now: number }>(ask: () => Promise<R>): Promise<R> => {
    const t0 = Date.now();
    const res = await ask();
    offset.current = res.now - (t0 + Date.now()) / 2;
    return res;
  }, []);

  const refused = useCallback(
    (e: unknown) => {
      if (e instanceof FishRefused) setNote(e.message);
      else onRefused(e);
    },
    [onRefused],
  );

  /** How the bank stands, kept but for the step the player is in the middle of */
  const take = useCallback((s: Said, first: boolean) => {
    setSt(s);
    lastShout.current = s.lastShout;
    if (s.shouts.length) queue.current.push(...s.shouts);
    if (first || !s.line) {
      setLine(s.line);
      setPhase((ph) => {
        if (s.line) return s.now >= s.line.biteAt ? "bite" : "wait";
        // the line went (pulled in another tab): back to holding the float
        return ph === "wait" || ph === "bite" ? "idle" : ph;
      });
    }
  }, []);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      take(await timed(() => fishApi.state()), true);
    } catch (e) {
      // signing in, the age question or the privacy policy: the map's own; anything else, try again here
      if (e instanceof SignInNeeded || e instanceof AgeCheckNeeded || e instanceof ConsentNeeded) onRefused(e);
      else setFailed(true);
    }
  }, [onRefused, take, timed]);

  useEffect(() => {
    void load();
  }, [load]);

  // every 15 s while the window is open, and once as it opens again: the others on the bank, and anything purple or
  // better said there
  const loaded = st !== null;
  const slept = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    if (!awake) {
      slept.current = true;
      return;
    }
    const ask = () =>
      void timed(() => fishApi.state(lastShout.current))
        .then((s) => take(s, false))
        .catch(() => {});
    if (slept.current) {
      slept.current = false;
      ask();
    }
    const t = window.setInterval(() => {
      if (!document.hidden) ask();
    }, BANK_POLL_MS);
    return () => window.clearInterval(t);
  }, [loaded, awake, take, timed]);

  // what was said on the bank, one at a time, 5 s each
  useEffect(() => {
    if (shout) {
      const t = window.setTimeout(() => setShout(null), 5_000);
      return () => window.clearTimeout(t);
    }
    const t = window.setInterval(() => {
      const next = queue.current.shift();
      if (next) setShout(next);
    }, 1_000);
    return () => window.clearInterval(t);
  }, [shout]);

  // the steps that move (the cast, the reel, the leap): a frame at a time, then the next
  useEffect(() => {
    if (phase !== "cast" && phase !== "reel" && phase !== "leap") return;
    const dur = phase === "cast" ? CAST_MS : phase === "reel" ? REEL_MS : LEAP_MS;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(dur, now - start);
      setMs(t);
      if (t < dur) raf = requestAnimationFrame(step);
      else if (phase === "cast") setPhase(line && serverNow() >= line.biteAt ? "bite" : "wait");
      else if (phase === "reel") setPhase("leap");
      else setPhase("caught");
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // waiting: the bite when the server said, and now and then a shadow by the float
  useEffect(() => {
    if (phase !== "wait" || !line) return;
    const bite = window.setTimeout(
      () => {
        setPhase("bite");
        // 咕咚 out loud, the player likely in the game or the window put away
        biteSound.current?.();
      },
      Math.max(0, line.biteAt - serverNow()),
    );
    let shade = 0;
    const pass = () => {
      shade = window.setTimeout(
        () => {
          setShadow(line.shadow);
          shade = window.setTimeout(() => {
            setShadow(null);
            pass();
          }, 1_600);
        },
        5_000 + Math.random() * 8_000,
      );
    };
    pass();
    return () => {
      window.clearTimeout(bite);
      window.clearTimeout(shade);
      setShadow(null);
    };
  }, [phase, line]);

  const cast = async () => {
    if (busy || !st) return;
    setBusy(true);
    setNote(null);
    setCaught(null);
    setFull(false);
    try {
      const res = await timed(() => fishApi.cast(spot));
      setLine(res.line);
      setSt((s) => (s ? { ...s, casts: res.casts, line: res.line } : s));
      setMs(0);
      setPhase("cast");
    } catch (e) {
      if (e instanceof FishRefused && e.code === FISH_FULL) setSt((s) => (s ? { ...s, casts: CASTS_A_DAY } : s));
      refused(e);
    } finally {
      setBusy(false);
    }
  };

  const pullBack = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await timed(() => fishApi.pull());
      setLine(null);
      setPhase("idle");
    } catch (e) {
      refused(e);
    } finally {
      setBusy(false);
    }
  };

  const reel = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await timed(() => fishApi.reel());
      const got = res.caught;
      setCaught(got);
      setLine(null);
      setSt((s) =>
        s
          ? {
              ...s,
              line: null,
              admiral: res.admiral,
              owned: s.owned + (got.first ? 1 : 0),
              ...(got.bottle === undefined ? {} : { bottles: [...s.bottles, got.bottle], bottlesToday: s.bottlesToday + 1 }),
            }
          : s,
      );
      if (got.wallet !== undefined) onPasses?.({ tickets: got.wallet, dot: res.passesDot ?? true });
      bottleNext.current = got.bottle ?? null;
      setMs(0);
      setPhase("reel");
    } catch (e) {
      refused(e);
      void load();
    } finally {
      setBusy(false);
    }
  };

  // the page of its own: the first of one, a record size, purple or better
  useEffect(() => {
    if (phase === "caught" && caught && (caught.first || caught.record || caught.tier >= 4)) setFull(true);
  }, [phase, caught]);

  /** The catch's page put down: a 漂流瓶 just caught opens on its own */
  const putDown = () => {
    setFull(false);
    if (bottleNext.current !== null) setBottle(bottleNext.current);
    bottleNext.current = null;
  };
  /** The 漂流瓶's page closed: the bottles not opened yet, as they are now */
  const bottleDone = () => {
    setBottle(null);
    void timed(() => fishApi.state(lastShout.current))
      .then((s) => take(s, false))
      .catch(() => {});
  };

  /** 自动 (the bank's alone): switched on, or off (what it holds pulled in first); 收网: what it holds, it staying on */
  const net = async (what: "on" | "off" | "haul") => {
    if (busy || !st) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await timed(() => (what === "haul" ? fishApi.haul() : fishApi.net(what === "on")));
      const fresh = res.haul?.items.filter((i) => i.first).length ?? 0;
      setSt((s) => (s ? { ...s, net: res.net, casts: res.casts, owned: s.owned + fresh } : s));
      if (res.haul && res.haul.casts > 0) {
        setHaul(res.haul);
        sayWin(fmt(T.fish.win.hauled, { n: res.haul.casts }));
      } else if (what === "haul") setNote(T.fish.net.empty);
      if (what === "on") sayWin(T.fish.win.autoStarted);
      if (what === "off" && !(res.haul && res.haul.casts > 0)) sayWin(T.fish.win.autoStopped);
    } catch (e) {
      refused(e);
    } finally {
      setBusy(false);
    }
  };

  // how the line stands, for the window: in the water (or still coming in), bitten; none once its catch is out
  const lineSpot = line ? line.spot : phase === "cast" || phase === "reel" || phase === "leap" ? spot : null;
  const lineRef = useRef(onLine);
  lineRef.current = onLine;
  const casts = st?.casts ?? null;
  useEffect(() => {
    lineRef.current(lineSpot, phase === "bite", casts);
  }, [lineSpot, phase, casts]);

  // a tap on the strip or the ball: the window open again, and at the bite, the pull
  const tap = () => {
    if (phase === "bite") void reel();
    onExpand();
  };
  tapRef.current = tap;

  const sayZhi = () => {
    const now = Date.now();
    if (now - zhiAt.current < ZHI_EVERY_MS) return;
    zhiAt.current = now;
    setZhi(true);
    window.setTimeout(() => setZhi(false), 1_200);
  };

  // the ring's place in its 1.4 s as the bite shows, kept while it does (a delay changed later would move it)
  const ringDelay = useMemo(
    () => (phase === "bite" && line ? -((((Date.now() + offset.current - line.biteAt) % RING_MS) + RING_MS) % RING_MS) : 0),
    [phase, line],
  );
  const left = st ? CASTS_A_DAY - st.casts : 0;
  const button =
    phase === "cast"
      ? { text: T.fish.buttons.casting, go: null, kind: "off" }
      : phase === "wait"
        ? { text: T.fish.buttons.wait, go: pullBack, kind: "soft" }
        : phase === "bite"
          ? { text: T.fish.buttons.bite, go: reel, kind: "bite" }
          : phase === "reel" || phase === "leap"
            ? { text: T.fish.buttons.reel, go: null, kind: "off" }
            : left <= 0
              ? { text: T.fish.buttons.full, go: null, kind: "off" }
              : { text: phase === "caught" ? T.fish.buttons.again : T.fish.buttons.cast, go: cast, kind: "go" };
  const status =
    note ??
    (phase === "wait" && shadow
      ? T.fish.status.shadows[shadow]
      : phase === "idle" && left <= 0
        ? fmt(T.fish.status.full, { n: CASTS_A_DAY })
        : T.fish.status[phase === "idle" ? "idle" : phase]);
  const catchItem = caught ? itemOf(caught.no) : null;
  const caughtWeight = caught ? weightText(caught.no, caught.cm) : null;
  const label = st?.admiral ? `${T.fish.you} · ${T.fish.admiral}` : T.fish.you;
  // 自动钓, the bank's: what it holds now, by the server's clock
  const held = st && st.net !== null ? netHeld(st.net, serverNow(), st.casts) : 0;
  const w = T.fish.win;
  const statusNow = pending && (phase === "wait" || phase === "bite") ? (pending === "pond" ? w.statusToPond : w.statusToPier) : phase === "wait" && !note && !shadow ? w.wait : status;
  // over the scene, one at a time: the window's word or 自动钓's, else the room's (卫戍池塘)
  const word = notice ?? said ?? pond?.toast ?? null;
  // the scene's top in use (the yellow bar, a word, a catch's strip): 有 n 个漂流瓶没打开 waits
  const topTaken = Boolean((pending && (lineSpot || phase === "cast")) || word || (phase === "caught" && caught && !full));

  if (view === "small") {
    const text =
      phase === "bite"
        ? phone
          ? w.ballBite
          : w.stripBite
        : lineSpot
          ? lineSpot === "pond"
            ? w.stripPond
            : w.stripPier
          : phase === "caught" && caught
            ? fmt(w.stripGot, { name: nameOf(caught.no, caught.variant) })
            : w.stripHand;
    if (phone) {
      // the ball: the float, ringed while it waits; the window tells a tap from a drag (tapRef)
      return (
        <span className={`fw-ball-in${phase === "bite" ? " bite" : phase === "wait" ? " wait" : ""}`} aria-label={phase === "bite" ? text : w.ballLabel} role="img">
          {phase === "wait" && <i className="ring" aria-hidden="true" />}
          <svg viewBox="0 0 24 32" width="22" height="30" aria-hidden="true">
            <path d="M12 2 L12 9" stroke="currentColor" strokeWidth="1.6" />
            <path d="M5 18 A7 9 0 0 1 19 18 Z" fill="#ff4a2e" />
            <path d="M5 18 A7 9 0 0 0 19 18 Z" fill="#ffffff" />
          </svg>
          {phase === "bite" && <b className="say">{text}</b>}
        </span>
      );
    }
    return (
      <button type="button" className="fw-strip-in" title={w.big} onClick={tap}>
        <b>{text}</b>
        <span className="big" aria-hidden="true">
          ▢
        </span>
      </button>
    );
  }

  const rowLeft =
    !pond && st && st.net !== null ? (
      <span className="auto">
        {held > 0 ? fmt(w.autoHeld, { n: held }) : w.autoIdle}
        {held > 0 && (
          <button type="button" className="haul" disabled={busy} onClick={() => void net("haul")}>
            {w.haul}
          </button>
        )}
      </span>
    ) : phone ? (
      st && <span>{fmt(T.fish.casts, { n: st.casts, max: CASTS_A_DAY })}</span>
    ) : (
      st && (
        <span>
          {fmt(w.left, { n: left })}
          {(!pond || pond.tally) && (
            <>
              <i aria-hidden="true">·</i>
              {pond ? pond.tally : st.bank > 0 ? fmt(w.bank, { n: st.bank }) : T.fish.bankNone}
            </>
          )}
        </span>
      )
    );

  return (
    <>
      <div className="fw-view">
        <div className="fw-stage">
          <WinScene
            pond={Boolean(pond)}
            phase={phase}
            ms={ms}
            shadow={shadow}
            ringDelay={ringDelay}
            catchPic={catchItem ? picOf(catchItem.key) : null}
            roach={roach}
            label={label}
            zhi={zhi}
            seats={pond?.seats}
            flags={pond?.flags}
            fire={pond?.fire}
            school={pond?.school}
            camp={pond?.camp}
          />
          {pending && (lineSpot || phase === "cast") && <p className="fw-pend">{pending === "pond" ? w.toPond : w.toPier}</p>}
          {!pending && word && (
            <p key={word} className="fw-word" role="status">
              {word}
            </p>
          )}
          {pond?.schoolBadge && <span className="fw-school">{pond.schoolBadge}</span>}
          {shout && (
            <p className="fw-shout" role="status">
              {fmt(T.fish.shout, { name: nameOf(shout.no, shout.variant), size: weightAfterName(shout.no, shout.cm) })}
            </p>
          )}
          {phase === "caught" && caught && catchItem && !full && (
            <div className="fish-strip fw-strip" role="status">
              <FishCard no={caught.no} variant={caught.variant} size={44} />
              <span className="tx">
                <b>{nameOf(caught.no, caught.variant)}</b>
                <small>
                  {caughtWeight && `${fmt(T.fish.weight, { w: caughtWeight })} · `}
                  {caught.first ? T.fish.firstTime : fmt(T.fish.nth, { n: caught.n })}
                </small>
                {caught.wallet !== undefined ? (
                  <small className="on">{fmt(T.fish.ticketIn, { n: caught.wallet, cap: TICKETS_CAP })}</small>
                ) : (
                  <small className={caught.onTime ? "on" : "off"}>{caught.onTime ? T.fish.onTime : T.fish.offTime}</small>
                )}
              </span>
            </div>
          )}
          {st && st.bottles.length > 0 && bottle === null && !topTaken && (
            <button type="button" className="fish-bottles fw-bottles" onClick={() => setBottle(st.bottles[0])}>
              <FishCard no={30} size={20} />
              {fmt(T.fish.bottle.waiting, { n: st.bottles.length })}
            </button>
          )}
          {!st && (
            <div className="fish-wait fw-wait">
              {failed ? (
                <>
                  <p>{T.fish.failed}</p>
                  <button type="button" onClick={() => void load()}>
                    {T.fish.retry}
                  </button>
                </>
              ) : (
                <p>{T.fish.loading}</p>
              )}
            </div>
          )}
          {full && caught && <CatchPage caught={caught} onClose={putDown} />}
          {haul && <NetPage haul={haul} onClose={() => setHaul(null)} />}
        </div>
      </div>
      <div className="fw-panel">
        <div className="row1">
          {rowLeft}
          <b className="st">{statusNow}</b>
        </div>
        <div className="row2">
          <button type="button" className={`go ${button.kind}`} disabled={!st || !button.go || busy} onClick={() => void button.go?.()}>
            {button.text}
          </button>
          <button type="button" className="sm" onClick={sayZhi}>
            {T.fish.zhi}
          </button>
          {!pond && (
            <button
              type="button"
              className={`sm${st?.net != null ? " on" : ""}`}
              disabled={!st || busy}
              aria-label={fmt(w.autoLabel, { max: NET_MAX })}
              aria-pressed={st?.net != null}
              onClick={() => void net(st?.net != null ? "off" : "on")}
            >
              {st?.net != null ? w.autoOn : w.auto}
            </button>
          )}
          <button type="button" className="sm" onClick={() => setDex(true)} disabled={!st}>
            {T.fish.dex}
          </button>
        </div>
      </div>
      {dex && st && <FishDex owned={st.owned} cells={st.cells} casts={st.casts} game={st.game} onClose={() => setDex(false)} onRefused={refused} />}
      {bottle !== null && <Bottle id={bottle} today={st?.bottlesToday ?? 0} holder={holder} onClose={bottleDone} onRefused={onRefused} />}
    </>
  );
}
