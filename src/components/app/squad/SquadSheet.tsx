"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { fmt, fmtParts, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { serverName } from "@/lib/games";
import type { PassesDot } from "@/lib/passes";
import { DECLARATION_RADIUS_KM, DECLARATIONS_PER_DAY } from "@/lib/rules";
import { INK_FROM } from "@/lib/si";
import {
  DEFAULT_SERVER,
  findKey,
  KEY_OLD_MS,
  KEY_WARN_MS,
  LEVELS,
  LIST_EVERY_MS,
  LIST_IDLE_MS,
  NEED_CARD,
  NO_CORE,
  OPENS_PER_DAY,
  PHRASE_ROWS,
  ROOM_FULL,
  ROOM_GONE,
  ROOM_PLAYING,
  ROOM_SHUT,
  SAY_EVERY_MS,
  SEASON_NAME,
  SQUAD_CLOSED,
  SQUAD_MAX,
  SQUAD_SERVERS,
  TAGS,
  TAGS_MAX,
  type PhraseRow,
  mayStart,
  notYet,
  sameStrategy,
  strategyOf,
  type SquadCard,
  type SquadFriend,
  type SquadList,
  type SquadListRoom,
  type SquadMember,
  type SquadPicks,
  type SquadRoom,
  type SquadSeat,
} from "@/lib/squad";
import { squadApi, SquadRefused } from "@/lib/squadClient";
import type { RoachAvatar, RoachColor } from "@/lib/types";
import type { OwnRoach } from "@/lib/world/types";
import RoachIcon from "../../RoachIcon";
import DjBar from "./DjBar";
import { CoreBadge, CoreChips, LevelBadge, LevelChips, levelName, StrategyGrid, StrategyPic } from "./SquadPicks";
import { useOperatorArt, type Art } from "../OperatorNames";
import Sheet from "../Sheet";
import {
  changeSquadKey,
  clearSquadNotice,
  declareSquadRoom,
  inviteToSquad,
  joinSquadBy,
  joinSquadRoom,
  kickFromSquad,
  leaveSquadRoom,
  loadSquadFriends,
  openSquadRoom,
  saveSquadCard,
  sayInSquad,
  sentWords,
  setSquadInGame,
  setSquadPrefs,
  squadState,
  useSquadCard,
  useSquadFloats,
  useSquadNotice,
  useSquadRoom,
  useSquadShowName,
} from "./squading";
import "./squad.css";

/**
 * 一起卫戍's sheet (src/lib/squad.ts), loaded only when opened: the list of rooms (one server at a time, each seat's
 * card, asked again every LIST_EVERY_MS while in sight and touched), opening a room, the room one is in (its key, who
 * is in it with their cards, the host's row of three, touching, 拉黑 and 举报, the set lines), and the 卫戍名片,
 * filled in first wherever a room needs it. Requests that fail say why; what only the map page can do (signing in,
 * the age question, 拉黑 and 举报's sheet, a touch's toasts) goes to it.
 */

export type SquadView = "list" | "open" | "card" | "room";
/** Going in at an invitation to you, or a 宣言招人 you got: its item in 消息 (qi:… or d:…), and its id */
export type SquadJoin = { item: string } & ({ invite: string } | { declaration: string });

type Props = {
  /** Where it opens: the room they are in when there is one, else the list */
  start?: SquadView;
  /** The server of their 明日方舟 UID in 资料 (""/unknown: 官服) */
  homeServer: string;
  /** Their 卫戍名片 as me() gave it, and its 列表上显示我的名字 */
  card: SquadCard | null;
  showName: boolean;
  /** Opened to go in at an invitation or a 宣言招人 you got, from 消息 or the card over the map */
  join?: SquadJoin;
  /** Your roaches, and whether your ink roach is out: where 宣言招人 may go out from */
  roaches: OwnRoach[];
  ink: boolean;
  /** 宣言招人 sent: what it reached */
  onDeclared: (res: { reach: string } & PassesDot) => void;
  /** Gone in at an invitation or a 宣言招人: its item in 消息, to be read */
  onJoined: (item: string) => void;
  onTouch: (h: number, bold: boolean) => Promise<void>;
  onSafety: (target: string, who: string) => void;
  /** A refusal the map page handles (signing in, the age question, …), or any other error */
  onError: (e: unknown) => void;
  onToast: (text: string) => void;
  onClose: () => void;
};

const LIST_SERVER = "squad.server";
/** Refusals that mean the list is out of date: it is asked again */
const STALE: ReadonlySet<string> = new Set([ROOM_GONE, ROOM_FULL, ROOM_PLAYING, ROOM_SHUT, SQUAD_CLOSED]);
const minutes = (ms: number) => Math.max(0, Math.floor(ms / 60_000));
const srv = (id: string) => serverName("arknights", id) ?? id;
const homeOf = (s: string) => (SQUAD_SERVERS.includes(s) ? s : DEFAULT_SERVER);

function readListServer(fallback: string) {
  try {
    const s = window.localStorage.getItem(LIST_SERVER);
    return s && SQUAD_SERVERS.includes(s) ? s : fallback;
  } catch {
    return fallback;
  }
}
function keepListServer(s: string) {
  try {
    window.localStorage.setItem(LIST_SERVER, s);
  } catch {
    // a private window keeps nothing: the profile's server again next time
  }
}

