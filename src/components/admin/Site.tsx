"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { BADGES, type Badge } from "@/lib/badges";
import { GRAY_MAX_DAYS, grayUntilWords, type GrayState } from "@/lib/adminConsole";
import { addDays, beijingDate, beijingDayWords, beijingMidnight, beijingShort } from "@/lib/beijing";
import { CAP_RANGE, ROOM_RANGE, type ListenDesk } from "@/lib/listen";
import type { SquadDesk } from "@/lib/squad";
import { memorialWords } from "@/lib/memorials";
import { CODE_WORDS, type NameWord } from "@/lib/nameRules";
import { RULES, type BanInfo } from "@/lib/safety";
import { lasted, LEVEL_MARK, mainlandWords, type IncidentView, type SiteStatus } from "@/lib/siteStatus";
import { ago } from "../app/InboxSheet";
import { errorWords } from "./api";
import { useConsole } from "./context";
import SponsorPanel from "./Sponsor";
import { PanelHead } from "./ui";
import { joinedWords, ruleWords } from "./words";

/**
 * 网站和工具: what the site's own checks found (网站状态), the name blocklist, whether an email was banned,
 * badges by hand, and 支持舟P地图 (Sponsor.tsx). The same tools as before, in the 管理台's panels; this week's
 * people moved to 数据看板 (People.tsx). A moderator has only the name blocklist (the rest is the owner's: OWNER_ONLY).
 */
export default function Site() {
  const { gate } = useConsole();
  const owner = gate.role === "owner";
  const [wordsAdded, setWordsAdded] = useState(0);
  return (
    <div className="ac-site">
      {owner && <GrayPanel />}
      {owner && <ListenPanel />}
      {owner && <SquadPanel />}
      {owner && <SiteStatusPanel />}
      <NameList added={wordsAdded} onAdded={() => setWordsAdded((n) => n + 1)} />
      {owner && <BanLookup />}
      {owner && <BadgeDesk />}
      {owner && <SponsorPanel />}
    </div>
  );
}

type GrayPick = "today" | "tomorrow" | "own";
const GRAY_PICKS: { pick: GrayPick; label: string }[] = [
  { pick: "today", label: "今天 24:00" },
  { pick: "tomorrow", label: "明天 24:00" },
  { pick: "own", label: "自己选" },
];
/** A moment as a datetime-local value, in Beijing time */
const beijingLocal = (t: number) => new Date(t + 8 * 3_600_000).toISOString().slice(0, 16);

/**
 * 全站变灰 (src/lib/server/siteSettings.ts), the owner's: everyone's 舟P in gray until a time, Beijing time, for a
 * national day of mourning; or back to colour now. The 管理台 itself never turns gray. The next day of remembrance
 * only reminds: the site never turns gray by itself.
 */
