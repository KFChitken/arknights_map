"use client";

import { useEffect, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { characterName } from "@/i18n/names";
import { BOTTLES_A_DAY, SAY_GROUPS, type FishBottle } from "@/lib/fish/rules";
import { fishApi, FishRefused } from "@/lib/fishClient";
import { passChar } from "@/lib/passCatalog";
import { padNo, type Drawn, type Tier } from "@/lib/passes";
import { useOperatorArt } from "../OperatorNames";
import { CardBack, FullPass, MiniPass, PassArtProvider, usePassArt } from "../passes/PassCard";
import FishCard from "./FishCard";
import "../passes/passes.css";

/**
 * 漂流瓶 (fish ③), over the fishing page: the red disc shaking in its glow, 拔开瓶塞 (the server draws the pass in it
 * now, and tucks in a 纸条 if the sea has one); the paper unrolls to the pass face down, turned over with a tap as 寻访
 * turns its cards (a wish held up on its rainbow as there), then the pass beside its name and number, the 纸条 under it
 * (no name, only how far), 收进我的通行证, and 写一句扔回去: five groups of the 17 lines, one picked, 扔回海里, once a
 * bottle. Its pass may be held up whole with a tap.
 */

const TAG_CLASS: Record<Tier, string> = { wish: "w", new: "n", up: "u", dup: "d" };
/** The turn's 0.45 s (passes.css .cardx .fl), and a moment after it */
const TURN_MS = 520;

const stillMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The lines of each group, by number (from 1) */
const groupsOf = () => {
  let at = 1;
  return SAY_GROUPS.map((n) => Array.from({ length: n }, () => at++));
};
const sayOf = (n: number) => T.fish.bottle.says[n - 1] ?? "";

function fromLine(km: number | null) {
  const t = T.fish.bottle;
  return km === null ? t.fromFar : km === 0 ? t.fromNear : fmt(t.fromKm, { km });
}

/** A pass that turns over, as 寻访's do (passes.css .cardx) */
function Card({ d, open, w, label, onPress }: { d: Drawn; open: boolean; w: number; label: string; onPress: () => void }) {
  const art = useOperatorArt();
  const c = passChar(d.charId);
  if (!c) return null;
  return (
    <div
      className={`cardx t-${d.tier}${open ? " open" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      style={{ width: w }}
      onClick={onPress}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPress();
        }
      }}
    >
      <i className="glow" />
      <div className="fl">
        <div className="bk">
          <CardBack />
        </div>
        <div className="fr">
          <MiniPass c={c} no={d.no} fancy={d.fancy} art={art} />
          <span className={`ttag ${TAG_CLASS[d.tier]}`}>{T.passes.term.tag[d.tier]}</span>
        </div>
      </div>
    </div>
  );
}

/** The pass held up whole, as 寻访 holds one: a wish on its rainbow */
function HeldUp({ d, at, holder, onClose }: { d: Drawn; at: number; holder: string; onClose: () => void }) {
  const art = useOperatorArt();
  const [on, setOn] = useState(false);
  const self = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOn(true));
    self.current?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(raf);
  }, []);
  const c = passChar(d.charId);
  if (!c) return null;
  const t = T.passes.term;
  const wish = d.tier === "wish";
  return (
    <div
      ref={self}
      className={`t-hl${wish ? "" : " calm"}${on ? " on" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={t.closeDone}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <FullPass c={c} no={d.no} fancy={d.fancy} art={art} holder={holder} at={at} w={c.game === "ef" ? 196 : 164} />
      <p>
        <b>{wish ? (d.up ? t.wishHitUp : t.wishHit) : t.tier[d.tier]}</b>
        {characterName(c.name)} No.{padNo(d.no)}
      </p>
      <p className="sm">{T.fish.bottle.putDown}</p>
    </div>
  );
}

export default function Bottle({
  id,
  today,
  holder,
  onClose,
  onRefused,
}: {
  id: number;
  /** Bottles caught today, till the bottle's own answer says */
  today: number;
  /** The name printed on the player's passes */
  holder: string;
  onClose: () => void;
  onRefused: (e: unknown) => void;
}) {
  const passArt = usePassArt();
  const t = T.fish.bottle;
  const [b, setB] = useState<FishBottle | null>(null);
  const [step, setStep] = useState<"closed" | "card" | "pass">("closed");
  const [turned, setTurned] = useState(false);
  const [held, setHeld] = useState(false);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [write, setWrite] = useState(false);
  const [group, setGroup] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const said = (e: unknown) => {
    if (e instanceof FishRefused) setMsg(e.message);
    else onRefused(e);
  };

  const uncork = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fishApi.open(id);
      setB(res);
      setAt(Date.now());
      setStep(stillMotion() ? "pass" : "card");
      if (stillMotion()) setTurned(true);
    } catch (e) {
      said(e);
    } finally {
      setBusy(false);
    }
  };

  const turn = () => {
    if (!b || turned) return;
    setTurned(true);
    timer.current = window.setTimeout(() => {
      setStep("pass");
      // a wish is held up as it turns, as on 寻访
      if (b.pass.tier === "wish") setHeld(true);
    }, TURN_MS);
  };

  const send = async () => {
    if (!b || pick === null || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      setB(await fishApi.throwBack(b.id, pick));
      setWrite(false);
      setPick(null);
    } catch (e) {
      said(e);
    } finally {
      setBusy(false);
    }
  };

  const c = b ? passChar(b.pass.charId) : null;
  const name = c ? characterName(c.name) : "";
  const groups = groupsOf();
  return (
    <PassArtProvider value={passArt}>
      <div className="fish-bottle" role="dialog" aria-label={t.title}>
        <div className="fb-sheet">
          <i className="hazard" aria-hidden="true" />
          <div className="hd">
            <i className="sq" aria-hidden="true" />
            <b>{t.title}</b>
            <span className="en">{t.titleEn}</span>
            <span className="ct">{fmt(t.today, { n: b?.today ?? today, max: BOTTLES_A_DAY })}</span>
            <button type="button" className="x" onClick={onClose} aria-label={t.close}>
              ×
            </button>
          </div>

          {step === "closed" && (
            <div className="closed">
              <i className="glow" aria-hidden="true" />
              <span className="jar">
                <i className="ring" aria-hidden="true" />
                <FishCard no={30} size={150} />
              </span>
              <b className="tl">{t.closedTitle}</b>
              <span className="sub">
                {fmt(t.closedLine, { n: BOTTLES_A_DAY })}
                <br />
                {t.closedLine2}
              </span>
              <button type="button" className="go" onClick={() => void uncork()} disabled={busy}>
                {busy ? t.uncorking : t.uncork}
              </button>
            </div>
          )}

          {step === "card" && b && (
            <div className="fb-card">
              <span className="unroll">
                <Card d={b.pass} open={turned} w={150} label={turned ? name : t.turnLabel} onPress={turn} />
              </span>
              <b className="tl">{t.unrolled}</b>
              <span className="sub">{t.turn}</span>
            </div>
          )}

          {step === "pass" && b && c && (
            <div className="pass">
              <div className="top">
                <Card d={b.pass} open w={120} label={t.holdLabel} onPress={() => setHeld(true)} />
                <span className="fb-who">
                  <em className="from">{t.fromBottle}</em>
                  <b>{name}</b>
                  <span className="no">{fmt(t.passLine, { no: padNo(b.pass.no) })}</span>
                  <span className="pool">{t.samePool}</span>
                </span>
              </div>
              {b.note && (
                <div className="note">
                  <span className="nh">{t.noteHead}</span>
                  <p>{fmt(t.quote, { say: sayOf(b.note.say) })}</p>
                  <span className="by">
                    <span>{fromLine(b.note.km)}</span>
                    <span className="anon">{t.anon}</span>
                  </span>
                </div>
              )}
              {write ? (
                <div className="write">
                  <span className="fb-hint">{t.writeHint}</span>
                  <span className="groups" role="tablist">
                    {t.groups.map((g, i) => (
                      <button key={g} type="button" role="tab" aria-selected={i === group} className={i === group ? "on" : ""} onClick={() => setGroup(i)}>
                        {g}
                      </button>
                    ))}
                  </span>
                  <span className="fb-says">
                    {groups[group].map((n) => (
                      <button key={n} type="button" aria-pressed={pick === n} className={pick === n ? "on" : ""} onClick={() => setPick(n)}>
                        {sayOf(n)}
                      </button>
                    ))}
                  </span>
                  <span className="btns">
                    <button type="button" className={`send${pick !== null ? " on" : ""}`} disabled={pick === null || busy} onClick={() => void send()}>
                      {pick !== null ? t.send : t.pickFirst}
                    </button>
                    <button
                      type="button"
                      className="cancel"
                      onClick={() => {
                        setWrite(false);
                        setPick(null);
                      }}
                    >
                      {t.cancel}
                    </button>
                  </span>
                </div>
              ) : (
                <>
                  <span className="acts">
                    <button type="button" className="keep" onClick={onClose}>
                      {t.keep}
                    </button>
                    <button type="button" className="wr" disabled={b.thrown !== null} onClick={() => setWrite(true)}>
                      {b.thrown !== null ? t.thrown : t.write}
                    </button>
                  </span>
                  {b.thrown !== null && <span className="sent">{fmt(t.sent, { say: sayOf(b.thrown) })}</span>}
                </>
              )}
            </div>
          )}
          {msg && (
            <p className="fb-msg" role="status">
              {msg}
            </p>
          )}
        </div>
        {held && b && <HeldUp d={b.pass} at={at} holder={holder} onClose={() => setHeld(false)} />}
      </div>
    </PassArtProvider>
  );
}