export default function SquadSheet(props: Props) {
  const room = useSquadRoom();
  const saved = useSquadCard();
  const card = saved === undefined ? props.card : saved;
  const savedShow = useSquadShowName();
  const showName = savedShow === undefined ? props.showName : savedShow;
  const [view, setView] = useState<SquadView>(props.start ?? (room ? "room" : "list"));
  // what the card was asked for, to go on with once it is filled in
  const [then, setThen] = useState<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);
  // asked again after a refusal that says the list is out of date
  const [listAsk, setListAsk] = useState(0);
  const home = homeOf(props.homeServer);
  const { onError, onToast } = props;

  // in a room of theirs: the room comes first; out of it (ended, asked to leave), back to the list
  const inRoom = Boolean(room);
  const wasIn = useRef(inRoom);
  useEffect(() => {
    if (wasIn.current && !inRoom) setView((v) => (v === "room" ? "list" : v));
    if (!wasIn.current && inRoom) setView("room");
    wasIn.current = inRoom;
  }, [inRoom]);

  /** A request: refusals of a room said here (and the card asked for when it is missing), the rest to the map page */
  const run = useCallback(
    async <R,>(fn: () => Promise<R>, again?: () => void): Promise<R | undefined> => {
      setBusy(true);
      try {
        return await fn();
      } catch (e) {
        if (e instanceof SquadRefused && e.code === NEED_CARD) {
          setThen(() => again ?? null);
          setView("card");
        } else if (e instanceof SquadRefused) {
          onToast(e.message);
          if (STALE.has(e.code)) setListAsk((n) => n + 1);
        } else onError(e);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [onError, onToast],
  );

  const needCard = (go: () => void) => {
    if (card) return go();
    setThen(() => go);
    setView("card");
  };

  // opened to go in at an invitation or a 宣言招人: once; the card first when there is none, then in
  const { join, onJoined } = props;
  const joinedAt = useRef<string | null>(null);
  useEffect(() => {
    if (!join || joinedAt.current === join.item) return;
    joinedAt.current = join.item;
    const by = "invite" in join ? { invite: join.invite } : { declaration: join.declaration };
    const go = async () => {
      const got = await run(() => joinSquadBy(by), () => void go());
      if (!got) return;
      setView("room");
      onJoined(join.item);
    };
    void go();
  }, [join, run, onJoined]);

  if (view === "card") {
    return (
      <CardView
        card={card}
        showName={showName}
        first={!card}
        busy={busy}
        onSave={async (c, show) => {
          const ok = await run(() => saveSquadCard(c, c ? show : undefined));
          if (ok === undefined) return;
          onToast(c ? T.squad.card.saved : T.squad.card.cleared);
          const go = then;
          setThen(null);
          if (go && c) go();
          else setView(room ? "room" : "list");
        }}
        onUp={() => {
          setThen(null);
          setView(room ? "room" : "list");
        }}
        onClose={props.onClose}
      />
    );
  }
  if (view === "open") {
    return (
      <OpenView
        home={home}
        card={card}
        busy={busy}
        inRoom={inRoom}
        onOpen={async (form) => {
          const r = await run(() => openSquadRoom(form), () => setView("open"));
          if (r) setView("room");
        }}
        onUp={() => setView(room ? "room" : "list")}
        onClose={props.onClose}
      />
    );
  }
  if (view === "room" && room) {
    return <RoomView room={room} busy={busy} run={run} {...props} onList={() => setView("list")} onCard={() => setView("card")} />;
  }
  return (
    <ListView
      home={home}
      room={room}
      card={card}
      showName={showName}
      busy={busy}
      ask={listAsk}
      onJoin={(r) =>
        needCard(async () => {
          const got = await run(() => joinSquadRoom(r.id), () => void joinSquadRoom(r.id).then(() => setView("room")).catch(onError));
          if (got) setView("room");
        })
      }
      onBack={() => setView("room")}
      onOpen={() => needCard(() => setView("open"))}
      onCard={() => setView("card")}
      onError={onError}
      onClose={props.onClose}
    />
  );
}

// ---- the list ----

function ListView({
  home,
  room,
  card: myCard,
  showName,
  busy,
  ask,
  onJoin,
  onBack,
  onOpen,
  onCard,
  onError,
  onClose,
}: {
  home: string;
  room: SquadRoom | null;
  /** The viewer's 卫戍名片: its 难度 is the list's first, its strategy marks the seats it clashes with */
  card: SquadCard | null;
  /** 列表上显示我的名字, said in the join box */
  showName: boolean;
  busy: boolean;
  /** Asked again each time this goes up */
  ask: number;
  onJoin: (r: SquadListRoom) => void;
  onBack: () => void;
  onOpen: () => void;
  onCard: () => void;
  onError: (e: unknown) => void;
  onClose: () => void;
}) {
  const [server, setServer] = useState(() => readListServer(home));
  // the card's 难度 until another is picked this time (none: every 难度)
  const [level, setLevel] = useState<number | null>(myCard?.level ?? null);
  const art = useOperatorArt();
  const [list, setList] = useState<SquadList | null>(null);
  const [failed, setFailed] = useState(false);
  const [idle, setIdle] = useState(false);
  const [showGo, setShowGo] = useState(false);
  const [asking, setAsking] = useState<SquadListRoom | null>(null);
  const notice = useSquadNotice();
  const touched = useRef(Date.now());
  const fetchedAt = useRef(Date.now());

  const load = useCallback(() => {
    squadApi
      .list(server, level)
      .then((l) => {
        setList(l);
        setFailed(false);
        fetchedAt.current = Date.now();
      })
      .catch((e) => {
        setFailed(true);
        if (!(e instanceof SquadRefused)) onError(e);
      });
  }, [server, level, onError]);

  // asked again every LIST_EVERY_MS while in sight, and only while touched in the last LIST_IDLE_MS
  useEffect(() => {
    load();
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - touched.current > LIST_IDLE_MS) return setIdle(true);
      load();
    }, LIST_EVERY_MS);
    const back = () => document.visibilityState === "visible" && Date.now() - touched.current <= LIST_IDLE_MS && load();
    document.addEventListener("visibilitychange", back);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", back);
    };
  }, [load]);

  useEffect(() => {
    if (ask) load();
  }, [ask, load]);

  const touch = () => {
    touched.current = Date.now();
    if (idle) {
      setIdle(false);
      load();
    }
  };

  // the list's clock: the server's when it came, gone on since on this device
  const nowOf = () => (list ? list.now + (Date.now() - fetchedAt.current) : Date.now());
  const rooms = list?.rooms ?? [];
  const waiting = rooms.filter((r) => r.state === "wait");
  const withFriends = waiting.filter((r) => r.friend);
  const others = waiting.filter((r) => !r.friend);
  const going = rooms.filter((r) => r.state === "go");
  const closed = list?.closed ?? null;
  const roomCard = (r: SquadListRoom) => (
    <RoomCard
      key={r.id}
      room={r}
      now={nowOf()}
      busy={busy || closed !== null}
      art={art}
      myStrategy={myCard?.strategy ?? null}
      onJoin={() => setAsking(r)}
      onBack={onBack}
    />
  );
  return (
    <Sheet
      title={T.squad.title}
      className="sq-sheet"
      onClose={onClose}
      footer={
        <div className="sq-foot">
          {room ? (
            <button className="primary grow" onClick={onBack}>
              {T.squad.list.mine}
            </button>
          ) : (
            <button className="primary grow" disabled={busy || closed !== null} onClick={onOpen}>
              {T.squad.list.open}
            </button>
          )}
          <button className="ghost" onClick={onCard}>
            {T.squad.list.card}
          </button>
        </div>
      }
    >
      <div className="sq-list" onPointerDown={touch}>
        {notice && (
          <p className="sq-notice" role="status">
            {notice}
            <button className="link" onClick={clearSquadNotice}>
              {T.common.ok}
            </button>
          </p>
        )}
        {closed !== null ? (
          <p className="sq-closed">{closed || T.squad.closed}</p>
        ) : (
          <p className="sq-season">{fmt(T.squad.season, { season: SEASON_NAME })}</p>
        )}
        <div className="sq-filters">
          <label>
            <span className="sr-only">{T.squad.list.serverPick}</span>
            <select
              value={server}
              onChange={(e) => {
                setServer(e.target.value);
                keepListServer(e.target.value);
                touch();
              }}
            >
              {SQUAD_SERVERS.map((s) => (
                <option key={s} value={s}>
                  {srv(s)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">{T.squad.list.levelPick}</span>
            <select value={level ?? 0} onChange={(e) => setLevel(Number(e.target.value) || null)}>
              <option value={0}>{T.squad.allLevels}</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {levelName(l)}
                </option>
              ))}
            </select>
          </label>
          <button className="chip" onClick={() => (touch(), load())}>
            {T.squad.list.refresh}
          </button>
        </div>
        <p className="sq-legend">{fmtNodes(T.squad.list.legend, { b: <b>{T.squad.list.legendB}</b> })}</p>
        {!list ? (
          <p className="hint">{failed ? T.squad.list.failed : T.squad.list.loading}</p>
        ) : !rooms.length ? (
          <div className="sq-empty">
            <p>{level ? fmt(T.squad.list.emptyLevel, { server: srv(server), level: levelName(level) }) : fmt(T.squad.list.empty, { server: srv(server) })}</p>
            {closed === null && !room && (
              <button className="link" onClick={onOpen}>
                {T.squad.list.openOne}
              </button>
            )}
          </div>
        ) : (
          <>
            {withFriends.length > 0 && <h4 className="sq-grp">{T.squad.list.friends}</h4>}
            {withFriends.map(roomCard)}
            {others.length > 0 && <h4 className="sq-grp">{T.squad.list.waiting}</h4>}
            {others.map(roomCard)}
            {going.length > 0 && (
              <button className="sq-fold" aria-expanded={showGo} onClick={() => setShowGo((s) => !s)}>
                {fmt(T.squad.list.going, { n: going.length })} {showGo ? "▴" : "▸"}
              </button>
            )}
            {showGo && going.map(roomCard)}
          </>
        )}
        {idle ? <p className="hint">{T.squad.list.idle}</p> : <p className="hint sq-tip">{T.squad.list.tip}</p>}
      </div>
      {asking && (
        <JoinAsk
          room={asking}
          home={home}
          inRoom={Boolean(room)}
          showName={showName}
          busy={busy}
          onYes={() => {
            const r = asking;
            setAsking(null);
            onJoin(r);
          }}
          onNo={() => setAsking(null)}
        />
      )}
    </Sheet>
  );
}