function GrayPanel() {
  const { call, say } = useConsole();
  const [s, setS] = useState<GrayState | null>(null);
  const [pick, setPick] = useState<GrayPick>("today");
  const [own, setOwn] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    call<GrayState>("gray")
      .then(setS)
      .catch((e) => setNote(`读不出来：${errorWords(e)}`));
    // the time passing: an end reached shows itself, and 「今天」 stays today
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [call]);

  const today = beijingDate(now);
  const until =
    pick === "today"
      ? beijingMidnight(addDays(today, 1))
      : pick === "tomorrow"
        ? beijingMidnight(addDays(today, 2))
        : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(own)
          ? Date.parse(`${own}:00+08:00`)
          : NaN;
  const fits = until > now && until <= now + GRAY_MAX_DAYS * 86_400_000;

  const step = async (op: "setGray" | "endGray") => {
    setBusy(true);
    try {
      const next = await call<GrayState>(op, op === "setGray" ? [{ until }] : []);
      setS(next);
      setAsking(false);
      setNote(null);
      say(next.until ? `全站变灰了，到 ${grayUntilWords(next.until, Date.now())} 自动恢复。` : "全站恢复颜色了。");
    } catch (e) {
      setNote(errorWords(e));
    }
    setBusy(false);
  };

  const on = s?.until && s.until > now ? s.until : null;
  return (
    <section className="ac-panel ac-tool wide" aria-label="全站变灰">
      <PanelHead title="全站变灰" aside="只有站长" />
      <p className="ac-sub">
        国家宣布全国哀悼日的时候用。打开以后，所有人看到的舟P都是黑白的，地图也换成灰色；已经开着的页面最多 2 分钟内跟着变。管理台自己不变灰，方便你看。
      </p>
      {!s ? (
        <p className="ac-sub">{note ?? "正在读取…"}</p>
      ) : on ? (
        <>
          <div className="ac-status-line">
            <span className="ac-dot gray" aria-hidden="true" />
            <strong>整站正在变灰，到 {grayUntilWords(on, now)} 自动恢复</strong>
          </div>
          <div>
            <button type="button" className="ac-btn" disabled={busy} onClick={() => step("endGray")}>
              现在就恢复
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="ac-status-line">
            <span className="ac-dot" aria-hidden="true" />
            <strong>现在没有变灰</strong>
          </div>
          <div className="ac-field">
            <span className="ac-label" id="gray-until">
              到什么时候自动恢复（北京时间）
            </span>
            <div className="ac-chips" role="group" aria-labelledby="gray-until">
              {GRAY_PICKS.map((o) => (
                <button
                  key={o.pick}
                  type="button"
                  className="ac-chip solid"
                  aria-pressed={pick === o.pick}
                  disabled={busy}
                  onClick={() => {
                    setPick(o.pick);
                    setAsking(false);
                    if (o.pick === "own" && !own) setOwn(beijingLocal(beijingMidnight(addDays(today, 1))));
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {pick === "own" && (
              <label className="ac-inline-label">
                恢复时间
                <input
                  type="datetime-local"
                  value={own}
                  min={beijingLocal(now)}
                  max={beijingLocal(now + GRAY_MAX_DAYS * 86_400_000)}
                  onChange={(e) => {
                    setOwn(e.target.value);
                    setAsking(false);
                  }}
                />
              </label>
            )}
            {pick === "own" && own && !fits && <p className="ac-error">恢复时间要在现在到 {GRAY_MAX_DAYS} 天以内。</p>}
          </div>
          {asking && fits ? (
            <div className="ac-confirm" role="alert">
              <span>所有人的舟P都会变成黑白的，到 {grayUntilWords(until, now)} 自动恢复。确定吗？</span>
              <button type="button" className="ac-btn small primary" disabled={busy} onClick={() => step("setGray")}>
                确认变灰
              </button>
              <button type="button" className="ac-btn small" disabled={busy} onClick={() => setAsking(false)}>
                先不变
              </button>
            </div>
          ) : (
            <div>
              <button type="button" className="ac-btn primary" disabled={busy || !fits} onClick={() => setAsking(true)}>
                现在变灰
              </button>
            </div>
          )}
        </>
      )}
      {s && note && <p className="ac-error">{note}</p>}
      <p className="ac-muted small">变灰的时候：新称号的彩纸等恢复了再放，阿米娅跳舞和舟友的酒都不放音乐，别的照常。</p>
      {s && <p className="ac-muted small">{memorialWords(s.memorial)}纪念日只在这里提醒你，不会自己变灰。</p>}
    </section>
  );
}

/**
 * 听歌 (src/lib/server/listen.ts), the owner's: whether LISTEN lets anyone in, how many listen now against the cap,
 * today's songs and the players turned away because it was full, and the catalogue the main process read in. Pausing
 * stops it for everyone at once, with no release: no new song plays, and the files stop going out.
 */
function ListenPanel() {
  const { call, say } = useConsole();
  const [d, setD] = useState<ListenDesk | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [cap, setCap] = useState("");
  const [roomMax, setRoomMax] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () =>
      call<ListenDesk>("listen")
        .then((x) => {
          if (!alive) return;
          setD(x);
          setNote(null);
          setCap((c) => c || String(x.settings.cap));
          setRoomMax((c) => c || String(x.settings.roomMax));
        })
        .catch((e) => {
          if (alive) setNote(`读不出来：${errorWords(e)}`);
        });
    void load();
    // how many listen now, every half minute while it is in sight
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [call]);

  const change = async (what: { paused?: boolean; cap?: number; roomMax?: number }, done: string) => {
    setBusy(true);
    try {
      const next = await call<ListenDesk>("setListen", [what]);
      setD(next);
      setCap(String(next.settings.cap));
      setRoomMax(String(next.settings.roomMax));
      setAsking(false);
      setNote(null);
      say(done);
    } catch (e) {
      setNote(errorWords(e));
    }
    setBusy(false);
  };

  const capN = Number(cap);
  const capFits = Number.isInteger(capN) && capN >= CAP_RANGE[0] && capN <= CAP_RANGE[1];
  const roomN = Number(roomMax);
  const roomFits = Number.isInteger(roomN) && roomN >= ROOM_RANGE[0] && roomN <= ROOM_RANGE[1];
  const when = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? beijingShort(Date.parse(iso)) : "—");
  return (
    <section className="ac-panel ac-tool wide" aria-label="听歌">
      <PanelHead title="听歌" aside="只有站长" />
      <p className="ac-sub">
        站里放塞壬唱片官网上方舟的歌。出事的时候先在这里点「暂停听歌」，马上对所有人生效，不用发版：谁都不能再放新的歌，歌文件也不再发出去，正在放的那首可能放不完，一起听的场都结束。
      </p>
      {!d ? (
        <p className="ac-sub">{note ?? "正在读取…"}</p>
      ) : (
        <>
          <div className="ac-status-line">
            <span className={`ac-dot${d.mode === "off" ? " gray" : d.settings.paused ? " yellow" : ""}`} aria-hidden="true" />
            <strong>
              {d.mode === "off"
                ? "开关是关的（LISTEN=off）：谁都看不到听歌"
                : d.settings.paused
                  ? "听歌暂停了：谁都放不了"
                  : d.mode === "admins"
                    ? "听歌开着，只有站长和管理员看得到（LISTEN=admins）"
                    : "听歌开着，所有登录的舟P都能听（LISTEN=on）"}
            </strong>
          </div>
          <div className="ac-stats">
            <div className="ac-stat">
              <div className="ac-muted small">现在在听</div>
              <div className="ac-stat-n">{d.listening} 人</div>
              <div className="ac-muted small">上限 {d.settings.cap} 人</div>
            </div>
            <div className="ac-stat">
              <div className="ac-muted small">一起听</div>
              <div className="ac-stat-n">{d.rooms} 场</div>
              <div className="ac-muted small">一场最多 {d.settings.roomMax} 人</div>
            </div>
            <div className="ac-stat">
              <div className="ac-muted small">今天放了</div>
              <div className="ac-stat-n">{d.plays} 首</div>
              <div className="ac-muted small">从头放的才算，每分钟更新</div>
            </div>
            <div className={`ac-stat${d.full ? " warn" : ""}`}>
              <div className="small">今天满了被挡</div>
              <div className="ac-stat-n">{d.full} 次</div>
              <div className={d.full ? "small" : "ac-muted small"}>常有就该调高上限，或者问要不要买专门放歌的服务器</div>
            </div>
            <div className="ac-stat">
              <div className="ac-muted small">歌单</div>
              <div className="ac-stat-n">{d.songs} 首</div>
              <div className="ac-muted small">
                {d.catalog ? `官网的歌 ${when(d.catalog.updated)} 下好，${when(d.catalog.readAt)} 读进来` : "还没读到歌单（服务器上的 music/catalog.json）"}
              </div>
            </div>
          </div>
          {d.settings.paused ? (
            <div>
              <button type="button" className="ac-btn primary" disabled={busy} onClick={() => change({ paused: false }, "听歌恢复了。")}>
                恢复听歌
              </button>
            </div>
          ) : asking ? (
            <div className="ac-confirm" role="alert">
              <span>所有人都不能再放歌，正在放的那首也可能停下，一起听的场都会结束。确定吗？</span>
              <button type="button" className="ac-btn small primary" disabled={busy} onClick={() => change({ paused: true }, "听歌暂停了。")}>
                确认暂停
              </button>
              <button type="button" className="ac-btn small" disabled={busy} onClick={() => setAsking(false)}>
                先不停
              </button>
            </div>
          ) : (
            <div>
              <button type="button" className="ac-btn" disabled={busy} onClick={() => setAsking(true)}>
                暂停听歌
              </button>
            </div>
          )}
          <form
            className="ac-inline-form ac-num-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (capFits && capN !== d.settings.cap) void change({ cap: capN }, `同时在听上限改成 ${capN} 人了。`);
            }}
          >
            <label className="ac-inline-label">
              同时在听上限
              <input
                type="number"
                inputMode="numeric"
                min={CAP_RANGE[0]}
                max={CAP_RANGE[1]}
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                aria-describedby="listen-cap-why"
              />
              人
            </label>
            <button className="ac-btn" type="submit" disabled={busy || !capFits || capN === d.settings.cap}>
              改上限
            </button>
          </form>
          {cap && !capFits && <p className="ac-error">上限要是 {CAP_RANGE[0]} 到 {CAP_RANGE[1]} 之间的整数。</p>}
          <p className="ac-muted small" id="listen-cap-why">
            到了上限，没在听的人点歌会看到「听歌的人有点多，过几分钟再来」；已经在听的人照常换歌。每人约 12 KB/秒，600 人约 58 Mbps，两台服务器分着出。
          </p>
          <form
            className="ac-inline-form ac-num-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (roomFits && roomN !== d.settings.roomMax) void change({ roomMax: roomN }, `一起听一场最多改成 ${roomN} 人了。`);
            }}
          >
            <label className="ac-inline-label">
              一起听一场最多
              <input
                type="number"
                inputMode="numeric"
                min={ROOM_RANGE[0]}
                max={ROOM_RANGE[1]}
                value={roomMax}
                onChange={(e) => setRoomMax(e.target.value)}
                aria-describedby="listen-room-why"
              />
              人
            </label>
            <button className="ac-btn" type="submit" disabled={busy || !roomFits || roomN === d.settings.roomMax}>
              改人数
            </button>
          </form>
          {roomMax && !roomFits && <p className="ac-error">一场最多几人要是 {ROOM_RANGE[0]} 到 {ROOM_RANGE[1]} 之间的整数。</p>}
          <p className="ac-muted small" id="listen-room-why">
            发起人也算在里面。改小了，已经在场里的人不会被请出去，只是满了以后进不来。人多了短评会刷屏。
          </p>
        </>
      )}
      {d && note && <p className="ac-error">{note}</p>}
    </section>
  );
}

