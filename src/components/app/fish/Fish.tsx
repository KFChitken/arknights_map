"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { itemOf } from "@/lib/fish/items";
import { BANK_POLL_MS, CASTS_A_DAY, FISH_FULL, RING_MS, ZHI_EVERY_MS, type FishCatch, type FishLine, type FishShadow, type FishShout, type FishState } from "@/lib/fish/rules";
import { fishApi, FishRefused } from "@/lib/fishClient";
import { roachIconUrl, usesPicture } from "@/lib/roachImages";
import { roachDataUrl } from "@/lib/roachSvg";
import type { RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded } from "@/lib/world/types";
import CatchPage from "./CatchPage";
import FishCard, { cmText, nameOf, picOf } from "./FishCard";
import FishScene from "./FishScene";
import PondScene, { type PondFlag, type PondSeat } from "./PondScene";
import { CAST_MS, LEAP_MS, REEL_MS, type FishPhase } from "./pose";
import "./fish.css";

const FishDex = dynamic(() => import("./FishDex"), { ssr: false });

/**
 * 钓鳞, the bank (菜单 → 钓鳞): over everything on the map, the whole screen on a phone, a card in the middle on a
 * computer, the map still behind it. 甩竿 puts a line in (the server keeps the day's 100 and draws what is on it); while
 * it waits, shadows pass the float, the bigger the bigger the catch; at the server's bite 咕咚, the float dips and a yellow
 * ring closes in on it every 1.4 s; 拉杆 pulls (on time in the ring's last 0.4 s, by the server's clock), the line comes
 * in, the catch leaps out by the roach, and a strip says what it is, a page of its own for the first of one, a record
 * size, or purple and better. The page asks how the bank stands every 15 s: the others there (no names), and anything
 * purple or better caught there, said with nobody named. 吱 is the player's own roach, heard by them alone.
 */

type Look = { color: string; avatar: string; style?: RoachStyle };

/**
 * 卫戍池塘's page (SquadPond.tsx): the room round the pond, its header, and in the panel this 局's 鳞 and how far to
 * 爆护; the bank's page has none
 */