const needWords = (n: number) => (n >= SQUAD_MAX ? T.squad.list.full : n === SQUAD_MAX - 1 ? T.squad.list.lastOne : fmt(T.squad.list.need, { n: SQUAD_MAX - n }));

/** How old the key is, on the list: gray and 可能过期 once the game's alliance may be gone */
function KeyAge({ at, now }: { at: number; now: number }) {
  const n = minutes(now - at);
  const old = now - at >= KEY_OLD_MS;
  return <span className={`sq-age${old ? " old" : ""}`}>{fmt(old ? T.squad.list.keyOld : T.squad.list.keyAge, { n })}</span>;
}

/**
 * A room on the list: its 难度's badge, tags and how many it lacks; four seats, each with its roach, who and the picks
 * (a seat whose strategy clashes with the viewer's card marked 撞, and said under the room, only to tell); the key's
 * age, and the way in.
 */
function RoomCard({
  room,
  now,
  busy,
  art,
  myStrategy,
  onJoin,
  onBack,
}: {
  room: SquadListRoom;
  now: number;
  busy: boolean;
  art: Art | null;
  /** The viewer's card's strategy */
  myStrategy: number | null;
  onJoin: () => void;
  onBack: () => void;
}) {
  const n = room.seats.length;
  const go = room.state === "go";
  const clashing = (seat: SquadSeat) => seat.role !== "you" && sameStrategy(seat.strategy, myStrategy);
  return (
    <div className={`sq-room${room.friend ? " friend" : ""}${go ? " go" : ""}`}>
      <div className="top">
        <LevelBadge level={room.level} />
        <span className="tagline">
          {room.tags.map((t) => T.squad.tags[t - 1]).join(T.squad.dot)}
          {room.music && <small className="mus">{T.squad.list.music}</small>}
          {room.friendsOnly && <small className="only">{T.squad.list.friendsOnly}</small>}
        </span>
        {go ? <span className="gonote">{T.squad.list.playing}</span> : <span className={`need${n === SQUAD_MAX - 1 ? " one" : ""}`}>{needWords(n)}</span>}
      </div>
      <div className="sq-seats4">
        {room.seats.map((seat, i) => (
          <SeatTile key={i} seat={seat} hostName={room.host.name} hostFriend={room.host.friend} art={art} clash={clashing(seat)} />
        ))}
        {Array.from({ length: Math.max(0, SQUAD_MAX - n) }, (_, i) => (
          <span key={`e${i}`} className="sq-seat empty" aria-hidden="true">
            +
          </span>
        ))}
      </div>
      <span className="row3">
        <KeyAge at={room.keyAt} now={now} />
        {room.seats.some(clashing) && <span className="sq-clash">{T.squad.list.clash}</span>}
        {room.mine ? (
          <button className="small dark" onClick={onBack}>
            {T.squad.list.mine}
          </button>
        ) : (
          !go && (
            <button className="small dark" disabled={busy || n >= SQUAD_MAX} onClick={onJoin}>
              {T.squad.list.join}
            </button>
          )
        )}
      </span>
    </div>
  );
}

