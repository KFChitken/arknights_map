"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import { serverName } from "@/lib/games";
import { SQUAD_MAX, TO, type SquadMember, type SquadMove, type SquadRoom } from "@/lib/squad";
import { shakes } from "@/lib/squadFire";
import { ShieldIcon } from "../chrome/parts";
import { useOperatorArt } from "../OperatorNames";
import { useAbove, useWide } from "./SquadBar";
import SmallFlame from "./SmallFlame";
import SquadMateCard from "./SquadMateCard";
import SquadPipButton from "./SquadPipButton";
import { ListenAsk, ListenNote } from "./SquadListen";
import { CoreBadge, extraNames, StrategyFace } from "./SquadPicks";
import { Bubble, liftsOf, SquadRoach } from "./SquadRoach";
import {
  closeSquadTalk,
  kickFromSquad,
  lineWords,
  moveInSquad,
  openSquadTalk,
  squadHitBack,
  squadShakeOff,
  sayInSquad,
  squadBot,
  squadServerNow,
  setSquadPickNext,
  setSquadSceneOn,
  useSquadLines,
  useSquadMoves,
  useSquadRoom,
  useSquadRoundUnseen,
  useSquadRounds,
  seeSquadRound,
  useSquadSceneOn,
  useSquadSceneShows,
  useSquadTalkOpen,
  useSquadToMe,
  useSquadTouched,
} from "./squading";
import { dockFolded, keepDockFolded, readyOf, tabAtRound, tileTap, type DockTab } from "./dockState";
import SquadToMe from "./SquadToMe";
import { mayCall } from "./SquadModeInvite";
import { setSquadMuted, squadSoundReady, useSquadMuted } from "./squadSound";
import "./squadFight.css";

const SquadTalk = dynamic(() => import("./SquadTalk"), { ssr: false });
const SquadDock = dynamic(() => import("./SquadDock"), { ssr: false });

/**
 * 卫戍条: the bar of a round of 一起卫戍, over the map while the player's room plays and its sheet is shut, in place of
 * 卫戍中 n/4. A tile each: the roach as its pose has it, this round's strategy at its foot (a dashed ? while none is
 * marked; yours nudges, with 标策略), the name, the core alliance's badge, the 附加盟约 (two, then +n), and the last
 * line for a minute; the host's says 房主, yours is yellow. A line said comes as a bubble over its tile, a change of
 * someone's round as a flash of theirs. Your tile opens 说话 / 动作 / 这局 (SquadTalk.tsx); another's, TA's card with
 * TA's round (SquadMateCard.tsx), over the row (beside the column on a computer) till its × or the tile again. Above it 看地图 / 看打怪 (the fight on the map, this device: SquadStage.tsx; while it shows, lines come
 * out of its roaches instead of the tiles), ♪ (卫戍的一起听, SquadListen.tsx: 听歌's player, or a card over the bar
 * first), 🔔 (the sound, this device) and 展开 (the room's sheet, where the host ends the round). On a phone a row of
 * four above the layout's bottom bar (the cards of 一起听 over the map keep above it: data-listen-over); on a computer
 * a column beside 卫戍 (data-squad-entry), which stays while 听歌's player is open beside it.
 *
 * On a computer the column is two by two (grid2), and under the tiles sits a panel (SquadDock.tsx) of 说话 · 动作 ·
 * 这局 in place of the phone's dialog, which stays open as one taps, folds down to its tabs (kept on this computer:
 * dockState.ts) and turns to 这局 as a round starts that the player marked no strategy for. Your own tile turns it
 * to 这局; 击掌 or 贴贴 in 动作 has the teammates' tiles glow (点 TA) for one to be tapped, Esc, 算了 or your own tile
 * stopping it; a teammate's card there has 击掌 and 贴贴 too, and it and 一起听's card take turns in their place.
 * Lines come out of the tiles themselves there (Bubble in).
 *
 * On a computer the bar is there while the room waits too, in place of 卫戍中 n/4 (SquadBar.tsx draws nothing there):
 * 等人中 over it (no 看地图 / 看打怪), the people and the empty seats (空位, 等人进来 or 停止加入: the room's sheet at a
 * tap, where 邀请 and 宣言招人 are), who is ready under each name, no 补位; your own tile opens the room's sheet (the
 * strategy, 准备, 开始游戏); the panel has 说话 and 动作 alone; a teammate's card has 对 TA 说; a line said to you
 * (SquadToMe.tsx) shows under its top line. As the round starts and ends the same bar turns.
 */

/** A tile flashes this long once its round changed */
const FLASH_MS = 1_000;

/** The column's width on a computer (.sq-fight.col) */
const COL_W = 340;