export type PondView = {
  seats: PondSeat[];
  flags: PondFlag[];
  fire: boolean;
  school: boolean;
  place: string;
  /** Over the water: who fishes, a 鱼群 */
  badge: string;
  schoolBadge: string | null;
  round: string;
  toProtect: string;
  /** Said at the bite, even with the page out of sight (the browser may not let it) */
  onBite: () => void;
  /** What the room is saying now (a teammate's purple catch, someone in or out) */
  toast: string | null;
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
  onClose,
  onRefused,
}: {
  look: Look;
  /** 卫戍池塘 rather than the bank */
  pond?: PondView;
  onClose: () => void;
  onRefused: (e: unknown) => void;
}) {
  const spot = pond ? "pond" : "pier";
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
  // the server's clock against this one's, from each answer
  const offset = useRef(0);
  const zhiAt = useRef(0);
  const queue = useRef<FishShout[]>([]);
  const lastShout = useRef<number | undefined>(undefined);
  const serverNow = () => Date.now() + offset.current;
  // 卫戍池塘's sound at the bite, as the page has it now
  const biteSound = useRef(pond?.onBite);
  biteSound.current = pond?.onBite;

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

  // every 15 s while open: the others on the bank, and anything purple or better said there
  useEffect(() => {
    if (!st) return;
    const t = window.setInterval(() => {
      if (document.hidden) return;
      void timed(() => fishApi.state(lastShout.current))
        .then((s) => take(s, false))
        .catch(() => {});
    }, BANK_POLL_MS);
    return () => window.clearInterval(t);
  }, [st, take, timed]);

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
        // 卫戍池塘: 咕咚 out loud, the player likely in the game
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
      setCaught(res.caught);
      setLine(null);
      setSt((s) => (s ? { ...s, line: null, admiral: res.admiral, owned: s.owned + (res.caught.first ? 1 : 0) } : s));
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
  const label = st?.admiral ? `${T.fish.you} · ${T.fish.admiral}` : T.fish.you;

  return (
    <div className="fish fish-root" role="dialog" aria-label={T.fish.title}>
      <div className="fish-box">
        <div className="fish-view">
          {pond ? (
            <PondScene
              phase={phase}
              ms={ms}
              shadow={shadow}
              ringDelay={ringDelay}
              catchPic={catchItem ? picOf(catchItem.key) : null}
              roach={roach}
              label={label}
              zhi={zhi}
              seats={pond.seats}
              flags={pond.flags}
              fire={pond.fire}
              school={pond.school}
            />
          ) : (
            <FishScene
              phase={phase}
              ms={ms}
              shadow={shadow}
              ringDelay={ringDelay}
              catchPic={catchItem ? picOf(catchItem.key) : null}
              roach={roach}
              label={label}
              zhi={zhi}
            />
          )}
          <header className="fish-head">
            <button type="button" className="back" onClick={onClose} aria-label={T.fish.back}>
              ‹
            </button>
            <span className="tt">
              <b>{pond ? T.fish.pond.title : T.fish.title}</b>
              <small>{pond ? pond.place : T.fish.place}</small>
            </span>
            {pond ? (
              <span className="bank">{pond.badge}</span>
            ) : (
              st && <span className="bank">{st.bank > 0 ? fmt(T.fish.bank, { n: st.bank }) : T.fish.bankNone}</span>
            )}
          </header>
          {pond?.schoolBadge && <span className="fish-school">{pond.schoolBadge}</span>}
          {pond?.toast && (
            <p key={pond.toast} className="fish-toast" role="status">
              {pond.toast}
            </p>
          )}
          {shout && (
            <p className="fish-shout" role="status">
              {fmt(T.fish.shout, { name: nameOf(shout.no, shout.variant), size: shout.cm === null ? "" : fmt(T.fish.sized, { cm: cmText(shout.cm) }) })}
            </p>
          )}
          {phase === "caught" && caught && catchItem && (
            <div className="fish-strip" role="status">
              <FishCard no={caught.no} variant={caught.variant} size={54} />
              <span className="tx">
                <b>{nameOf(caught.no, caught.variant)}</b>
                <small>
                  {caught.cm !== null && `${fmt(T.fish.cm, { cm: cmText(caught.cm) })} · `}
                  {caught.first ? T.fish.firstTime : fmt(T.fish.nth, { n: caught.n })}
                </small>
                <small className={caught.onTime ? "on" : "off"}>{caught.onTime ? T.fish.onTime : T.fish.offTime}</small>
              </span>
            </div>
          )}
          {!st && (
            <div className="fish-wait">
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
        </div>
        <div className="fish-panel">
          <div className="row1">
            {st && (
              <>
                <span>{fmt(T.fish.casts, { n: st.casts, max: CASTS_A_DAY })}</span>
                <span aria-hidden="true">·</span>
                <span>{pond ? pond.round : fmt(T.fish.dexCount, { n: st.owned, max: st.cells })}</span>
              </>
            )}
            <b className="st">{status}</b>
          </div>
          <button type="button" className={`fish-go ${button.kind}`} disabled={!st || !button.go || busy} onClick={() => void button.go?.()}>
            {button.text}
          </button>
          <div className="row2">
            <button type="button" onClick={sayZhi}>
              {T.fish.zhi}
            </button>
            {pond && <span className="mid">{pond.toProtect}</span>}
            <button type="button" onClick={() => setDex(true)} disabled={!st}>
              {T.fish.dex}
            </button>
          </div>
        </div>
        {full && caught && <CatchPage caught={caught} onClose={() => setFull(false)} />}
        {dex && st && <FishDex owned={st.owned} cells={st.cells} casts={st.casts} onClose={() => setDex(false)} onRefused={refused} />}
      </div>
    </div>
  );
}