/** A seat on the list: the roach, who (the host by name, a teammate where TA may be named, else 队友) and the picks */
function SeatTile({ seat, hostName, hostFriend, art, clash }: { seat: SquadSeat; hostName: string; hostFriend: boolean; art: Art | null; clash: boolean }) {
  // a teammate by name to their 触须之交, and to everyone once they chose it on their 卫戍名片
  const name =
    seat.role === "host" ? hostName : seat.role === "you" ? T.squad.list.you : (seat.name ?? (seat.role === "friend" ? T.squad.list.friend : T.squad.list.mate));
  const friend = seat.role === "friend" || (seat.role === "host" && hostFriend);
  const named = seat.role === "host" || seat.role === "you" || Boolean(seat.name);
  return (
    <span className={`sq-seat${clash ? " clash" : ""}`}>
      {clash && <i className="tag">{T.squad.list.clashTag}</i>}
      <RoachIcon color={seat.color as RoachColor} avatar={seat.avatar as RoachAvatar} size={34} />
      <span className={`nm${friend ? " fr" : ""}${named ? "" : " anon"}`}>{name}</span>
      <span className="pk">
        <CoreBadge core={seat.core} />
        <StrategyPic id={seat.strategy} art={art} />
      </span>
    </span>
  );
}

function JoinAsk({
  room,
  home,
  inRoom,
  showName,
  busy,
  onYes,
  onNo,
}: {
  room: SquadListRoom;
  home: string;
  inRoom: boolean;
  showName: boolean;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <Ask title={fmt(T.squad.join.title, { host: room.host.name })} onNo={onNo}>
      <p className="sq-ask-sub">{fmt(T.squad.join.sub, { server: srv(room.server), level: levelName(room.level), n: room.seats.length, max: SQUAD_MAX })}</p>
      {room.server !== home && <p className="sq-warn">{fmt(T.squad.join.otherServer, { server: srv(room.server) })}</p>}
      <p>{fmt(T.squad.join.note, { now: showName ? T.squad.join.nameOn : T.squad.join.nameOff })}</p>
      {inRoom && <p className="hint">{T.squad.join.leaveOld}</p>}
      <div className="row">
        <button className="dark grow" disabled={busy} onClick={onYes}>
          {T.squad.join.yes}
        </button>
        <button className="ghost" onClick={onNo}>
          {T.squad.join.no}
        </button>
      </div>
    </Ask>
  );
}