/**
 * On a computer: beside 卫戍 (left of it on the right of the screen, else right of it), the top of the column by its
 * own; as tall as it may be: down to 10 px over the highest of the layout's bottom bars under it (data-chrome-bottom,
 * across the column's width), else 16 px over the window's bottom
 */
function useBeside(shown: boolean) {
  const [at, setAt] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (!shown) return;
    let last = "";
    const look = () => {
      const entry = [...document.querySelectorAll<HTMLElement>("[data-squad-entry]")].find((e) => e.getClientRects().length > 0);
      const r = entry?.getBoundingClientRect();
      const W = window.innerWidth;
      const top = r ? Math.round(Math.max(70, r.top - 70)) : 76;
      const onRight = !r || r.left > W / 2;
      const edge = !r ? 16 : onRight ? Math.round(W - r.left + 10) : Math.round(r.right + 10);
      const side = onRight ? { right: edge } : { left: edge };
      // where the column's left edge is
      const from = onRight ? W - edge - COL_W : edge;
      const under = [...document.querySelectorAll("[data-chrome-bottom]")]
        .map((e) => e.getBoundingClientRect())
        .filter((b) => b.height && b.top > top && b.left < from + COL_W && b.right > from);
      const floor = under.length ? Math.min(...under.map((b) => b.top)) - 10 : window.innerHeight - 16;
      const next: CSSProperties = { ...side, top, maxHeight: Math.max(160, Math.round(floor - top)) };
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
  listenOpen,
  touches,
  onOpen,
  onListen,
  onTouch,
  onSafety,
  onToast,
  onError,
}: {
  hidden: boolean;
  /** 听歌's player is open: over the row on a phone (it goes), beside the column on a computer (it stays) */
  listenOpen: boolean;
  /** Today's touches left and when the day turns, for a teammate's card */
  touches?: { left: number; at: number };
  /** 展开: the room's sheet */
  onOpen: () => void;
  /** 听歌's player (卫戍的一起听 is in it) */
  onListen: () => void;
  /** 偷偷碰 or 大胆碰 someone in the room, by their number there */
  onTouch: (h: number, bold: boolean) => Promise<void>;
  /** 拉黑 and 举报 someone in the room (sq:<room>:<number>), with their name */
  onSafety: (target: string, who: string) => void;
  onToast: (text: string) => void;
  onError: (e: unknown) => void;
}) {
  const room = useSquadRoom();
  const playing = room?.state === "go";
  const wide = useWide();
  // in a round on any screen; on a computer while the room waits too
  const active = Boolean(room) && (playing || wide);
  const shown = active && !hidden && (wide || !listenOpen);
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
  const toMe = useSquadToMe();
  // a teammate's card: whose, and where (over the row on a phone, beside the column on a computer); it stays till
  // its × or the tile again, and goes as the bar does
  const [peek, setPeek] = useState<{ h: number; at: CSSProperties } | null>(null);
  // 卫戍的一起听's card from ♪, where it stands
  const [listenCard, setListenCard] = useState<CSSProperties | null>(null);
  const [busy, setBusy] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  // on a computer: the panel's tab, folded or not (as this computer keeps it), and the move a teammate is picked for
  const [tab, setTab] = useState<DockTab>("say");
  const [folded, setFolded] = useState(false);
  useEffect(() => setFolded(dockFolded()), []);
  const [picking, setPicking] = useState<SquadMove | null>(null);
  const rounds = useSquadRounds();
  const unseen = useSquadRoundUnseen();
  useEffect(() => {
    if (!shown) {
      setPeek(null);
      setListenCard(null);
      setPicking(null);
    }
  }, [shown]);
  // a round starts in sight: 这局 once, for one who marked no strategy for it, when the panel is open
  useEffect(() => {
    if (!wide) return;
    const turn = tabAtRound(folded, unseen);
    if (turn) setTab(turn);
    // the round's start alone, not the panel folded or opened later
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds, wide]);
  useEffect(() => {
    if (wide && !folded && tab === "round") seeSquadRound();
  }, [wide, folded, tab, unseen]);
  // the round over, the room waits again: no 这局, back to 说话
  useEffect(() => {
    if (!playing) setTab((t) => (t === "round" ? "say" : t));
  }, [playing]);
  // your roach in the fight tapped (说话 / 动作 / 这局): on a computer the panel, on 说话, and no dialog
  useEffect(() => {
    if (!wide || !talking) return;
    closeSquadTalk();
    setTab("say");
    setPicking(null);
    setFolded(false);
    keepDockFolded(false);
  }, [wide, talking]);
  // Esc stops picking a teammate
  useEffect(() => {
    if (!picking) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setPicking(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [picking]);
  if (!room || !active) return null;
  const waiting = !playing;
  // the panel's page: 这局 only in a round
  const page: DockTab = waiting && tab === "round" ? "say" : tab;
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
  // 击掌 or 贴贴 to the one with the number h, shown on the tiles; one too many said so
  const moveTo = (move: SquadMove, h: number) =>
    void act(async () => {
      const res = await moveInSquad(move, h);
      if (!res.sent) onToast(res.full ? T.squad.say.enough : T.squad.say.slow);
    });
  // 对 TA 说 from a teammate's card while the room waits: said, the card goes; one too many said so
  const sayTo = (p: number, h: number) =>
    void act(async () => {
      const res = await sayInSquad(p, h);
      if (res.sent) setPeek(null);
      else onToast(res.full ? T.squad.say.enough : T.squad.say.slow);
    });
  const fold = (f: boolean) => {
    setFolded(f);
    keepDockFolded(f);
    if (f) setPicking(null);
  };
  const toTab = (k: DockTab) => {
    if (k !== tab) setPicking(null);
    setTab(k);
    if (folded) fold(false);
  };
  // a teammate's card, and 一起听's from ♪: one at a time in their place
  const openCard = (h: number) => {
    setListenCard(null);
    setPeek((p) => (p?.h === h ? null : { h, at: peekAt() }));
  };
  const head = fmt(waiting ? T.squad.fight.headWait : T.squad.fight.head, {
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
    // while the room waits, in place of the 附加盟约: ready or not, the host needing none
    const ready = readyOf(m);
    const edge = wide ? "" : i === 0 ? " edge-l" : i === n - 1 ? " edge-r" : "";
    // on a computer while a teammate is picked: the teammates glow, yours fades
    const pick = wide && picking !== null;
    const label = !wide
      ? m.you
        ? T.squad.fight.youTile
        : fmt(T.squad.fight.mateTile, { name: m.name })
      : m.you
        ? waiting
          ? T.squad.fight.youTileWait
          : T.squad.fight.youTileDock
        : pick
          ? fmt(T.squad.fight.mateTilePick, { name: m.name, move: T.squad.talk.moves[picking!] })
          : fmt(T.squad.fight.mateTile, { name: m.name });
    return (
      <button
        key={m.h}
        type="button"
        className={`sq-ft${m.you ? " me" : ""}${flashing.has(m.h) ? " flash" : ""}${pick ? (m.you ? " dim" : " pickme") : ""}${edge}`}
        aria-label={label}
        onClick={() => {
          squadSoundReady();
          // your own tile with a ball on it, or a 源石虫 on your roach's head: the tap sends it back, or shakes it off
          if (m.you && m.ball && m.ball.until > Date.now()) return void squadHitBack().catch(() => {});
          if (m.you && m.head && m.head.until > Date.now() && shakes(m.head.item)) return void squadShakeOff().catch(() => {});
          if (!wide) return m.you ? openSquadTalk() : openCard(m.h);
          const what = tileTap(m.you, pick, waiting);
          if (what === "round") toTab("round");
          else if (what === "sheet") onOpen();
          else if (what === "cancel") setPicking(null);
          else if (what === "pick") {
            setPicking(null);
            moveTo(picking!, m.h);
          } else openCard(m.h);
        }}
      >
        {m.you && playing && (!wide || m.strategy === null) && <span className="tapme">{m.strategy === null ? T.squad.fight.mark : T.squad.fight.tapMe}</span>}
        {m.host && !m.you && <span className="hostt">{T.squad.fight.host}</span>}
        {m.bot && <span className="hostt">{T.squad.bot.tag}</span>}
        {pick && !m.you && <span className="pickt">{T.squad.fight.pickMe}</span>}
        {!sceneShows && <Bubble line={line} lift={lifts.get(m.h) ?? 0} side={wide ? "in" : "up"} to={line?.to === undefined ? null : room.members.find((x) => x.h === line.to)} />}
        <span className="rw">
          <SquadRoach m={m} size={42} line={line} move={moves.find((x) => x.h === m.h)} toMe={moves.find((x) => x.to === m.h)} play="bar" />
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
        <span className="nm">
          {m.name}
          {m.fireTop && <SmallFlame label={T.lib.badges.firewatch.name} />}
        </span>
        <span className="cr">
          <CoreBadge core={m.core} />
        </span>
        {waiting ? <span className={`xs${ready.ok ? " ok" : " no"}`}>{ready.text}</span> : <span className={`xs${extras.length ? "" : " no"}`}>{xs}</span>}
        <span className="last">{said ? fmt(T.squad.fight.last, { line: said }) : T.squad.fight.poses[m.pose]}</span>
      </button>
    );
  };
  // while the room waits, its empty seats: the room's sheet at a tap (邀请, 宣言招人, 人机 are there)
  const seats = waiting ? Array.from({ length: Math.max(0, SQUAD_MAX - n) }, (_, i) => (
    <button key={`seat${i}`} type="button" className={`sq-ft empty${room.stopped ? " shut" : ""}`} aria-label={T.squad.fight.seatLabel} aria-haspopup="dialog" onClick={onOpen}>
      <span className="rw">
        <span className="hole" aria-hidden="true">
          {room.stopped ? "🔒" : "+"}
        </span>
      </span>
      <span className="nm">{T.squad.fight.seat}</span>
      <span className="xs no">{room.stopped ? T.squad.room.stoppedSeat : T.squad.fight.seatSub}</span>
    </button>
  )) : [];
  return (
    <>
      {shown && at && (
        <div
          ref={bar}
          className={`sq-fight ${wide ? "col grid2" : "row"}${waiting ? " wait" : ""}`}
          style={at}
          role="group"
          aria-label={fmt(waiting ? T.squad.fight.labelWait : T.squad.fight.label, { n, max: SQUAD_MAX })}
          {...(wide ? {} : { "data-listen-over": "" })}
        >
          <div className="fh">
            <ShieldIcon size={16} />
            <span className="t">{head}</span>
            {room.wentAt !== null && (
              <button type="button" aria-label={sceneOn ? T.squad.fight.mapLabel : T.squad.fight.showLabel} aria-pressed={!sceneOn} onClick={() => setSquadSceneOn(!sceneOn)}>
                {sceneOn ? T.squad.fight.map : T.squad.fight.show}
              </button>
            )}
            <ListenNote
              room={room}
              onListen={() => {
                setListenCard(null);
                onListen();
              }}
              onCard={() => {
                setPeek(null);
                setListenCard((c) => (c ? null : peekAt()));
              }}
            />
            <button
              type="button"
              aria-label={muted ? T.squad.fight.soundOffLabel : T.squad.fight.soundOnLabel}
              aria-pressed={!muted}
              onClick={() => setSquadMuted(!muted)}
            >
              {muted ? T.squad.fight.soundOff : T.squad.fight.soundOn}
            </button>
            {wide && <SquadPipButton onError={onError} />}
            <button type="button" aria-haspopup="dialog" onClick={onOpen}>
              {T.squad.fight.expand}
            </button>
          </div>
          {waiting && toMe && (
            <SquadToMe
              room={room}
              className="in-bar"
              onPick={() => {
                setSquadPickNext(true);
                onOpen();
              }}
            />
          )}
          <div className="ft4">
            {room.members.map(tile)}
            {seats}
          </div>
          {wide && (
            <SquadDock
              room={room}
              tab={page}
              folded={folded}
              unseen={unseen}
              picking={picking}
              onTab={toTab}
              onFold={fold}
              onPick={setPicking}
              onError={onError}
            />
          )}
        </div>
      )}
      {shown && listenCard && (
        <ListenAsk
          room={room}
          style={listenCard}
          onListen={() => {
            setListenCard(null);
            onListen();
          }}
          onToast={onToast}
          onClose={() => setListenCard(null)}
        />
      )}
      {shown && peek && peekOf && (
        <SquadMateCard
          m={peekOf}
          host={room.host}
          staff={room.staff}
          playing={playing}
          art={art}
          touches={touches}
          touched={touched[peekOf.h]}
          busy={busy}
          className={`on-bar${wide ? " beside" : ""}`}
          style={peek.at}
          me={room.members.find((x) => x.you)}
          onSay={waiting ? (p) => sayTo(p, peekOf.h) : undefined}
          onCall={mayCall(room, peekOf.h, squadServerNow()) ? () => sayTo(TO.play, peekOf.h) : undefined}
          onTouch={(bold) => onTouch(peekOf.h, bold)}
          onKick={() => (setPeek(null), void act(() => kickFromSquad(peekOf.h)))}
          onSafety={() => (setPeek(null), onSafety(`sq:${room.id}:${peekOf.h}`, peekOf.name))}
          onBot={(what) => void act(() => squadBot(what, peekOf.h)).then(() => what === "kick" && setPeek(null))}
          onMove={
            wide
              ? (move) => {
                  setPeek(null);
                  moveTo(move, peekOf.h);
                }
              : undefined
          }
          onClose={() => setPeek(null)}
        />
      )}
      {talking && !wide && <SquadTalk room={room} onClose={closeSquadTalk} onError={onError} />}
    </>
  );
}