/** The line the list shows while 一起卫戍 is closed, at most this long (siteSettings.ts SQUAD_NOTE_MAX) */
const SQUAD_NOTE_MAX = 60;

/**
 * 一起卫戍 (src/lib/server/squad.ts), the owner's: whether SQUAD lets anyone in, the rooms open now, and today's rooms,
 * comings in and set lines. 暂时关门 (as when the game's season is between parts and no alliance can be made) ends every
 * room at once and shows the owner's line on the list until it opens again.
 */
function SquadPanel() {
  const { call, say } = useConsole();
  const [d, setD] = useState<SquadDesk | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      call<SquadDesk>("squad")
        .then((x) => {
          if (!alive) return;
          setD(x);
          setNote(null);
          setLine((l) => l ?? x.note);
        })
        .catch((e) => {
          if (alive) setNote(`读不出来：${errorWords(e)}`);
        });
    void load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [call]);

  const change = async (what: { closed?: boolean; note?: string }, done: string) => {
    setBusy(true);
    try {
      const next = await call<SquadDesk>("setSquad", [what]);
      setD(next);
      setLine(next.note);
      setAsking(false);
      setNote(null);
      say(done);
    } catch (e) {
      setNote(errorWords(e));
    }
    setBusy(false);
  };

  const text = (line ?? "").trim();
  return (
    <section className="ac-panel ac-tool wide" aria-label="一起卫戍">
      <PanelHead title="一起卫戍" aside="只有站长" />
      <p className="ac-sub">
        卫戍协议找人组队的房间。游戏进修订期、游戏里组不了队的时候，在这里点「暂时关门」：开着的房间马上全部结束，列表上显示你写的那句提示，谁都开不了、进不了，直到你点「重新开门」。
      </p>
      {!d ? (
        <p className="ac-sub">{note ?? "正在读取…"}</p>
      ) : (
        <>
          <div className="ac-status-line">
            <span className={`ac-dot${d.mode === "off" ? " gray" : d.closed ? " yellow" : ""}`} aria-hidden="true" />
            <strong>
              {d.mode === "off"
                ? "开关是关的（SQUAD=off）：谁都看不到一起卫戍"
                : d.closed
                  ? "一起卫戍暂时关门了：谁都开不了、进不了"
                  : d.mode === "admins"
                    ? "一起卫戍开着，只有站长和管理员看得到（SQUAD=admins）"
                    : "一起卫戍开着，所有登录的舟P都能用（SQUAD=on）"}
            </strong>
          </div>
          <div className="ac-stats">
            <div className="ac-stat">
              <div className="ac-muted small">现在开着</div>
              <div className="ac-stat-n">{d.waiting + d.playing} 个房间</div>
              <div className="ac-muted small">
                等人 {d.waiting} 个，开打 {d.playing} 个
              </div>
            </div>
            <div className="ac-stat">
              <div className="ac-muted small">今天开了</div>
              <div className="ac-stat-n">{d.opened} 个房间</div>
              <div className="ac-muted small">北京时间，每分钟更新</div>
            </div>
            <div className="ac-stat">
              <div className="ac-muted small">今天进了</div>
              <div className="ac-stat-n">{d.joins} 次</div>
              <div className="ac-muted small">房主自己不算</div>
            </div>
            <div className="ac-stat">
              <div className="ac-muted small">今天放的歌</div>
              <div className="ac-stat-n">{d.plays} 首</div>
              <div className="ac-muted small">房主点开始、下一首、重来才算</div>
            </div>
            <div className="ac-stat">
              <div className="ac-muted small">今天的快捷语句</div>
              <div className="ac-stat-n">{d.says} 句</div>
              <div className="ac-muted small">只记一共几句，不记谁说的</div>
            </div>
          </div>
          {d.closed ? (
            <div>
              <button type="button" className="ac-btn primary" disabled={busy} onClick={() => change({ closed: false }, "一起卫戍重新开门了。")}>
                重新开门
              </button>
            </div>
          ) : asking ? (
            <div className="ac-confirm" role="alert">
              <span>开着的房间都会马上结束，里面的人会看到「一起卫戍暂时关门，房间结束了」。确定吗？</span>
              <button type="button" className="ac-btn small primary" disabled={busy} onClick={() => change({ closed: true, note: text }, "一起卫戍暂时关门了。")}>
                确认关门
              </button>
              <button type="button" className="ac-btn small" disabled={busy} onClick={() => setAsking(false)}>
                先不关
              </button>
            </div>
          ) : (
            <div>
              <button type="button" className="ac-btn" disabled={busy} onClick={() => setAsking(true)}>
                暂时关门
              </button>
            </div>
          )}
          <form
            className="ac-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (text !== d.note && text.length <= SQUAD_NOTE_MAX) void change({ note: text }, text ? "提示改好了。" : "提示去掉了。");
            }}
          >
            <label className="ac-inline-label">
              关门时的提示
              <input
                value={line ?? ""}
                maxLength={SQUAD_NOTE_MAX}
                placeholder="比如：序列Ⅱ开放后再见"
                onChange={(e) => setLine(e.target.value)}
                aria-describedby="squad-note-why"
              />
            </label>
            <button className="ac-btn" type="submit" disabled={busy || text === d.note}>
              存提示
            </button>
          </form>
          <p className="ac-muted small" id="squad-note-why">
            最多 {SQUAD_NOTE_MAX} 个字，关门时显示在列表上；不写就显示「一起卫戍暂时关门了，过一阵再来。」
          </p>
        </>
      )}
      {d && note && <p className="ac-error">{note}</p>}
    </section>
  );
}