/** A small dialog over the sheet */
function Ask({ title, onNo, children }: { title: string; onNo: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onNo();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onNo]);
  return (
    <div className="sq-ask-bg" onClick={onNo}>
      <div className="sq-ask" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

// ---- opening a room ----

function Chips<V extends string | number>({
  options,
  on,
  label,
  onPick,
}: {
  options: readonly V[];
  on: (v: V) => boolean;
  label: (v: V) => ReactNode;
  onPick: (v: V) => void;
}) {
  return (
    <div className="chips">
      {options.map((v) => (
        <button key={v} type="button" className={`chip${on(v) ? " on" : ""}`} aria-pressed={on(v)} onClick={() => onPick(v)}>
          {label(v)}
        </button>
      ))}
    </div>
  );
}

/** Pressed: in, or out; a third of at most `max` takes the place of the first */
const toggleIn = (list: number[], v: number, max: number) =>
  list.includes(v) ? list.filter((x) => x !== v) : list.length < max ? [...list, v] : [...list.slice(1), v];

function OpenView({
  home,
  card,
  busy,
  inRoom,
  onOpen,
  onUp,
  onClose,
}: {
  home: string;
  /** The opener's 卫戍名片: its 难度 picked to begin with */
  card: SquadCard | null;
  busy: boolean;
  inRoom: boolean;
  onOpen: (form: { key: string; server: string; level: number; tags: number[]; friendsOnly: boolean }) => void;
  onUp: () => void;
  onClose: () => void;
}) {
  const [pasted, setPasted] = useState("");
  const [server, setServer] = useState(home);
  const [level, setLevel] = useState(card?.level ?? 3);
  const [tags, setTags] = useState<number[]>([]);
  const [friendsOnly, setFriendsOnly] = useState(false);
  const key = findKey(pasted);
  return (
    <Sheet
      title={T.squad.open.title}
      className="sq-sheet"
      onUp={onUp}
      onClose={onClose}
      footer={
        <div className="sq-foot">
          <button className="primary grow" disabled={busy || !key} onClick={() => key && onOpen({ key, server, level, tags, friendsOnly })}>
            {T.squad.open.go}
          </button>
        </div>
      }
    >
      <div className="sq-form">
        <p className="tip">{fmtNodes(T.squad.open.first, { b: <b>{T.squad.open.firstB}</b> })}</p>
        <label className="field">
          <span>{T.squad.open.key}</span>
          <input
            className="code"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={fmt(T.squad.open.keyHint, { n: 14 })}
            value={pasted}
            maxLength={200}
            onChange={(e) => setPasted(e.target.value)}
          />
          {pasted.trim() !== "" &&
            (key ? (
              <span className="ok">
                {T.squad.open.keyOk} <code>{key}</code>
              </span>
            ) : (
              <span className="err">{T.squad.open.keyBad}</span>
            ))}
        </label>
        <div className="field">
          <span>
            {T.squad.open.server}
            <small>{T.squad.open.serverHint}</small>
          </span>
          <Chips options={SQUAD_SERVERS} on={(s) => s === server} label={srv} onPick={setServer} />
          {server !== home && <span className="sq-warn small">{fmt(T.squad.open.otherServer, { server: srv(server) })}</span>}
        </div>
        <div className="field">
          <span>{T.squad.open.level}</span>
          <Chips options={LEVELS} on={(l) => l === level} label={levelName} onPick={setLevel} />
        </div>
        <div className="field">
          <span>
            {T.squad.open.tags}
            <small>{fmt(T.squad.open.tagsHint, { n: TAGS_MAX })}</small>
          </span>
          <Chips options={TAGS} on={(t) => tags.includes(t)} label={(t) => T.squad.tags[t - 1]} onPick={(t) => setTags((l) => toggleIn(l, t, TAGS_MAX))} />
        </div>
        <div className="field">
          <span>{T.squad.open.who}</span>
          <Chips
            options={["all", "friends"] as const}
            on={(w) => (w === "friends") === friendsOnly}
            label={(w) => (w === "friends" ? T.squad.open.whoFriends : T.squad.open.whoAll)}
            onPick={(w) => setFriendsOnly(w === "friends")}
          />
        </div>
        <ul className="tip">
          <li>{T.squad.open.public}</li>
          <li>{T.squad.open.expire}</li>
          <li>{T.squad.open.search}</li>
          <li>{fmt(T.squad.open.limit, { n: OPENS_PER_DAY })}</li>
          {inRoom && <li>{T.squad.open.leaveOld}</li>}
        </ul>
      </div>
    </Sheet>
  );
}

// ---- the card ----

function CardView({
  card,
  showName,
  first,
  busy,
  onSave,
  onUp,
  onClose,
}: {
  card: SquadCard | null;
  showName: boolean;
  first: boolean;
  busy: boolean;
  onSave: (c: SquadCard | null, showName: boolean) => void;
  onUp: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SquadCard | null>(card);
  const [show, setShow] = useState(showName);
  const art = useOperatorArt();
  // a strategy or 难度 picked first, with no core alliance yet, takes 随机应变 with it
  const d: SquadCard = draft ?? { core: NO_CORE, strategy: null, level: null };
  const set = (p: Partial<SquadCard>) => setDraft({ ...d, ...p });
  return (
    <Sheet
      title={T.squad.card.title}
      className="sq-sheet"
      onUp={onUp}
      onClose={onClose}
      footer={
        <div className="sq-foot">
          <button className="primary grow" disabled={busy || !draft} onClick={() => draft && onSave(draft, show)}>
            {T.squad.card.save}
          </button>
          {card && (
            <button className="ghost" disabled={busy} onClick={() => onSave(null, false)}>
              {T.squad.card.clear}
            </button>
          )}
        </div>
      }
    >
      {first && <p className="tip">{T.squad.card.first}</p>}
      <p className="hint">{T.squad.card.note}</p>
      <div className="sq-prefs">
        <div className="lab">
          {T.squad.card.core}
          <small>{T.squad.card.coreHint}</small>
        </div>
        <CoreChips value={draft ? draft.core : null} onPick={(core) => set({ core })} />
        <div className="lab">
          {T.squad.card.strategy}
          <small>{T.squad.card.strategyHint}</small>
        </div>
        <StrategyGrid value={d.strategy} core={d.core} art={art} onPick={(strategy) => set({ strategy })} />
        <div className="lab">
          {T.squad.card.level}
          <small>{T.squad.card.levelHint}</small>
        </div>
        <LevelChips value={d.level} onPick={(level) => set({ level })} />
      </div>
      <label className="sq-show">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        <span>
          {T.squad.card.showName}
          <small>{T.squad.card.showNameHint}</small>
        </span>
      </label>
    </Sheet>
  );
}

// ---- the room ----

function RoomView({
  room,
  busy,
  run,
  onList,
  onCard,
  onTouch,
  onSafety,
  onToast,
  onError,
  onClose,
  roaches,
  ink,
  onDeclared,
}: Props & {
  room: SquadRoom;
  busy: boolean;
  run: <R>(fn: () => Promise<R>) => Promise<R | undefined>;
  onList: () => void;
  onCard: () => void;
}) {
  const [picking, setPicking] = useState<"core" | "strategy" | null>(null);
  // another's tile tapped: what can be done to TA
  const [menu, setMenu] = useState<number | null>(null);
  const art = useOperatorArt();
  const [asking, setAsking] = useState<"end" | "key" | "invite" | "declare" | "hostMenu" | null>(null);
  // the host asking someone to leave: whom (their number), asked first
  const [kicking, setKicking] = useState<number | null>(null);
  const [, tick] = useState(0);
  // the clock of what it shows: the server's when the room came, gone on since on this device
  const cameAt = useRef({ server: room.now, device: Date.now() });
  useEffect(() => {
    cameAt.current = { server: room.now, device: Date.now() };
  }, [room]);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 20_000);
    return () => window.clearInterval(t);
  }, []);
  const now = cameAt.current.server + (Date.now() - cameAt.current.device);
  const me = room.members.find((m) => m.you)!;
  const n = room.members.length;
  const keyAge = now - room.keyAt;
  const left = Math.max(0, room.endsAt - now);
  const leftWords =
    left >= 3_600_000 ? fmt(T.squad.room.left.hour, { h: Math.floor(left / 3_600_000), m: minutes(left % 3_600_000) }) : fmt(T.squad.room.left.min, { n: Math.max(1, minutes(left)) });
  const ends =
    room.endsWhy === "idle"
      ? fmt(T.squad.room.endsIdle, { m: Math.max(1, Math.ceil(left / 60_000)) })
      : room.endsWhy === "go"
        ? fmt(T.squad.room.endsGo, { t: leftWords })
        : fmt(T.squad.room.endsLife, { t: leftWords });
  const pill = room.state === "go" ? T.squad.room.go : n >= SQUAD_MAX ? fmt(T.squad.room.full, { n, max: SQUAD_MAX }) : fmt(T.squad.room.wait, { n, max: SQUAD_MAX });
  const host = room.members.find((m) => m.host);
  const menuOf = menu === null ? null : (room.members.find((m) => m.h === menu && !m.you) ?? null);
  // calling others in, while it waits for players and has a seat: anyone's invitations to their 触须之交 (who come in
  // even where only the host's may), and the host's 宣言招人, once a room, where anyone may come
  const mayInvite = room.state === "wait" && n < SQUAD_MAX;
  const mayDeclare = mayInvite && room.host && !room.friendsOnly && !room.declared;
  // what keeps the round from starting, in a line (the server says no the same way)
  const blocks = notYet(room.members);
  const nameOf = (m: SquadMember) => (m.you ? T.squad.room.youName : m.name);
  const need = [
    ...(blocks.alone ? [T.squad.room.alone] : []),
    ...blocks.notReady.map((m) => fmt(T.squad.room.notReadyOne, { name: nameOf(m) })),
    ...blocks.clashes.map(([a, b]) => fmt(T.squad.room.clashPair, { a: nameOf(a), b: nameOf(b), s: strategyOf(a.strategy!)?.op ?? "" })),
  ].join(T.squad.room.needSep);
  const kickOf = kicking === null ? null : (room.members.find((m) => m.h === kicking && !m.you) ?? null);
  const declare = async (from: string[] | null) => {
    const res = await run(() => declareSquadRoom(from));
    if (!res) return;
    setAsking(null);
    onDeclared(res);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.key);
      onToast(T.squad.room.copied);
    } catch {
      onToast(T.squad.room.copyFailed);
    }
  };
  const leave = () => (room.host ? setAsking("end") : void run(() => leaveSquadRoom()));
  return (
    <Sheet
      title={`${levelName(room.level)}${T.squad.dot}${srv(room.server)}`}
      className="sq-sheet sq-in"
      head={
        <div className="sq-head">
          <button className="link" onClick={onList}>
            {T.squad.room.back}
          </button>
          <h2>{`${levelName(room.level)}${T.squad.dot}${srv(room.server)}`}</h2>
          {room.host ? (
            <button className="ghost small" aria-label={T.squad.room.hostMenu} aria-expanded={asking === "hostMenu"} onClick={() => setAsking((a) => (a === "hostMenu" ? null : "hostMenu"))}>
              ⋯
            </button>
          ) : (
            <button className="ghost small" disabled={busy} onClick={leave}>
              {T.squad.room.leave}
            </button>
          )}
        </div>
      }
      onClose={onClose}
      footer={<Dock music={room.dj && room.startedAt !== null} />}
    >
      <Floats />
      {room.host && asking === "hostMenu" && (
        <div className="sq-pop sq-hostmenu" role="group" aria-label={T.squad.room.hostMenu}>
          <button disabled={busy || room.keyLeft <= 0} onClick={() => setAsking("key")}>
            <b>{T.squad.room.rekey}</b>
            {room.keyLeft > 0 ? fmt(T.squad.room.rekeyLeft, { n: room.keyLeft }) : T.squad.room.rekeyNone}
          </button>
          {!room.friendsOnly && room.state === "wait" && (
            <button disabled={busy || !mayDeclare} onClick={() => setAsking("declare")}>
              <b>{T.squad.call.declare}</b>
              {room.declared ? T.squad.call.declared : n >= SQUAD_MAX ? T.squad.room.fullNoCall : ""}
            </button>
          )}
          <button className="end" disabled={busy} onClick={() => setAsking("end")}>
            <b>{T.squad.room.destroy}</b>
            {T.squad.room.endNote}
          </button>
        </div>
      )}
      <div className="sq-status">
        <span className={`pill ${room.state === "go" ? "go" : n >= SQUAD_MAX ? "full" : "wait"}`}>{pill}</span>
        <span>{host ? fmt(T.squad.room.hostLine, { name: host.name, server: srv(room.server) }) : srv(room.server)}</span>
        <small className="ends">{ends}</small>
      </div>
      <div className={`sq-key${!room.host && me.inGame ? " one" : ""}`}>
        <div className="kl">
          {fmt(T.squad.room.keyLabel, { server: srv(room.server) })}
          <small>{keyAge < 60_000 ? T.squad.room.keyAgeNow : fmt(T.squad.room.keyAge, { n: minutes(keyAge) })}</small>
        </div>
        <div className="kv">
          <code>{room.key}</code>
          <button className="small" onClick={() => void copy()}>
            {T.squad.room.copy}
          </button>
        </div>
        {room.host && room.state === "wait" && keyAge >= KEY_WARN_MS && <p className="sq-warn small">{T.squad.room.keyWarn}</p>}
        {!room.host && !me.inGame && <p className="hint">{T.squad.room.keyHint}</p>}
      </div>
      <DjBar room={room} busy={busy} run={run} />
      <div className="sq-tiles">
        {room.members.map((m) => (
          <MemberTile
            key={m.h}
            m={m}
            art={art}
            open={menu === m.h}
            onCore={() => setPicking("core")}
            onStrategy={() => setPicking("strategy")}
            onMenu={() => setMenu((x) => (x === m.h ? null : m.h))}
            onKick={room.host && !m.you ? () => setKicking(m.h) : undefined}
          />
        ))}
        {Array.from({ length: Math.max(0, SQUAD_MAX - n) }, (_, i) => (
          <div key={`slot${i}`} className="sq-tile empty">
            <span className="plus" aria-hidden="true">
              +
            </span>
            <span className="nm">{T.squad.room.empty}</span>
            {i === 0 && mayInvite && (
              <button className="small" disabled={busy} onClick={() => setAsking("invite")}>
                {T.squad.call.invite}
              </button>
            )}
          </div>
        ))}
      </div>
      {menuOf && (
        <div className="sq-pop" role="group" aria-label={menuOf.name}>
          <small className="pn">{menuOf.name}</small>
          <button onClick={() => (setMenu(null), void onTouch(menuOf.h, false))}>
            <b>{T.squad.room.sneak}</b>
            {T.squad.room.sneakSub}
          </button>
          <button onClick={() => (setMenu(null), void onTouch(menuOf.h, true))}>
            <b>{T.squad.room.bold}</b>
            {T.squad.room.boldSub}
          </button>
          <small>{T.squad.room.touchNote}</small>
          <button onClick={() => (setMenu(null), onSafety(`sq:${room.id}:${menuOf.h}`, menuOf.name))}>
            <b>{T.squad.room.block}</b>
            {T.squad.room.blockSub}
          </button>
          <button onClick={() => (setMenu(null), onSafety(`sq:${room.id}:${menuOf.h}`, menuOf.name))}>
            <b>{T.squad.room.report}</b>
            {T.squad.room.reportSub}
          </button>
        </div>
      )}
      {room.host ? (
        room.state === "wait" ? (
          <div className="sq-go">
            {!mayStart(blocks) && <p className="sq-need">{fmt(T.squad.room.needLine, { list: need })}</p>}
            <button className="primary grow" disabled={busy || !mayStart(blocks)} onClick={() => void run(() => squadState("go"))}>
              {T.squad.room.start}
            </button>
          </div>
        ) : (
          <div className="sq-go">
            <button className="dark grow" disabled={busy} onClick={() => void run(() => squadState("wait"))}>
              {T.squad.room.endRound}
            </button>
          </div>
        )
      ) : (
        room.state === "wait" && (
          <div className="sq-go">
            <button className={me.inGame ? "ghost grow" : "primary grow"} disabled={busy} onClick={() => void run(() => setSquadInGame(!me.inGame))}>
              {me.inGame ? T.squad.room.inGameOn : T.squad.room.inGame}
            </button>
          </div>
        )
      )}
      {room.invited.length > 0 && (
        <p className="hint sq-invited">
          {fmt(T.squad.call.invited, {
            list: room.invited
              .map((x) => fmt(x.state === "waiting" ? T.squad.call.waitingName : T.squad.call.missedName, { name: x.card.displayName }))
              .join(T.common.listSep),
          })}
        </p>
      )}
      <p className="hint sq-tip">
        <button className="link" onClick={onCard}>
          {T.squad.list.card}
        </button>
      </p>
      {asking === "end" && (
        <Ask title={T.squad.room.endAsk} onNo={() => setAsking(null)}>
          <p>{T.squad.room.endNote}</p>
          <div className="row">
            <button
              className="dark grow"
              disabled={busy}
              onClick={() => {
                setAsking(null);
                void run(() => squadState("end"));
              }}
            >
              {T.squad.room.endYes}
            </button>
            <button className="ghost" onClick={() => setAsking(null)}>
              {T.squad.room.endNo}
            </button>
          </div>
        </Ask>
      )}
      {kickOf && (
        <Ask title={fmt(T.squad.room.kickAsk, { name: kickOf.name })} onNo={() => setKicking(null)}>
          <p>{T.squad.room.kickSub}</p>
          <div className="row">
            <button
              className="dark grow"
              disabled={busy}
              onClick={() => {
                setKicking(null);
                void run(() => kickFromSquad(kickOf.h));
              }}
            >
              {T.squad.room.kick}
            </button>
            <button className="ghost" onClick={() => setKicking(null)}>
              {T.squad.room.endNo}
            </button>
          </div>
        </Ask>
      )}
      {picking && (
        <PicksAsk
          kind={picking}
          me={me}
          art={art}
          busy={busy}
          onPick={async (p) => {
            const r = await run(() => setSquadPrefs({ core: me.core, strategy: me.strategy, ...p }));
            if (r) setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {asking === "invite" && (
        <InvitePicker
          room={room}
          busy={busy}
          onSend={async (picked) => {
            const sent = await run(() => inviteToSquad(picked));
            if (!sent) return;
            setAsking(null);
            onToast(sentWords(sent));
          }}
          onError={onError}
          onClose={() => setAsking(null)}
        />
      )}
      {asking === "declare" && (
        <DeclareAsk roaches={roaches} ink={ink} need={SQUAD_MAX - n} busy={busy} onSend={(from) => void declare(from)} onNo={() => setAsking(null)} />
      )}
      {asking === "key" && (
        <RekeyAsk
          left={room.keyLeft}
          busy={busy}
          onSave={async (key) => {
            const r = await run(() => changeSquadKey(key));
            if (r) setAsking(null);
          }}
          onNo={() => setAsking(null)}
        />
      )}
    </Sheet>
  );
}

// ---- calling others in ----

/**
 * Whom to invite: your 触须之交 who may come, ticked; each with the server of their 资料's UID (another than the room's
 * said, and last: TA may play on another account) and how many more times today; those in it or invited already
 * can't be ticked.
 */
function InvitePicker({
  room,
  busy,
  onSend,
  onError,
  onClose,
}: {
  room: SquadRoom;
  busy: boolean;
  onSend: (picked: string[]) => void;
  onError: (e: unknown) => void;
  onClose: () => void;
}) {
  const [friends, setFriends] = useState<SquadFriend[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    loadSquadFriends().then(
      (f) => {
        if (alive) setFriends(f);
      },
      (e: unknown) => {
        if (!alive) return;
        setFriends([]);
        onError(e);
      },
    );
    return () => {
      alive = false;
    };
    // once, as it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="sq-ask-bg" onClick={onClose}>
      <div className="sq-ask sq-pick sq-inv" role="dialog" aria-modal="true" aria-label={T.squad.call.inviteTitle} onClick={(e) => e.stopPropagation()}>
        <h3>{T.squad.call.inviteTitle}</h3>
        <p className="hint">{T.squad.call.inviteNote}</p>
        <div className="friends">
          {!friends ? (
            <p className="hint">{T.squad.call.loading}</p>
          ) : !friends.length ? (
            <p className="hint">{T.squad.call.none}</p>
          ) : (
            friends.map((f) => {
              const other = f.server !== "" && f.server !== room.server;
              const where = f.server === "" ? T.squad.call.noUid : other ? fmt(T.squad.call.otherServer, { server: srv(f.server) }) : srv(f.server);
              const state = f.inRoom ? T.squad.call.inRoom : f.waiting ? T.squad.call.waiting : null;
              const on = picked.includes(f.id);
              return (
                <div key={f.id} className={`sq-friend${other ? " other" : ""}`}>
                  <span className="av" aria-hidden="true">
                    <RoachIcon color={f.card.color as RoachColor} avatar={f.card.avatar as RoachAvatar} size={28} />
                  </span>
                  <span className="nm">
                    {f.card.displayName}
                    <small>{state ? `${where}${T.squad.dot}${state}` : where}</small>
                  </span>
                  <button
                    className={`small${on ? " dark" : ""}`}
                    disabled={busy || f.inRoom || f.waiting}
                    aria-pressed={on}
                    onClick={() => toggle(f.id)}
                  >
                    {on ? T.squad.call.picked : T.squad.call.pick}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="row">
          <button className="dark grow" disabled={busy || !picked.length} onClick={() => onSend(picked)}>
            {fmt(T.squad.call.send, { n: picked.length })}
          </button>
          <button className="ghost" onClick={onClose}>
            {T.squad.call.close}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 宣言招人: what goes out to whom, and from which of your roaches (your main one picked to begin with) */
function DeclareAsk({
  roaches,
  ink,
  need,
  busy,
  onSend,
  onNo,
}: {
  roaches: OwnRoach[];
  ink: boolean;
  need: number;
  busy: boolean;
  onSend: (from: string[] | null) => void;
  onNo: () => void;
}) {
  const main = roaches.find((r) => r.slot === 0);
  const clones = roaches.filter((r) => r.slot > 0);
  const many = clones.length > 0 || ink;
  const [from, setFrom] = useState<string[]>(() => (main ? [main.id] : []));
  const toggle = (id: string) => setFrom((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const chip = (id: string, label: ReactNode) => (
    <button key={id} type="button" className={`chip${from.includes(id) ? " on" : ""}`} aria-pressed={from.includes(id)} onClick={() => toggle(id)}>
      {label}
    </button>
  );
  return (
    <Ask title={T.squad.call.declareTitle} onNo={onNo}>
      <p>{fmt(T.squad.call.declareFrom, { km: DECLARATION_RADIUS_KM, n: need })}</p>
      {many && (
        <div className="chips" role="group" aria-label={T.declare.from}>
          {main && chip(main.id, T.common.main)}
          {clones.map((c, i) => chip(c.id, fmtParts(T.common.cloneN, { n: i + 1 })))}
          {ink && chip(INK_FROM, T.common.ink)}
        </div>
      )}
      <p className="sq-ask-sub">{fmt(T.squad.call.declareNote, { d: DECLARATIONS_PER_DAY })}</p>
      <div className="row">
        <button className="dark grow" disabled={busy || (many && !from.length)} onClick={() => onSend(many ? from : null)}>
          {T.squad.call.declareSend}
        </button>
        <button className="ghost" disabled={busy} onClick={onNo}>
          {T.squad.call.declareNot}
        </button>
      </div>
    </Ask>
  );
}

function RekeyAsk({ left, busy, onSave, onNo }: { left: number; busy: boolean; onSave: (key: string) => void; onNo: () => void }) {
  const [pasted, setPasted] = useState("");
  const key = findKey(pasted);
  return (
    <Ask title={T.squad.room.rekeyTitle} onNo={onNo}>
      <p className="hint">{left > 0 ? fmt(T.squad.room.rekeyLeft, { n: left }) : T.squad.room.rekeyNone}</p>
      <input
        className="code"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label={T.squad.open.key}
        placeholder={fmt(T.squad.open.keyHint, { n: 14 })}
        value={pasted}
        maxLength={200}
        onChange={(e) => setPasted(e.target.value)}
      />
      {pasted.trim() !== "" && (key ? <p className="ok">{T.squad.open.keyOk}</p> : <p className="err">{T.squad.open.keyBad}</p>)}
      <div className="row">
        <button className="dark grow" disabled={busy || !key || left <= 0} onClick={() => key && onSave(key)}>
          {T.squad.room.rekeySave}
        </button>
        <button className="ghost" onClick={onNo}>
          {T.squad.room.endNo}
        </button>
      </div>
    </Ask>
  );
}

/**
 * One in the room, as a tile: the roach, the name (房主, 你, 触须之交), the core alliance and the strategy (your own
 * tapped to change them for this room), and whether they are ready (准备). Another's tile, tapped, opens what can be
 * done to TA, and the host's 请出去 sits in its corner.
 */
function MemberTile({
  m,
  art,
  open,
  onCore,
  onStrategy,
  onMenu,
  onKick,
}: {
  m: SquadMember;
  art: Art | null;
  open: boolean;
  onCore: () => void;
  onStrategy: () => void;
  onMenu: () => void;
  /** The host's 请出去, asked first */
  onKick?: () => void;
}) {
  return (
    <div className={`sq-tile${m.you ? " you" : ""}${open ? " open" : ""}`}>
      {!m.you && <button type="button" className="hit" aria-label={m.name} aria-expanded={open} onClick={onMenu} />}
      <RoachIcon color={m.color as RoachColor} avatar={m.avatar as RoachAvatar} size={44} />
      <span className="nm">
        {m.name}
        {m.you && <small>{T.squad.room.you}</small>}
        {m.friend && <small className="fr">{T.squad.room.friend}</small>}
      </span>
      <span className="pk">
        <CoreBadge core={m.core} onClick={m.you ? onCore : undefined} />
        <StrategyPic id={m.strategy} art={art} onClick={m.you ? onStrategy : undefined} />
      </span>
      {onKick && (
        <button type="button" className="kick" onClick={onKick}>
          {T.squad.room.kick}
        </button>
      )}
      {m.host ? <span className="st host">{T.squad.room.host}</span> : m.inGame ? <span className="st ok">{T.squad.room.inGameTag}</span> : <span className="st">{T.squad.room.notReadyTag}</span>}
      {m.you && <small className="hint">{T.squad.room.tapToChange}</small>}
    </div>
  );
}

/** Your core alliance or strategy in this room alone (your card stays as it is) */
function PicksAsk({
  kind,
  me,
  art,
  busy,
  onPick,
  onClose,
}: {
  kind: "core" | "strategy";
  me: SquadMember;
  art: Art | null;
  busy: boolean;
  onPick: (p: Partial<SquadPicks>) => void;
  onClose: () => void;
}) {
  const title = kind === "core" ? T.squad.room.pickCore : T.squad.room.pickStrategy;
  return (
    <div className="sq-ask-bg" onClick={onClose}>
      <div className="sq-ask sq-pick" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="hint">{T.squad.room.editNote}</p>
        <div className="songs">
          {kind === "core" ? (
            <CoreChips value={me.core} onPick={(core) => !busy && onPick({ core })} />
          ) : (
            <StrategyGrid value={me.strategy} core={me.core} art={art} onPick={(strategy) => !busy && onPick({ strategy })} />
          )}
        </div>
        <div className="row">
          <button className="ghost grow" onClick={onClose}>
            {T.squad.call.close}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The set lines and what the site says, floating over the room a few seconds each */
function Floats() {
  const floats = useSquadFloats();
  return (
    <div className="sq-floats" aria-live="polite">
      {floats.map((f) => (
        <span key={f.key} className={`sq-float${f.sys ? " sys" : ""}`}>
          {f.text}
        </span>
      ))}
    </div>
  );
}

/** The set lines, a row at a time, sent by number; a moment's rest after each. 听歌's row only while the host's songs play */
function Dock({ music }: { music: boolean }) {
  const [row, setRow] = useState<PhraseRow>("team");
  const [cool, setCool] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const say = async (p: number) => {
    if (cool) return;
    setCool(true);
    window.setTimeout(() => setCool(false), SAY_EVERY_MS);
    try {
      const res = await sayInSquad(p);
      if (!res.sent) setNote(res.full ? T.squad.say.enough : T.squad.say.slow);
      else setNote(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : T.requests.serverTrouble);
    }
  };
  const rows = PHRASE_ROWS.filter(([r]) => r !== "music" || music);
  const ids = (rows.find(([r]) => r === row) ?? rows[0])[1];
  return (
    <div className="sq-dock">
      <div className="dt" role="tablist">
        {rows.map(([r]) => (
          <button key={r} role="tab" aria-selected={r === row} className={r === row ? "on" : ""} onClick={() => setRow(r)}>
            {T.squad.say.rows[r]}
          </button>
        ))}
        <small>{note ?? T.squad.say.hint}</small>
      </div>
      <div className="say">
        {ids.map((p) => (
          <button key={p} disabled={cool} onClick={() => void say(p)}>
            {T.squad.say.lines[p - 1]}
          </button>
        ))}
      </div>
    </div>
  );
}

// for the page's own bar over the map, and the tests
export { RoomCard, SeatTile };
export type { SquadMember };
