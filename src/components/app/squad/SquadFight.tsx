"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import { serverName } from "@/lib/games";
import { SQUAD_MAX, type SquadMember, type SquadRoom } from "@/lib/squad";
import { ShieldIcon } from "../chrome/parts";
import { useOperatorArt } from "../OperatorNames";
import { useAbove } from "./SquadBar";
import SquadMateCard from "./SquadMateCard";
import { CoreBadge, extraNames, StrategyFace } from "./SquadPicks";
import { Bubble, liftsOf, SquadRoach } from "./SquadRoach";
import {
  closeSquadTalk,
  kickFromSquad,
  lineWords,
  openSquadTalk,
  squadBot,
  setSquadSceneOn,
  useSquadLines,
  useSquadMoves,
  useSquadRoom,
  useSquadSceneOn,
  useSquadSceneShows,
  useSquadTalkOpen,
  useSquadTouched,
} from "./squading";
import { setSquadMuted, squadSoundReady, useSquadMuted } from "./squadSound";
import "./squadFight.css";

const SquadTalk = dynamic(() => import("./SquadTalk"), { ssr: false });

/**
 * 卫戍条: the bar of a round of 一起卫戍, over the map while the player's room plays and its sheet is shut, in place of
 * 卫戍中 n/4. A tile each: the roach as its pose has it, this round's strategy at its foot (a dashed ? while none is
 * marked; yours nudges, with 标策略), the name, the core alliance's badge, the 附加盟约 (two, then +n), and the last
 * line for a minute; the host's says 房主, yours is yellow. A line said comes as a bubble over its tile, a change of
 * someone's round as a flash of theirs. Your tile opens 说话 / 动作 / 这局 (SquadTalk.tsx); another's, TA's card with
 * TA's round (SquadMateCard.tsx), over the row (beside the column on a computer) till its × or the tile again. Above it 看地图 / 看打怪 (the fight on the map, this device: SquadStage.tsx; while it shows, lines come
 * out of its roaches instead of the tiles), 🔔 (the sound, this device) and 展开 (the room's sheet, where the host ends
 * the round). On a phone a row of four above the layout's bottom bar; on a computer a column beside 卫戍
 * (data-squad-entry).
 */

/** Wide enough for the column beside 卫戍 */
const WIDE = "(min-width: 900px)";
/** A tile flashes this long once its round changed */
const FLASH_MS = 1_000;

function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const q = window.matchMedia(WIDE);
    const look = () => setWide(q.matches);
    look();
    q.addEventListener("change", look);
    return () => q.removeEventListener("change", look);
  }, []);
  return wide;
}

/** On a computer: beside 卫戍 (left of it on the right of the screen, else right of it), the top of the column by its own */
function useBeside(shown: boolean) {
  const [at, setAt] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (!shown) return;
    let last = "";
    const look = () => {
      const entry = [...document.querySelectorAll<HTMLElement>("[data-squad-entry]")].find((e) => e.getClientRects().length > 0);
      const r = entry?.getBoundingClientRect();
      const top = Math.round(Math.max(70, (r?.top ?? 76) - 70));
      const next: CSSProperties = !r ? { right: 16, top: 76 } : r.left > window.innerWidth / 2 ? { right: Math.round(window.innerWidth - r.left + 10), top } : { left: Math.round(r.right + 10), top };
      const k = JSON.stringify(next);
      if (k === last) return;
      last = k;
      setAt(next);
    };
    look();
    const t = window.setInterval(look, 1_000);
    window.addEventListener("resize", look);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("resize", look);
    };
  }, [shown]);
  return at;
}