const clock = (t: number) => beijingShort(t).split(" ")[1];
const percent = (x: number) => `${Math.round(x * 100)}%`;
const gigabytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const megabytes = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`;

const MAIL_KINDS: Record<string, string> = { urgent: "要你看", recovered: "已恢复", digest: "每日汇总", report: "举报", skipped: "超上限没发" };

/** Whether and how the owner was told of an incident */
function toldWords(i: IncidentView) {
  if (i.mailedAt) return `${beijingShort(i.mailedAt)} 发过邮件${i.recoveredMailedAt ? `，${beijingShort(i.recoveredMailedAt)} 发过「已恢复」` : ""}`;
  if (i.skippedAt) return "超过当天的上限，没发邮件";
  if (i.level === "urgent") return i.ackedAt ? "你点了知道了，不发邮件" : "邮件还没发出去";
  return i.level === "daily" ? "只进每天的汇总" : "只记在这里";
}

function outcome(i: IncidentView) {
  if (i.endedAt) return i.ackedAt ? "你点了知道了，后来好了" : "自己好了";
  return i.ackedAt ? "你点了知道了，还没好" : "还没好";
}

/** 网站状态: whether anything is wrong now, the last seven days, a few figures and the alert emails; read again every minute */
function SiteStatusPanel() {
  const { call } = useConsole();
  const [s, setS] = useState<SiteStatus | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => {
    call<SiteStatus>("status")
      .then((x) => {
        setS(x);
        setNote(null);
      })
      .catch((e) => setNote(errorWords(e)));
  }, [call]);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [load]);
  const ack = async (id: string) => {
    setBusy(true);
    try {
      await call("ack", [id]);
      load();
    } catch (e) {
      setNote(errorWords(e));
    }
    setBusy(false);
  };

  if (!s) {
    return (
      <section className="ac-panel ac-tool wide" aria-label="网站状态">
        <PanelHead title="网站状态" aside="只有站长" />
        <p className="ac-sub">{note ? `读不出来：${note}` : "正在读取…"}</p>
      </section>
    );
  }
  const pressing = s.open.filter((i) => i.level !== "quiet").length;
  const stale = s.lastRound === null || s.now - s.lastRound > 15 * 60_000;
  const days = new Map<string, IncidentView[]>();
  for (const i of s.week.filter((x) => all || x.level !== "quiet")) {
    const day = beijingShort(i.startedAt).split(" ")[0];
    days.set(day, [...(days.get(day) ?? []), i]);
  }
  const doors = s.open.find((i) => i.key.startsWith("doors."));
  const n = s.numbers;
  return (
    <section className="ac-panel ac-tool wide" aria-label="网站状态">
      <PanelHead title="网站状态" aside="只有站长" />
      <div className="ac-status-line">
        <span className={`ac-dot${s.open.length ? (pressing ? " red" : " yellow") : ""}`} aria-hidden="true" />
        <strong>{s.open.length ? `现在有 ${s.open.length} 个问题，其中 ${pressing} 个要你处理` : "现在一切正常"}</strong>
        <span className={stale ? "ac-stale" : "ac-muted small"}>
          {s.lastRound === null ? "自查还没跑过" : stale ? `自查停了：上次是 ${ago(s.lastRound, s.now)}` : `自查：${ago(s.lastRound, s.now)}`}
        </span>
      </div>
      {note && <p className="ac-error">{note}</p>}
      {s.open.map((i) => (
        <div key={i.id} className="ac-incident">
          <div>
            <strong>
              {LEVEL_MARK[i.level]} {i.title}
            </strong>
            {i.times > 1 && <span className="ac-muted small">（合并了 {i.times} 次）</span>}
          </div>
          <div className="ac-muted small">
            从 {beijingShort(i.startedAt)} 开始，已经 {lasted(s.now - i.startedAt)} · {toldWords(i)}
          </div>
          {i.detail && <div>{i.detail}</div>}
          {i.advice && <div className="ac-muted small">怎么办：{i.advice}</div>}
          {i.level !== "quiet" &&
            (i.ackedAt ? (
              <div className="ac-muted small">你 {beijingShort(i.ackedAt)} 已经知道了，不再为它发邮件。</div>
            ) : (
              <div>
                <button type="button" className="ac-btn small" disabled={busy} onClick={() => ack(i.id)}>
                  知道了
                </button>
              </div>
            ))}
        </div>
      ))}

      <details className="ac-details">
        <summary>最近 7 天、几个数、发过的报警邮件</summary>
        <label className="ac-check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          也看只记录的（⚪）
        </label>
        {days.size === 0 && <p className="ac-muted small">最近 7 天没有。</p>}
        {[...days].map(([day, list]) => (
          <Fragment key={day}>
            <h4>{day}</h4>
            <ul className="ac-plain-list">
              {list.map((i) => (
                <li key={i.id}>
                  {LEVEL_MARK[i.level]} {clock(i.startedAt)}–{i.endedAt ? clock(i.endedAt) : "现在"} {i.title}
                  <span className="ac-muted small">
                    {" "}
                    · {outcome(i)}
                    {i.times > 1 && ` · 合并了 ${i.times} 次`}
                    {i.worst && ` · ${i.worst}`}
                  </span>
                </li>
              ))}
            </ul>
          </Fragment>
        ))}
        <h4>几个数</h4>
        <ul className="ac-plain-list">
          <li>
            验证码邮件：过去 24 小时 {n.loginMails} 封，上限 {n.mailLimit} 封
          </li>
          {n.disk && (
            <li>
              硬盘：用了 {percent(n.disk.used)}，还剩 {gigabytes(n.disk.free)}
            </li>
          )}
          <li>{n.memory ? `内存：还有 ${megabytes(n.memory.available)} 可用（一共 ${gigabytes(n.memory.total)}）` : "内存：这里读不到（只在服务器上有）"}</li>
          <li>
            CPU：最近 15 分钟平均负载 {n.load.fifteen.toFixed(1)}（{n.load.cores} 核）
          </li>
          <li>第二台服务器：{doors ? `打不开（从 ${beijingShort(doors.startedAt)} 开始）` : "没有打不开的报警"}</li>
          <li>备份：{n.backup}</li>
          <li>证书：{n.tlsDays === null ? "这里不查（只在服务器上查）" : n.tlsDays < 0 ? "已经过期" : `还有 ${n.tlsDays} 天`}</li>
          <li>
            高德地图：这个月大约打开了 {n.amap.count.toLocaleString("en-US")} 次，上限 {n.amap.limit.toLocaleString("en-US")} 次；{mainlandWords(n.amap)}
          </li>
          {n.yesterday && (
            <li>
              昨天：新来 {n.yesterday.signups} 人，新结成 {n.yesterday.friendships} 对触须之交
            </li>
          )}
        </ul>
        <h4>发过的报警邮件</h4>
        {s.mails.length === 0 && <p className="ac-muted small">还没有。</p>}
        <ul className="ac-plain-list">
          {s.mails.map((m, k) => (
            <li key={k}>
              <span className="ac-muted small">
                {beijingShort(m.at)} · {MAIL_KINDS[m.kind] ?? m.kind}
              </span>{" "}
              {m.subject}
            </li>
          ))}
        </ul>
        <p className="ac-muted small">
          外面的检查：
          <a href="https://github.com/KFChitken/arknights_map/actions/workflows/uptime.yml" target="_blank" rel="noreferrer">
            每 10 分钟的在线检查
          </a>
          {" · "}
          <a href="https://github.com/KFChitken/arknights_map/actions/workflows/mainland-check.yml" target="_blank" rel="noreferrer">
            每天的内地访问检查
          </a>
        </p>
      </details>
      <p className="ac-hint">要紧的马上发邮件，其余北京 9 点汇总。「知道了」以后不再为它发邮件。</p>
    </section>
  );
}

type NameHit = { id: string; name: string; anonymous: boolean; held: boolean; word: string };
type NameListData = { total: number; found: number; words: NameWord[] };
type NameHits = { checked: number; count: number; hits: NameHit[] };

/**
 * 名字黑名单: the words no name may contain (or be, marked 「=」; 「~」 for its sound too), searchable since the list
 * runs to thousands; a box to try a name on it; and the names in use it blocks now, to clear with a 站长通知. Every
 * change goes into the 操作记录.
 */
function NameList({ added, onAdded }: { added: number; onAdded: () => void }) {
  const { call, say } = useConsole();
  const [list, setList] = useState<NameListData | null>(null);
  const [hits, setHits] = useState<NameHits | null>(null);
  // the hits not to clear: everything is picked until unticked
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [trial, setTrial] = useState("");
  const [verdict, setVerdict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ ids: string[]; what: string } | null>(null);
  const load = useCallback(
    (q: string) => {
      call<NameListData>("nameWords", [q])
        .then(setList)
        .catch((e) => say(errorWords(e)));
    },
    [call, say],
  );
  const loadHits = useCallback(() => {
    setHits(null);
    call<NameHits>("nameHits")
      .then((h) => {
        setHits(h);
        setKept(new Set());
      })
      .catch((e) => say(errorWords(e)));
  }, [call, say]);
  // a moment after typing stops, not on every key; and again when a case added a name
  useEffect(() => {
    const t = window.setTimeout(() => load(search), 300);
    return () => window.clearTimeout(t);
  }, [search, load, added]);
  useEffect(() => loadHits(), [loadHits, added]);
  useEffect(() => {
    if (!trial.trim()) {
      setVerdict(null);
      return;
    }
    const t = window.setTimeout(() => {
      call<{ word: string | null }>("testName", [trial])
        .then((r) => setVerdict(r.word ? `挡住了，命中「${r.word}」。` : "能用。"))
        .catch((e) => setVerdict(errorWords(e)));
    }, 300);
    return () => window.clearTimeout(t);
  }, [trial, call]);

  const run = async (fn: () => Promise<string>, reloadHits = true) => {
    setBusy(true);
    try {
      say(await fn());
      load(search);
      if (reloadHits) loadHits();
    } catch (e) {
      say(errorWords(e));
    }
    setBusy(false);
  };
  const add = () =>
    run(async () => {
      const n = await call<number>("addNameWords", [text]);
      setText("");
      onAdded();
      return `加好了 ${n} 个词。`;
    });
  const removeAll = () =>
    run(async () => {
      const n = await call<number>("removeNameWords", [text]);
      setText("");
      return `删掉了 ${n} 个词。`;
    });
  const remove = (w: NameWord) => run(async () => (await call("removeNameWord", [w.word]), `删掉了「${w.word}」。`));
  const picked = (hits?.hits ?? []).filter((h) => !h.held && !kept.has(h.id));
  const clear = (ids: string[]) => run(async () => `清掉了 ${await call<number>("clearNames", [ids])} 个名字，都发了站长通知。`);

  return (
    <section className="ac-panel ac-tool wide" aria-label="名字黑名单">
      <PanelHead title={`名字黑名单 · ${list?.total ?? "…"} 个词`} aside="管理员也能用" />
      <p className="ac-sub">
        存资料时名字里有这些词就存不上（前面带「=」的只在整个名字就是这个词时才挡，带「~」的连读音一样的也挡）。比对前名字和词都会洗一遍：去掉空格、符号和表情，全角转半角，英文转小写，繁体和异体字转简体，所以只加简体就够了。「~」只对三个字以上的词有用，常见人名读音撞得多，别给人名随便加。
      </p>
      <p className="ac-hint">
        写在代码里、这里删不了的：{CODE_WORDS.map((w) => (w.whole ? `=${w.word}` : w.word)).join("、")}；还有网址、QQ/微信号和 6 位以上的数字。
      </p>
      <div className="ac-two">
        <label className="ac-field">
          试一个名字
          <input type="search" value={trial} onChange={(e) => setTrial(e.target.value)} placeholder="比如 臺獨" />
          {verdict && <span className="ac-hint">{verdict}</span>}
        </label>
        <label className="ac-field">
          找词
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="输入要找的字" />
        </label>
      </div>
      {list && (
        <p className="ac-hint">
          {search.trim() ? `找到 ${list.found} 个` : "最新加的"}
          {list.found > list.words.length ? `，下面只列出前 ${list.words.length} 个` : ""}
        </p>
      )}
      {list && (
        <div className="ac-words">
          {list.words.map((w) => (
            <span key={w.word} className="ac-word">
              {w.whole ? `=${w.word}` : w.word}
              <button type="button" aria-label={`删掉 ${w.word}`} disabled={busy} onClick={() => remove(w)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <label className="ac-field">
        批量添加或删除（一行一个，前面加 = 表示整名比对，加 ~ 表示连读音一起挡）
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="ac-row">
        <button type="button" className="ac-btn primary" disabled={busy || !text.trim()} onClick={add}>
          加进黑名单
        </button>
        <button type="button" className="ac-btn danger" disabled={busy || !text.trim()} onClick={removeAll}>
          从黑名单删掉
        </button>
      </div>

      <h3 className="ac-h3">
        现在的名字里命中的{hits && ` · ${hits.count} 个（查了 ${hits.checked} 个名字）`}
      </h3>
      {!hits && <p className="ac-hint">正在查所有人的名字……</p>}
      {hits?.count === 0 && <p className="ac-hint">没有。</p>}
      {hits && hits.count > hits.hits.length && <p className="ac-hint">先列出前 {hits.hits.length} 个（别人看得到的排前面），清掉以后会接着列。</p>}
      {hits && hits.hits.length > 0 && (
        <>
          <p className="ac-hint">
            默认全选；觉得没问题的取消勾选。清掉后 TA 变成匿名，发过的「我是…」宣言也不再显示这个名字，消息里会收到站长通知（按「{RULES.name}」这一条），可以申诉；不记黄牌。
          </p>
          <div className="ac-hit-rows">
            {hits.hits.map((h) => (
              <label key={h.id} className="ac-hit">
                <input type="checkbox" disabled={h.held} checked={!h.held && !kept.has(h.id)} onChange={(e) => setKept((k) => {
                  const next = new Set(k);
                  if (e.target.checked) next.delete(h.id);
                  else next.add(h.id);
                  return next;
                })} />
                <strong>{h.name}</strong>
                <span className="ac-muted small">
                  命中「{h.word}」{h.held ? "（被举报了，名字先藏起来了，到「待处理」里处理）" : h.anonymous ? "（现在是匿名，别人看不到这个名字）" : ""}
                </span>
                <button
                  type="button"
                  className="ac-btn small"
                  disabled={busy || h.held}
                  onClick={(e) => {
                    // not the label's tick
                    e.preventDefault();
                    setConfirm({ ids: [h.id], what: `「${h.name}」这个名字` });
                  }}
                >
                  清掉
                </button>
              </label>
            ))}
          </div>
          {confirm ? (
            <div className="ac-confirm">
              <span>清掉{confirm.what}，把 TA 们改成匿名？每人会在消息里收到站长通知，可以申诉；不记黄牌。</span>
              <button
                type="button"
                className="ac-btn danger-solid small"
                disabled={busy}
                onClick={() => {
                  const ids = confirm.ids;
                  setConfirm(null);
                  void clear(ids);
                }}
              >
                确认清掉
              </button>
              <button type="button" className="ac-btn small" onClick={() => setConfirm(null)}>
                算了
              </button>
            </div>
          ) : (
            <div className="ac-row">
              <button type="button" className="ac-btn danger" disabled={busy || !picked.length} onClick={() => setConfirm({ ids: picked.map((h) => h.id), what: `勾选的 ${picked.length} 个名字` })}>
                清掉勾选的 {picked.length} 个名字
              </button>
              <button type="button" className="ac-btn" disabled={busy} onClick={loadHits}>
                再查一遍
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** 查邮箱: whether a mailbox was banned, however it is written, when and why; and who signs in with that very address */
function BanLookup() {
  const { call } = useConsole();
  const [email, setEmail] = useState("");
  const [info, setInfo] = useState<BanInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const look = async () => {
    setBusy(true);
    try {
      setInfo(await call<BanInfo>("banInfo", [email]));
      setNote(null);
    } catch (e) {
      setInfo(null);
      setNote(errorWords(e));
    }
    setBusy(false);
  };
  return (
    <section className="ac-panel ac-tool" aria-label="查邮箱">
      <PanelHead title="查邮箱封没封过" aside="只有站长" />
      <p className="ac-sub">加了「+」的、Gmail 加了点的，都算同一个邮箱。每次查都记进操作记录（邮箱打码）。</p>
      <form
        className="ac-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) void look();
        }}
      >
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" aria-label="要查的邮箱" />
        <button className="ac-btn" type="submit" disabled={busy || !email.trim()}>
          查
        </button>
      </form>
      {note && <p className="ac-error">{note}</p>}
      {info && (
        <div className="ac-result">
          <strong>{info.banned ? `封过：${beijingDayWords(info.banned.at)}，按「${ruleWords(info.banned.reason)}」` : "没封过"}</strong>
          {info.accounts.length === 0 ? (
            <div className="ac-muted small">现在没有账号用这个邮箱。</div>
          ) : (
            info.accounts.map((p) => (
              <div key={p.id} className="small">
                {p.name || "（没有名字）"}
                {p.anonymous ? "（匿名）" : ""} · {p.email} · {joinedWords(p.joinedAt)} · ID {p.id.slice(0, 8)}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The badges given by hand: 内测功臣, and the thanks for sponsoring to a sponsor who wrote their login email in the
 * payment's note, both of them at once. Any badge can be taken back, from someone gaming it or a refunded sponsor.
 */
function BadgeDesk() {
  const { call, say } = useConsole();
  const [email, setEmail] = useState("");
  const [badge, setBadge] = useState("beta");
  const [busy, setBusy] = useState(false);
  /** Taking back, asked first: which */
  const [asking, setAsking] = useState<Badge[] | null>(null);
  const thanks = BADGES.filter((b) => b.sponsor);
  const named = (list: Badge[]) => list.map((b) => `「${b.name}」`).join("和");
  /** Give or take back each badge in turn, saying what went through and what did not */
  const run = async (give: boolean, list: Badge[]) => {
    setBusy(true);
    const done: Badge[] = [];
    const failed: { badge: Badge; why: string }[] = [];
    for (const b of list) {
      try {
        await call(give ? "giveBadge" : "takeBadge", [email, b.id]);
        done.push(b);
      } catch (e) {
        failed.push({ badge: b, why: errorWords(e) });
      }
    }
    const said = done.length ? `${named(done)}${give ? "发好了，TA 下次打开网站时会看到。" : "收回了。"}` : "";
    // the same reason for every one, like an email no one signs in with, is said once
    const why =
      !done.length && failed.length && failed.every((f) => f.why === failed[0].why)
        ? failed[0].why
        : failed.map((f) => `「${f.badge.name}」：${f.why}`).join(" ");
    say([said, why].filter(Boolean).join(" "));
    setAsking(null);
    setBusy(false);
  };
  return (
    <section className="ac-panel ac-tool" aria-label="称号">
      <PanelHead title="发称号、收回称号" aside="只有站长" />
      <label className="ac-field">
        TA 的登录邮箱
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
      </label>
      <p className="ac-sub">赞助的人在爱发电付款留言里写的登录邮箱，粘在这里发赞助谢礼（{named(thanks)}，两个一起发）；退款了就一起收回。</p>
      <div className="ac-row">
        <button type="button" className="ac-btn primary" disabled={busy || !email.trim()} onClick={() => run(true, thanks)}>
          发赞助谢礼
        </button>
        <button type="button" className="ac-btn danger" disabled={busy || !email.trim()} onClick={() => setAsking(thanks)}>
          收回赞助谢礼
        </button>
      </div>
      <p className="ac-muted small">只发一个的话：</p>
      <div className="ac-row">
        {BADGES.filter((b) => b.byHand).map((b) => (
          <button key={b.id} type="button" className="ac-btn" disabled={busy || !email.trim()} onClick={() => run(true, [b])}>
            发「{b.name}」
          </button>
        ))}
      </div>
      <label className="ac-field">
        收回哪个称号
        <select value={badge} onChange={(e) => setBadge(e.target.value)}>
          {BADGES.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      {asking ? (
        <div className="ac-confirm">
          <span>确定收回{named(asking)}吗？</span>
          <button type="button" className="ac-btn danger-solid small" disabled={busy} onClick={() => run(false, asking)}>
            收回
          </button>
          <button type="button" className="ac-btn small" onClick={() => setAsking(null)}>
            算了
          </button>
        </div>
      ) : (
        <div className="ac-row">
          <button
            type="button"
            className="ac-btn danger"
            disabled={busy || !email.trim()}
            onClick={() => setAsking(BADGES.filter((b) => b.id === badge))}
          >
            收回
          </button>
        </div>
      )}
    </section>
  );
}
