"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { DEVICES, type AppCountDay, type Device, type PageCount } from "@/lib/appCounts";
import { BADGES } from "@/lib/badges";
import { beijingDayWords, beijingShort } from "@/lib/beijing";
import { CODE_WORDS, type NameWord } from "@/lib/nameRules";
import { RULES, type BanInfo, type RetentionStats } from "@/lib/safety";
import { lasted, LEVEL_MARK, type IncidentView, type SiteStatus } from "@/lib/siteStatus";
import { ago } from "../app/InboxSheet";
import { errorWords } from "./api";
import { useConsole } from "./context";
import { PanelHead } from "./ui";
import { joinedWords, ruleWords } from "./words";

/**
 * 网站和工具: what the site's own checks found (网站状态), this week's people with 存到桌面's 14 days, the name
 * blocklist, whether an email was banned, and badges by hand. The same tools as before, in the 管理台's panels.
 */
export default function Site() {
  const [wordsAdded, setWordsAdded] = useState(0);
  return (
    <div className="ac-site">
      <SiteStatusPanel />
      <People />
      <NameList added={wordsAdded} onAdded={() => setWordsAdded((n) => n + 1)} />
      <BanLookup />
      <BadgeDesk />
    </div>
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
            高德地图：这个月大约打开了 {n.amap.count.toLocaleString("en-US")} 次，上限 {n.amap.limit.toLocaleString("en-US")} 次
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

const DEVICE_NAMES: Record<Device, string> = { iphone: "iPhone", android: "安卓", harmony: "鸿蒙", desktop: "电脑" };
const BAR_PX = 56;

/** One of 存到桌面's counts on a day: the total, and by kind of device when there are any */
const countOf = (day: AppCountDay, kind: PageCount) => DEVICES.reduce((sum, d) => sum + (day.counts[`${kind}:${d}`] ?? 0), 0);

function DeskCell({ day, kind }: { day: AppCountDay; kind: PageCount }) {
  const by = DEVICES.map((d) => [d, day.counts[`${kind}:${d}`] ?? 0] as const).filter(([, n]) => n > 0);
  return (
    <td>
      <strong>{countOf(day, kind)}</strong>
      {by.length > 0 && <small>{by.map(([d, n]) => `${DEVICE_NAMES[d]} ${n}`).join(" · ")}</small>}
    </td>
  );
}

/**
 * 这周的人: who came in the last 7 days, last week's newcomers who came back, new 触须之交; and 存到桌面's last 14
 * days as bars (opened from the desktop icon), the whole table under them. Totals only, never who.
 */
function People() {
  const { call } = useConsole();
  const [s, setS] = useState<RetentionStats | null>(null);
  const [days, setDays] = useState<AppCountDay[] | null>(null);
  useEffect(() => {
    call<RetentionStats>("retention")
      .then(setS)
      .catch(() => {});
    call<AppCountDay[]>("appCounts")
      .then(setDays)
      .catch(() => {});
  }, [call]);
  // oldest first, left to right
  const shown = [...(days ?? [])].sort((a, b) => a.day.localeCompare(b.day));
  const top = Math.max(1, ...shown.map((d) => countOf(d, "standalone")));
  return (
    <section className="ac-panel ac-tool" aria-label="这周的人">
      <PanelHead title="这周的人" aside="只有站长" />
      {s ? (
        <div className="ac-people">
          <div>
            <div className="ac-muted small">最近 7 天来过</div>
            <div className="ac-big-n">{s.activeWeek}</div>
            <div className="ac-muted small">{s.activeWeekBefore === null ? "还没有更早一周的数" : `再往前 7 天 ${s.activeWeekBefore}`}</div>
          </div>
          <div>
            <div className="ac-muted small">上周注册、这周回来</div>
            <div className="ac-big-n">{s.lastWeekSignups ? percent(s.lastWeekSignupsBack / s.lastWeekSignups) : "—"}</div>
            <div className="ac-muted small">
              {s.lastWeekSignupsBack} / {s.lastWeekSignups}
            </div>
          </div>
          <div>
            <div className="ac-muted small">这周新的触须之交</div>
            <div className="ac-big-n">{s.friendshipsWeek}</div>
            <div className="ac-muted small">只有总数，不看具体是谁</div>
          </div>
        </div>
      ) : (
        <p className="ac-sub">正在读取…</p>
      )}
      <div>
        <div className="ac-muted small">存到桌面，最近 14 天每天从桌面图标打开的设备</div>
        {days && days.length === 0 ? (
          <p className="ac-muted small">最近 14 天还没有数。</p>
        ) : (
          <div className="ac-bars-chart" style={{ height: BAR_PX }}>
            {shown.map((d) => {
              const n = countOf(d, "standalone");
              return <span key={d.day} title={`${d.day.slice(5)}：${n}`} style={{ height: Math.max(2, Math.round((n / top) * BAR_PX)) }} />;
            })}
          </div>
        )}
      </div>
      {days && days.length > 0 && (
        <details className="ac-details">
          <summary>每天的数</summary>
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>从桌面图标打开</th>
                  <th>在浏览器里打开</th>
                  <th>点了「存到桌面」</th>
                  <th>装好了</th>
                  <th>登录码 拿/用</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day}>
                    <td>{d.day.slice(5)}</td>
                    <DeskCell day={d} kind="standalone" />
                    <DeskCell day={d} kind="browser" />
                    <DeskCell day={d} kind="tap" />
                    <DeskCell day={d} kind="installed" />
                    <td>
                      {d.counts["code-issued"] ?? 0} / {d.counts["code-redeemed"] ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ac-muted small">打开的次数每台设备每天只算一次；「装好了」只有 Chrome 和 Edge 会告诉我们。只有总数，看不出是谁，也不记设备。</p>
        </details>
      )}
      <p className="ac-hint">来访只记日期，按北京时间算。</p>
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
      <PanelHead title={`名字黑名单 · ${list?.total ?? "…"} 个词`} aside="只有站长" />
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

/** 内测功臣 is handed out here, and any badge can be taken back from someone gaming it */
function BadgeDesk() {
  const { call, say } = useConsole();
  const [email, setEmail] = useState("");
  const [badge, setBadge] = useState("beta");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const run = async (give: boolean) => {
    setBusy(true);
    try {
      await call(give ? "giveBadge" : "takeBadge", [email, give ? "beta" : badge]);
      say(give ? "发好了，TA 下次打开网站时会看到。" : "收回了。");
      setAsking(false);
    } catch (e) {
      say(errorWords(e));
    }
    setBusy(false);
  };
  return (
    <section className="ac-panel ac-tool" aria-label="称号">
      <PanelHead title="发称号、收回称号" aside="只有站长" />
      <label className="ac-field">
        TA 的登录邮箱
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
      </label>
      <div className="ac-row">
        <button type="button" className="ac-btn" disabled={busy || !email.trim()} onClick={() => run(true)}>
          发「内测功臣」
        </button>
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
          <span>确定收回这个称号吗？</span>
          <button type="button" className="ac-btn danger-solid small" disabled={busy} onClick={() => run(false)}>
            收回
          </button>
          <button type="button" className="ac-btn small" onClick={() => setAsking(false)}>
            算了
          </button>
        </div>
      ) : (
        <div className="ac-row">
          <button type="button" className="ac-btn danger" disabled={busy || !email.trim()} onClick={() => setAsking(true)}>
            收回
          </button>
        </div>
      )}
    </section>
  );
}