/** The tiles whose round (core alliance, strategy, 附加盟约) just changed, not your own, FLASH_MS */
function useFlashes(room: SquadRoom | null) {
  const before = useRef(new Map<number, string>());
  const [flashing, setFlashing] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    const now = new Map((room?.members ?? []).map((m) => [m.h, `${m.core}:${m.strategy}:${m.extras.join(",")}`]));
    const changed = (room?.members ?? []).filter((m) => !m.you && before.current.has(m.h) && before.current.get(m.h) !== now.get(m.h)).map((m) => m.h);
    before.current = now;
    if (!changed.length) return;
    setFlashing((f) => new Set([...f, ...changed]));
    window.setTimeout(() => setFlashing((f) => new Set([...f].filter((h) => !changed.includes(h)))), FLASH_MS);
  }, [room]);
  return flashing;
}

export default function SquadFight({
  hidden,
  touches,
  onOpen,
  onTouch,
  onSafety,
  onError,
}: {
  hidden: boolean;
  /** Today's touches left and when the day turns, for a teammate's card */
  touches?: { left: number; at: number };
  /** 展开: the room's sheet */
  onOpen: () => void;
  /** 偷偷碰 or 大胆碰 someone in the room, by their number there */
  onTouch: (h: number, bold: boolean) => Promise<void>;
  /** 拉黑 and 举报 someone in the room (sq:<room>:<number>), with their name */
  onSafety: (target: string, who: string) => void;
  onError: (e: unknown) => void;
}) {
  const room = useSquadRoom();
  const playing = room?.state === "go";
  const shown = Boolean(playing) && !hidden;
  const wide = useWide();
  const above = useAbove(shown && !wide, 0);
  const beside = useBeside(shown && wide);
  const at = wide ? beside : above;
  const art = useOperatorArt();
  const lines = useSquadLines();
  const moves = useSquadMoves();
  const muted = useSquadMuted();
  const sceneOn = useSquadSceneOn();
  const sceneShows = useSquadSceneShows();
  const flashing = useFlashes(playing ? room : null);
  const talking = useSquadTalkOpen();
  const touched = useSquadTouched();
  // a teammate's card: whose, and where (over the row on a phone, beside the column on a computer); it stays till
  // its × or the tile again, and goes as the bar does
  const [peek, setPeek] = useState<{ h: number; at: CSSProperties } | null>(null);
  const [busy, setBusy] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shown) setPeek(null);
  }, [shown]);
  if (!room || !playing) return null;
  const n = room.members.length;
  const order = room.members.map((m) => m.h);
  const lifts = liftsOf(lines, order, 30);
  const peekOf = peek === null ? null : (room.members.find((m) => m.h === peek.h && !m.you) ?? null);
  // the card's place: 8 px over the row, the width of the screen less 12 px each side (420 at most); on a computer
  // beside the column, its top level with the column's
  const peekAt = (): CSSProperties => {
    const r = bar.current?.getBoundingClientRect();
    if (!r) return { left: 12, right: 12, top: "auto", bottom: 120 };
    if (wide && r.left > window.innerWidth / 2) return { left: "auto", right: Math.round(window.innerWidth - r.left + 10), top: Math.round(r.top), bottom: "auto" };
    if (wide) return { left: Math.round(r.right + 10), right: "auto", top: Math.round(r.top), bottom: "auto" };
    return { left: 12, right: 12, top: "auto", bottom: Math.round(window.innerHeight - r.top + 8) };
  };
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const head = fmt(T.squad.fight.head, {
    dot: T.squad.dot,
    level: T.squad.levelsShort[room.level - 1] ?? "",
    server: serverName("arknights", room.server) ?? room.server,
    n,
    max: SQUAD_MAX,
  });
  const tile = (m: SquadMember, i: number) => {
    const line = lines.find((l) => l.h === m.h);
    const extras = extraNames(m.extras);
    const xs = extras.length ? `${extras.slice(0, 2).join(T.squad.dot)}${extras.length > 2 ? ` ${fmt(T.squad.fight.extrasMore, { n: extras.length - 2 })}` : ""}` : T.squad.fight.extrasNone;
    const said = line ? lineWords(line.p, line.s) : null;
    const edge = wide ? "" : i === 0 ? " edge-l" : i === n - 1 ? " edge-r" : "";
    return (
      <button
        key={m.h}
        type="button"
        className={`sq-ft${m.you ? " me" : ""}${flashing.has(m.h) ? " flash" : ""}${edge}`}
        aria-label={m.you ? T.squad.fight.youTile : fmt(T.squad.fight.mateTile, { name: m.name })}
        onClick={() => {
          squadSoundReady();
          if (m.you) openSquadTalk();
          else setPeek((p) => (p?.h === m.h ? null : { h: m.h, at: peekAt() }));
        }}
      >
        {m.you && <span className="tapme">{m.strategy === null ? T.squad.fight.mark : T.squad.fight.tapMe}</span>}
        {m.host && !m.you && <span className="hostt">{T.squad.fight.host}</span>}
        {m.bot && <span className="hostt">{T.squad.bot.tag}</span>}
        {!sceneShows && <Bubble line={line} lift={lifts.get(m.h) ?? 0} side={wide ? "left" : "up"} to={line?.to === undefined ? null : room.members.find((x) => x.h === line.to)} />}
        <span className="rw">
          <SquadRoach m={m} size={wide ? 46 : 42} line={line} move={moves.find((x) => x.h === m.h)} toMe={moves.find((x) => x.to === m.h)} />
          {m.strategy === null ? (
            <span className="opq" aria-hidden="true">
              ?
            </span>
          ) : (
            <span className="sq-strat">
              <StrategyFace id={m.strategy} art={art} />
            </span>
          )}
        </span>
        <span className="nm">{m.name}</span>
        <span className="cr">
          <CoreBadge core={m.core} />
        </span>
        <span className={`xs${extras.length ? "" : " no"}`}>{xs}</span>
        <span className="last">{said ? fmt(T.squad.fight.last, { line: said }) : T.squad.fight.poses[m.pose]}</span>
      </button>
    );
  };
  return (
    <>
      {shown && at && (
        <div ref={bar} className={`sq-fight ${wide ? "col" : "row"}`} style={at} role="group" aria-label={fmt(T.squad.fight.label, { n, max: SQUAD_MAX })}>
          <div className="fh">
            <ShieldIcon size={16} />
            <span className="t">{head}</span>
            {room.wentAt !== null && (
              <button type="button" aria-label={sceneOn ? T.squad.fight.mapLabel : T.squad.fight.showLabel} aria-pressed={!sceneOn} onClick={() => setSquadSceneOn(!sceneOn)}>
                {sceneOn ? T.squad.fight.map : T.squad.fight.show}
              </button>
            )}
            <button
              type="button"
              aria-label={muted ? T.squad.fight.soundOffLabel : T.squad.fight.soundOnLabel}
              aria-pressed={!muted}
              onClick={() => setSquadMuted(!muted)}
            >
              {muted ? T.squad.fight.soundOff : T.squad.fight.soundOn}
            </button>
            <button type="button" aria-haspopup="dialog" onClick={onOpen}>
              {T.squad.fight.expand}
            </button>
          </div>
          <div className="ft4">{room.members.map(tile)}</div>
        </div>
      )}
      {shown && peek && peekOf && (
        <SquadMateCard
          m={peekOf}
          host={room.host}
          staff={room.staff}
          playing
          art={art}
          touches={touches}
          touched={touched[peekOf.h]}
          busy={busy}
          className={`on-bar${wide ? " beside" : ""}`}
          style={peek.at}
          onTouch={(bold) => onTouch(peekOf.h, bold)}
          onKick={() => (setPeek(null), void act(() => kickFromSquad(peekOf.h)))}
          onSafety={() => (setPeek(null), onSafety(`sq:${room.id}:${peekOf.h}`, peekOf.name))}
          onBot={(what) => void act(() => squadBot(what, peekOf.h)).then(() => what === "kick" && setPeek(null))}
          onClose={() => setPeek(null)}
        />
      )}
      {talking && <SquadTalk room={room} onClose={closeSquadTalk} onError={onError} />}
    </>
  );
}
