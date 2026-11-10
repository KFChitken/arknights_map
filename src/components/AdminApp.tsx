"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { BADGES } from "@/lib/badges";
import { GAME_NAMES } from "@/lib/games";
import { CODE_WORDS, type NameWord } from "@/lib/nameRules";
import { beijingDate, beijingDayWords, beijingShort } from "@/lib/beijing";
import { BLOCKS_TO_REVIEW, BLOCKS_WINDOW_DAYS, PROFILE_REPORTS_TO_HOLD, SUSPEND_DAYS, YELLOW_DAYS, YELLOWS_TO_WORRY } from "@/lib/rules";
import {
  CASE_LEVELS,
  CASES_PER_PAGE,
  isRuleCode,
  REPORT_REASONS,
  reasonWords,
  ROACH_REPORT_REASONS,
  RULES,
  type AdminAction,
  type AdminAppeal,
  type AdminCase,
  type AdminPerson,
  type AnyReason,
  type BanInfo,
  type CaseLevel,
  type CasePage,
  type FoundPlayers,
  type ReporterInfo,
  type ReportReason,
  type RetentionStats,
  type RoachReportReason,
  type RuleCode,
} from "@/lib/safety";
import { lasted, LEVEL_MARK, type IncidentView, type SiteStatus } from "@/lib/siteStatus";
import { ago } from "./app/InboxSheet";
import RoachIcon from "./RoachIcon";

/**
 * /admin: what the site's own checks found (网站状态), this week's totals, appeals, the open reports a
 * page at a time with the ways to settle them, the name blocklist, a search of the accounts, whether an
 * email was banned, and badges by hand. The API refuses everyone but the admins.
 */

async function call<T>(op: string, ...args: unknown[]): Promise<T> {
  const res = await fetch(`/api/admin/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args }),
  });
  const body = (await res.json().catch(() => null)) as { result?: T; error?: string } | null;
  if (res.status === 404) throw new Error("forbidden");
  if (!res.ok) throw new Error(body?.error ?? "服务器出了点问题，稍后再试试。");
  return body?.result as T;
}

const DONE: Record<AdminAction, string> = {
  dismiss: "关掉了这些举报，举报的人收到了「这次没发现违规」。",
  clearName: "名字清掉了，TA 现在是匿名，以后也不能再用这个名字。",
  clearUid: "UID 清掉了，TA 以后也不能再填这个 UID。",
  clearBoth: "名字和 UID 都清掉了，TA 以后也不能再用。",
  warn: "提醒了 TA 一次，记一张黄牌。",
  suspend: `暂停了 TA 的互动 ${SUSPEND_DAYS} 天。`,
  ageCheck: "请 TA 重新确认满 18 岁了：TA 下次打开网站会先看到这件事。",
  removeRoach: "这只蟑螂收回到主人手里了，记了一张黄牌，主人收到了通知。",
  ban: "封号了：账号和数据都删了，这个邮箱（连同它的其他写法）不能再登录。",
};

/** What was done, as the appeals list says it */
const ACTION_WORDS: Record<AdminAction, string> = {
  dismiss: "没问题",
  clearName: "清掉名字",
  clearUid: "清掉 UID",
  clearBoth: "清掉名字和 UID",
  warn: "警告（一张黄牌）",
  suspend: `暂停互动 ${SUSPEND_DAYS} 天`,
  ageCheck: "请 TA 确认年龄",
  removeRoach: "移走一只蟑螂（一张黄牌）",
  ban: "封号",
};

/** What 撤销 gives back, by what was done */
const UNDO_WORDS: Partial<Record<AdminAction, string>> = {
  warn: "这张黄牌不算了",
  removeRoach: "这张黄牌不算了（蟑螂不会自己回去，TA 可以重新放）",
  suspend: "还在暂停的话，马上恢复互动",
  clearName: "TA 可以再用原来的名字（要自己重新填）",
  clearUid: "TA 可以再填原来的 UID（要自己重新填）",
  clearBoth: "TA 可以再用原来的名字和 UID（要自己重新填）",
  ageCheck: "不用 TA 再确认年龄了",
};

/** The keys of the queue: only while typing nowhere; a ban always needs its button and a confirm */
const KEYS: Record<string, AdminAction> = { d: "dismiss", n: "clearName", u: "clearUid", w: "warn", s: "suspend" };
/** The keys a roach's case takes */
const ROACH_KEYS = new Set<AdminAction>(["dismiss", "warn"]);

const LEVEL_NAMES: Record<CaseLevel, string> = { red: "红", yellow: "黄", green: "绿" };

/** Where a reported roach was, on OpenStreetMap (the spots are stored as WGS-84, src/lib/geo.ts) */
const osm = (p: { lng: number; lat: number }) => `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}`;
const SPOT_STATE = { here: "还在原地", moved: "举报以后挪过窝了", gone: "已经收回了" } as const;

/** Whether a reported player filled in a UID for a game they play */
const hasUid = (c: AdminPerson) => c.games.some((g) => g.uid);

/** 「骚扰刷屏 2、名字不合适 1」, or why a case without reports is one */
function reasonsOf(c: AdminCase) {
  if (!c.reports.length) return `${BLOCKS_WINDOW_DAYS} 天内被 ${c.blockedRecently} 个人拉黑`;
  const n = new Map<string, number>();
  for (const r of c.reports) n.set(reasonWords(r.reason), (n.get(reasonWords(r.reason)) ?? 0) + 1);
  return [...n].map(([reason, k]) => `${reason} ${k}`).join("、");
}

/** 「关掉过 3 次，警告过 1 次……」 */
function settledWords(s: AdminPerson["settled"]) {
  const parts = [
    s.dismissed && `关掉过 ${s.dismissed} 次`,
    s.warned && `警告过 ${s.warned} 次`,
    s.suspended && `暂停过 ${s.suspended} 次`,
    s.nameCleared && `清过名字 ${s.nameCleared} 次`,
    s.uidCleared && `清过 UID ${s.uidCleared} 次`,
    s.ageChecks && `请 TA 确认过 ${s.ageChecks} 次年龄`,
    s.roachesRemoved && `移走过 ${s.roachesRemoved} 只蟑螂`,
  ].filter(Boolean);
  return parts.length ? parts.join("，") : "没有";
}

/** How a reporter's reports went before, never who they are */
function reporterWords(r: ReporterInfo | null) {
  if (!r) return "举报人已注销";
  const before = r.upheld + r.dismissed ? `以前举报 ${r.upheld + r.dismissed} 次，${r.dismissed} 次判了没问题` : "以前没举报过";
  return `注册 ${r.days} 天 · ${before}${r.reliable ? "" : " · 不算进自动处理"}`;
}

function tagsOf(p: AdminPerson, brigade = false) {
  return [
    p.heldAt ? "先藏起来了" : p.anonymous ? "现在是匿名" : null,
    p.suspendedAuto ? "自动暂停中" : p.suspendedUntil ? "暂停中" : null,
    brigade ? "可能是一起来刷的" : null,
    p.ageCheckAt ? "等 TA 确认年龄" : null,
  ].filter((t): t is string => Boolean(t));
}

const shownName = (p: AdminPerson) => (p.name && !p.anonymous ? `${p.drPrefix ? "Dr. " : ""}${p.name}` : "匿名");

/** A row's title: the player, or the roach and whose */
const rowTitle = (c: AdminCase) => (c.kind === "roach" ? `${c.roach?.main ? "本体" : "克隆体"} · 主人 ${shownName(c)}` : shownName(c));

const ruleWords = (rule: string | null) => (isRuleCode(rule) ? RULES[rule] : rule || "没记原因（以前封的）");

export default function AdminApp() {
  const [forbidden, setForbidden] = useState(false);
  // bumped when a case card adds to the name list, so the list below reads it again
  const [wordsAdded, setWordsAdded] = useState(0);
  const onForbidden = useCallback(() => setForbidden(true), []);

  if (forbidden) {
    return (
      <main className="doc">
        <h1>管理</h1>
        <p>这个页面只有站长能打开。请先在地图上用站长的邮箱登录。</p>
        <p>
          <Link href="/">回到地图</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="doc admin">
      <h1>管理</h1>
      <SiteStatusBox />
      <Retention />
      <Appeals />
      <Cases onForbidden={onForbidden} onWordsAdded={() => setWordsAdded((n) => n + 1)} />
      <NameList added={wordsAdded} />
      <Players />
      <BanLookup />
      <BadgeDesk />
      <p className="hint" style={{ marginTop: 24 }}>
        <Link href="/">回到地图</Link>
      </p>
    </main>
  );
}

/**
 * 举报处理: one row a case, the most pressing first, 50 a page, opened to its card; filters by colour and
 * reason (asked of the server), 名字快审 for cases only about a name, several at once, and keys for going
 * through them quickly. A roach on the map is a case of its own.
 */
function Cases({ onForbidden, onWordsAdded }: { onForbidden: () => void; onWordsAdded: () => void }) {
  const [level, setLevel] = useState<CaseLevel | "all">("all");
  const [reason, setReason] = useState<AnyReason | "blocks" | "all">("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CasePage | null>(null);
  const [names, setNames] = useState<AdminCase[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [quick, setQuick] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  const load = useCallback(async () => {
    try {
      const d = await call<CasePage>("cases", { page, level, reason });
      // settling the last cases of the last page: back to the page that is now last
      if (!d.cases.length && page > 1) {
        setPage(Math.max(1, Math.ceil(d.total / CASES_PER_PAGE)));
        return;
      }
      setData(d);
      if (quick) setNames((await call<CasePage>("cases", { nameOnly: true })).cases);
    } catch (e) {
      if (e instanceof Error && e.message === "forbidden") onForbidden();
      else setNote(e instanceof Error ? e.message : "出了点问题。");
    }
  }, [page, level, reason, quick, onForbidden]);
  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => data?.cases ?? [], [data]);
  const pages = data ? Math.max(1, Math.ceil(data.total / CASES_PER_PAGE)) : 1;
  const all = data ? data.levels.red + data.levels.yellow + data.levels.green : 0;
  const filter = (f: () => void) => {
    f();
    setPage(1);
    setCursor(0);
    setPicked(new Set());
  };

  const run = useCallback(
    async (fn: () => Promise<string>) => {
      setBusy(true);
      try {
        setNote(await fn());
        await load();
      } catch (e) {
        setNote(e instanceof Error ? e.message : "出了点问题。");
      }
      setBusy(false);
    },
    [load],
  );

  const settle = useCallback(
    (c: AdminCase, action: AdminAction, rule?: RuleCode) => {
      if (action === "ban" && !window.confirm("封号会删除这个账号和 TA 的所有数据，这个邮箱以后不能再登录。确定吗？")) return;
      if (action === "removeRoach" && c.roach?.main && !window.confirm("这是本体，TA 的克隆体也会一起收回。确定吗？")) return;
      return run(async () => {
        await call("resolve", c.caseId, action, rule);
        if (action === "dismiss" && c.kind === "roach") return "关掉了这些举报，举报的人收到了「这次没发现问题」。";
        if (action === "dismiss" && c.heldAt) return "关掉了这些举报，TA 的名字和 UID 恢复了。";
        return DONE[action];
      });
    },
    [run],
  );

  const settleMany = (ids: string[], action: AdminAction, done: string) =>
    run(async () => {
      const n = await call<number>("resolveMany", ids, action);
      setPicked(new Set());
      return `${done}（${n} 个）`;
    });

  // the whole name, for everyone; the report stays open
  const blockName = (c: AdminCase) =>
    run(async () => {
      await call("addNameWords", `=${c.name}`);
      onWordsAdded();
      return "加好了：以后谁都不能叫这个名字。要挡名字里的某个词，到下面「名字黑名单」里加。";
    });

  // j/k move, Enter or o opens, d n u w s settle the case under the cursor; the next one moves up into its place
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || busy) return;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      const c = shown[Math.min(cursor, shown.length - 1)];
      if (e.key === "j") setCursor((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setCursor((i) => Math.max(i - 1, 0));
      else if ((e.key === "Enter" || e.key === "o") && c) setOpen((o) => (o === c.caseId ? null : c.caseId));
      else if (KEYS[e.key] && c) {
        if (c.kind === "roach" && !ROACH_KEYS.has(KEYS[e.key])) return;
        if (KEYS[e.key] === "clearName" && !c.name) return;
        if (KEYS[e.key] === "clearUid" && !hasUid(c)) return;
        void settle(c, KEYS[e.key]);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, cursor, busy, settle]);

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <h2>举报处理</h2>
      <p className="hint">
        红的（可能未成年、留了联系方式、地图上蟑螂的位置）先看，再黄的、绿的；同一色里可靠的举报人多的在前，一页 {CASES_PER_PAGE}{" "}
        个。名字、联系方式、冒充这三类凑满 {PROFILE_REPORTS_TO_HOLD} 个可靠的人，TA 的名字和 UID 会先藏起来。地图上的蟑螂单独成一个案子，和这个人别的举报分开处理。点开一行看详细；快捷键（不在输入框里时）：j、k
        上下，Enter 或 o 点开，d 没问题，n 清名字，u 只清 UID，w 警告，s 暂停 {SUSPEND_DAYS} 天。封号只能点按钮。
      </p>
      {note && <p className="admin-note">{note}</p>}
      {data === null && !note && <p>正在读取…</p>}
      {data && all === 0 && <p>没有待处理的举报。</p>}
      {data && all > 0 && (
        <>
          <div className="case-filters">
            <div className="seg" role="group" aria-label="按轻重筛">
              <button className={level === "all" ? "on" : ""} onClick={() => filter(() => setLevel("all"))}>
                全部 {all}
              </button>
              {CASE_LEVELS.map((l) => (
                <button key={l} className={level === l ? "on" : ""} onClick={() => filter(() => setLevel(l))}>
                  <span className={`dot ${l}`} /> {LEVEL_NAMES[l]} {data.levels[l]}
                </button>
              ))}
            </div>
            <select
              value={reason}
              onChange={(e) => filter(() => setReason(e.target.value as AnyReason | "blocks" | "all"))}
              aria-label="按理由筛"
            >
              <option value="all">所有理由</option>
              <optgroup label="举报人">
                {(Object.keys(REPORT_REASONS) as ReportReason[]).map((r) => (
                  <option key={r} value={r}>
                    {REPORT_REASONS[r]}
                  </option>
                ))}
                <option value="blocks">被很多人拉黑</option>
              </optgroup>
              <optgroup label="地图上的蟑螂">
                {(Object.keys(ROACH_REPORT_REASONS) as RoachReportReason[]).map((r) => (
                  <option key={r} value={r}>
                    {ROACH_REPORT_REASONS[r]}
                  </option>
                ))}
              </optgroup>
            </select>
            {data.nameOnly > 0 && (
              <button className="pill" onClick={() => setQuick((q) => !q)}>
                名字快审（{data.nameOnly}）
              </button>
            )}
          </div>

          {quick && names && (
            <QuickNames cases={names} total={data.nameOnly} busy={busy} onSettle={settleMany} onClose={() => setQuick(false)} />
          )}

          {picked.size > 0 && (
            <div className="batch-bar">
              选了 {picked.size} 个：
              <button className="pill" disabled={busy} onClick={() => settleMany([...picked], "dismiss", "关掉了这些举报")}>
                没问题
              </button>
              <button className="pill" disabled={busy} onClick={() => settleMany([...picked], "clearName", "名字清掉了（蟑螂的案子跳过）")}>
                清掉名字
              </button>
              <button className="pill" disabled={busy} onClick={() => settleMany([...picked], "warn", "警告了，各记一张黄牌")}>
                警告
              </button>
              <button className="link" onClick={() => setPicked(new Set())}>
                不选了
              </button>
            </div>
          )}

          <ul className="case-rows">
            {shown.map((c, i) => (
              <li key={c.caseId} className={i === Math.min(cursor, shown.length - 1) ? "cursor" : ""}>
                <div
                  className="case-row"
                  onClick={() => {
                    setCursor(i);
                    setOpen((o) => (o === c.caseId ? null : c.caseId));
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label="选中这一个"
                    checked={picked.has(c.caseId)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggle(c.caseId)}
                  />
                  <span className={`dot ${c.level}`} aria-label={LEVEL_NAMES[c.level]} />
                  <div className="case-row-text">
                    {c.kind === "roach" && <span className="tag map-tag">地图</span>}
                    <strong>{rowTitle(c)}</strong>{" "}
                    <span className="hint">
                      {reasonsOf(c)}
                      {c.reports.length > 0 && ` · ${c.reporters} 人举报（${c.reliable} 个可靠）`} · 等了 {lasted(now - c.since)}
                    </span>
                    {tagsOf(c, c.brigade).map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                {open === c.caseId && <CaseCard c={c} busy={busy} onSettle={settle} onBlockName={blockName} />}
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="hint">这一类没有。</p>}
          {pages > 1 && (
            <div className="pager">
              <button className="pill" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </button>
              <span className="hint">
                第 {page} / {pages} 页 · 这一类一共 {data.total} 个
              </span>
              <button className="pill" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** 名字快审: cases only about a name, 50 at a time, in one list; tick the names to clear, the rest are fine */
function QuickNames({
  cases,
  total,
  busy,
  onSettle,
  onClose,
}: {
  cases: AdminCase[];
  total: number;
  busy: boolean;
  onSettle: (ids: string[], action: AdminAction, done: string) => Promise<void>;
  onClose: () => void;
}) {
  const [bad, setBad] = useState<Set<string>>(new Set());
  const rest = cases.filter((c) => !bad.has(c.caseId)).map((c) => c.caseId);
  return (
    <section className="admin-case quick-names">
      <h2>
        名字快审 · {total} 个{total > cases.length && `（先看前 ${cases.length} 个）`}
      </h2>
      <p className="hint">勾上要清掉的名字，再点下面的按钮；没勾的就是没问题。</p>
      <ul className="case-rows">
        {cases.map((c) => (
          <li key={c.caseId}>
            <label className="check">
              <input
                type="checkbox"
                checked={bad.has(c.caseId)}
                onChange={(e) =>
                  setBad((b) => {
                    const next = new Set(b);
                    if (e.target.checked) next.add(c.caseId);
                    else next.delete(c.caseId);
                    return next;
                  })
                }
              />
              <strong>{c.name || "（没有名字）"}</strong>
              <span className="hint">
                {c.reporters} 人举报（{c.reliable} 个可靠）
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="account-actions">
        <button className="pill" disabled={busy || bad.size === 0} onClick={() => onSettle([...bad], "clearName", "名字清掉了").then(() => setBad(new Set()))}>
          清掉勾选的名字（{bad.size}）
        </button>
        <button className="pill" disabled={busy || rest.length === 0} onClick={() => onSettle(rest, "dismiss", "这些名字都没问题")}>
          其余都没问题（{rest.length}）
        </button>
        <button className="link" onClick={onClose}>
          收起
        </button>
      </div>
    </section>
  );
}

/** Who a player is and what they did: the same box in a case, a roach's case and an appeal */
function PersonBox({ p, brigade = false, title }: { p: AdminPerson; brigade?: boolean; title?: string }) {
  return (
    <>
      <div className="who-card">
        <RoachIcon color={p.color} size={44} avatar={p.avatar} />
        <div>
          {title && <p className="hint">{title}</p>}
          <strong>{p.name ? `${p.drPrefix ? "Dr. " : ""}${p.name}` : "（没有名字）"}</strong>
          {tagsOf(p, brigade).map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
          <p className="hint">
            {ago(p.joinedAt)}注册 · 最近 24 小时碰了 {p.last24h.touches} 次、发了 {p.last24h.declarations} 条宣言
          </p>
          {p.heldAt && <p className="hint">名字和 UID 先藏起来了（{ago(p.heldAt)}）</p>}
        </div>
      </div>
      <dl className="admin-facts">
        <dt>邮箱</dt>
        <dd>{p.email || "（没有）"}</dd>
        {p.games.length === 0 && (
          <>
            <dt>游戏</dt>
            <dd>没填</dd>
          </>
        )}
        {p.games.map((g) => (
          <Fragment key={g.game}>
            <dt>{GAME_NAMES[g.game]}</dt>
            <dd>
              UID {g.uid ? <code>{g.uid}</code> : "没填"}
              {g.server && `（${g.server}）`}
              {g.favourites.length > 0 && <> · 喜欢 {g.favourites.join("、")}</>}
            </dd>
          </Fragment>
        ))}
        <dt>UID 给谁看</dt>
        <dd>
          {p.shareUid ? "大胆碰过的人能看到" : "只有自己"}
          {p.heldAt && p.shareUid && "（现在先藏起来了）"}
        </dd>
        {p.support.length > 0 && (
          <>
            <dt>我的助战</dt>
            <dd>{p.support.join("、")}</dd>
          </>
        )}
        <dt>称号</dt>
        <dd>
          {p.badges.length ? `${p.badges.length} 个：${p.badges.join("、")}` : "没有"}
          {p.worn && `；戴着「${p.worn}」`}
        </dd>
        <dt>蟑螂</dt>
        <dd>
          {p.roaches.main ? "放了本体" : "没放本体"}
          {p.roaches.clones > 0 && `，${p.roaches.clones} 只克隆体`}
        </dd>
        <dt>触须之交</dt>
        <dd>{p.friends} 个</dd>
        <dt>被拉黑</dt>
        <dd>
          一共 {p.blockedBy} 个人
          {p.blockedRecently > 0 && `；${BLOCKS_WINDOW_DAYS} 天内被 ${p.blockedRecently} 个人拉黑`}
        </dd>
        <dt>黄牌</dt>
        <dd className={p.yellow >= YELLOWS_TO_WORRY ? "warn-text" : ""}>
          {p.yellow >= YELLOWS_TO_WORRY ? `${YELLOW_DAYS} 天内已经 ${p.yellow} 张黄牌，可以考虑封号` : `${YELLOW_DAYS} 天内 ${p.yellow} 张`}
        </dd>
        {p.suspendedUntil && (
          <>
            <dt>暂停互动</dt>
            <dd>
              到 {beijingDayWords(p.suspendedUntil)}
              {p.suspendedAuto && "（是举报自动暂停的，你处理时会先解除）"}
            </dd>
          </>
        )}
        {(p.ageCheckAt || p.settled.ageChecks > 0) && (
          <>
            <dt>年龄</dt>
            <dd>
              {p.ageCheckAt
                ? `等 TA 确认年龄（${ago(p.ageCheckAt)}请的）`
                : p.ageConfirmedAt
                  ? `${ago(p.ageConfirmedAt)}确认过满 18 岁`
                  : "确认过"}
            </dd>
          </>
        )}
        <dt>以前的处理</dt>
        <dd>{settledWords(p.settled)}</dd>
      </dl>
    </>
  );
}

/** One case opened: the reported roach's spot (for a roach), who it is, the reports with their reporters' record, and the ways to settle it */
function CaseCard({
  c,
  busy,
  onSettle,
  onBlockName,
}: {
  c: AdminCase;
  busy: boolean;
  onSettle: (c: AdminCase, action: AdminAction, rule?: RuleCode) => Promise<void> | undefined;
  onBlockName: (c: AdminCase) => Promise<void>;
}) {
  const [rule, setRule] = useState<RuleCode | null>(null);
  const settle = (action: AdminAction) => onSettle(c, action, rule ?? undefined);
  const roach = c.kind === "roach" ? c.roach : undefined;
  return (
    <section className="admin-case">
      {roach && (
        <dl className="admin-facts roach-spot">
          <dt>被举报的</dt>
          <dd>{roach.main ? "TA 的本体" : "TA 的一只克隆体"}</dd>
          <dt>举报时在</dt>
          <dd>
            <a href={osm(roach)} target="_blank" rel="noreferrer">
              {roach.lat.toFixed(5)}, {roach.lng.toFixed(5)}（在 OpenStreetMap 上看）
            </a>
          </dd>
          <dt>现在</dt>
          <dd>{SPOT_STATE[roach.state]}</dd>
        </dl>
      )}
      <PersonBox p={c} brigade={c.brigade} title={roach ? "蟑螂的主人" : undefined} />

      {c.reports.length > 0 ? (
        <>
          <h2>
            被 {c.reporters} 个人举报（{c.reliable} 个可靠）
          </h2>
          <ul>
            {c.reports.map((r, i) => (
              <li key={i}>
                <strong>{reasonWords(r.reason)}</strong>
                {r.note && <>：{r.note}</>}
                <br />
                <span className="hint">
                  {ago(r.at)} · {r.context} · {roach ? "主人当时的名字" : "当时的名字"}：{r.name}
                </span>
                {r.reason === "stalk" && (
                  <>
                    <br />
                    <span className="hint">{r.nearM == null ? "举报人当时没放蟑螂" : `离举报人最近的蟑螂约 ${r.nearM} 米`}</span>
                  </>
                )}
                {r.place && roach && (r.place.lng !== roach.lng || r.place.lat !== roach.lat) && (
                  <>
                    <br />
                    <a className="hint" href={osm(r.place)} target="_blank" rel="noreferrer">
                      这次举报时它在别处（在 OpenStreetMap 上看）
                    </a>
                  </>
                )}
                <br />
                <span className="hint">举报人：{reporterWords(r.reporter)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="hint">没有举报：{BLOCKS_WINDOW_DAYS} 天内被 {c.blockedRecently} 个不同的人拉黑了。处理以后，再被拉黑 {BLOCKS_TO_REVIEW} 次才会再列出来。</p>
      )}

      {!roach && c.declarations.length > 0 && (
        <>
          <h2>最近的宣言</h2>
          <ul>
            {c.declarations.map((d, i) => (
              <li key={i}>
                「{d.text}」<span className="hint"> {ago(d.at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <label className="field">
        按哪条守则（会写在给 TA 的通知里）
        <select value={rule ?? c.rule} onChange={(e) => setRule(e.target.value as RuleCode)}>
          {(Object.keys(RULES) as RuleCode[]).map((r) => (
            <option key={r} value={r}>
              {RULES[r]}
            </option>
          ))}
        </select>
      </label>
      {roach ? (
        <>
          <p className="hint">
            「没问题」不会告诉主人；警告和移走会告诉主人是哪条守则，不会说是谁举报的。
            {roach.state === "moved" && "它举报以后挪过窝了，移走的是它现在的位置。"}
          </p>
          <div className="account-actions">
            <button className="pill" disabled={busy} onClick={() => settle("dismiss")}>
              没问题
            </button>
            <button className="pill" disabled={busy} onClick={() => settle("warn")}>
              警告
            </button>
            <button className="pill" disabled={busy || roach.state === "gone"} onClick={() => settle("removeRoach")}>
              {roach.main ? "移走（这是本体，TA 的克隆体也会一起收回）" : "移走这只蟑螂"}
            </button>
            <button className="pill danger-pill" disabled={busy} onClick={() => settle("ban")}>
              封号
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">没改的话：清名字按「{RULES.name}」，只清 UID 按「{RULES.contact}」，确认年龄按「{RULES.age}」，别的按举报最多的理由。</p>
          <div className="account-actions">
            <button className="pill" disabled={busy} onClick={() => settle("dismiss")}>
              {c.heldAt ? "没问题，恢复" : "没问题"}
            </button>
            <button className="pill" disabled={busy} onClick={() => settle("warn")}>
              警告
            </button>
            <button className="pill" disabled={busy} onClick={() => settle("suspend")}>
              暂停 {SUSPEND_DAYS} 天
            </button>
            <button className="pill" disabled={busy || !c.name} onClick={() => settle("clearName")}>
              清掉名字
            </button>
            <button className="pill" disabled={busy || !hasUid(c)} onClick={() => settle("clearUid")}>
              只清 UID
            </button>
            <button className="pill" disabled={busy || !c.name || !hasUid(c)} onClick={() => settle("clearBoth")}>
              名字和 UID 都清
            </button>
            <button className="pill" disabled={busy || Boolean(c.ageCheckAt)} onClick={() => settle("ageCheck")}>
              请 TA 确认年龄
            </button>
            <button className="pill" disabled={busy || !c.name} onClick={() => onBlockName(c)}>
              加进名字黑名单
            </button>
            <button className="pill danger-pill" disabled={busy} onClick={() => settle("ban")}>
              封号
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * 申诉: what players told of an action wrote back with 「我觉得处理错了」, the oldest first, above the
 * queue. 维持 keeps the action, 撤销 undoes what can be undone; the player is told either way.
 */
function Appeals() {
  const [list, setList] = useState<AdminAppeal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => {
    call<AdminAppeal[]>("appeals")
      .then(setList)
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const answer = async (a: AdminAppeal, keep: boolean) => {
    if (!keep && !window.confirm(`撤销这次「${ACTION_WORDS[a.action]}」吗？${UNDO_WORDS[a.action] ?? ""}。`)) return;
    setBusy(true);
    try {
      await call("answerAppeal", a.actionId, keep);
      setNote(keep ? "维持了原来的处理，TA 收到了通知。" : `撤销了：${UNDO_WORDS[a.action] ?? "恢复原样了"}。TA 收到了通知。`);
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "出了点问题。");
    }
    setBusy(false);
  };
  if (!list) return null;
  return (
    <section className="admin-case appeals">
      <h2>申诉 · {list.length} 条待处理</h2>
      {note && <p className="admin-note">{note}</p>}
      {list.length === 0 && <p className="hint">没有待处理的申诉。被警告、暂停、清名字、清 UID 或移走蟑螂的人，可以在站长通知里申诉一次。</p>}
      <ul className="case-rows">
        {list.map((a) => (
          <li key={a.actionId}>
            <div className="case-row">
              <div className="case-row-text">
                <strong>{a.action === "removeRoach" ? (a.main ? "移走本体（克隆体也一起收回了）" : "移走一只克隆体") : ACTION_WORDS[a.action]}</strong>{" "}
                <span className="hint">
                  · {shownName(a.who)} · 按「{ruleWords(a.rule)}」 · {beijingDayWords(a.at)}处理
                  {a.action === "suspend" && a.until && `（到 ${beijingDayWords(a.until)}）`} · {ago(a.appealedAt)}申诉
                </span>
                <p className="appeal-text">「{a.appeal}」</p>
              </div>
            </div>
            <PersonBox p={a.who} title="申诉的人现在" />
            <div className="account-actions">
              <button className="pill" disabled={busy} onClick={() => answer(a, true)}>
                维持
              </button>
              <button className="pill" disabled={busy} onClick={() => answer(a, false)}>
                撤销
              </button>
              <span className="hint">撤销：{UNDO_WORDS[a.action] ?? "恢复原样"}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const clock = (t: number) => beijingShort(t).split(" ")[1];
const percent = (x: number) => `${Math.round(x * 100)}%`;
const gigabytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const megabytes = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`;

const MAIL_KINDS: Record<string, string> = { urgent: "要你看", recovered: "已恢复", digest: "每日汇总", report: "举报", skipped: "超上限没发" };

/** Whether and how the admin was told of an incident */
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

/**
 * 网站状态: whether anything is wrong now, what wants the admin first, the last seven days, a few
 * figures and the alert emails sent; read again every minute. 「知道了」 stops the emails about one.
 */
function SiteStatusBox() {
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
      .catch((e) => setNote(e instanceof Error ? e.message : "出了点问题。"));
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [load]);
  const ack = async (id: string) => {
    setBusy(true);
    try {
      await call("ack", id);
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "出了点问题。");
    }
    setBusy(false);
  };
  if (!s) return note ? <p className="admin-note">网站状态读不出来：{note}</p> : null;

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
    <section className="admin-case site-status">
      <h2>网站状态</h2>
      <p className="status-line">
        <strong>{s.open.length ? `现在有 ${s.open.length} 个问题，其中 ${pressing} 个要你处理` : "现在一切正常 ✅"}</strong>
        <span className={stale ? "stale" : "hint"}>
          {s.lastRound === null ? "自查还没跑过" : stale ? `自查停了：上次是 ${ago(s.lastRound, s.now)}` : `自查：${ago(s.lastRound, s.now)}`}
        </span>
      </p>
      {note && <p className="admin-note">{note}</p>}
      {s.open.length > 0 && (
        <ul className="incidents">
          {s.open.map((i) => (
            <li key={i.id}>
              <strong>
                {LEVEL_MARK[i.level]} {i.title}
              </strong>
              {i.times > 1 && <span className="hint">（合并了 {i.times} 次）</span>}
              <p className="hint">
                从 {beijingShort(i.startedAt)} 开始，已经 {lasted(s.now - i.startedAt)} · {toldWords(i)}
              </p>
              {i.detail && <p>{i.detail}</p>}
              {i.advice && <p className="hint">怎么办：{i.advice}</p>}
              {i.level !== "quiet" &&
                (i.ackedAt ? (
                  <p className="hint">你 {beijingShort(i.ackedAt)} 已经知道了，不再为它发邮件。</p>
                ) : (
                  <button className="pill" disabled={busy} onClick={() => ack(i.id)}>
                    知道了
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}

      <h2>最近 7 天</h2>
      <label className="check">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        也看只记录的（⚪）
      </label>
      {days.size === 0 && <p className="hint">没有。</p>}
      {[...days].map(([day, list]) => (
        <Fragment key={day}>
          <h3>{day}</h3>
          <ul className="incidents week">
            {list.map((i) => (
              <li key={i.id}>
                {LEVEL_MARK[i.level]} {clock(i.startedAt)}–{i.endedAt ? clock(i.endedAt) : "现在"} {i.title}
                <span className="hint">
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

      <h2>几个数</h2>
      <ul>
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

      <h2>发过的报警邮件</h2>
      {s.mails.length === 0 && <p className="hint">还没有。</p>}
      <ul className="incidents week">
        {s.mails.map((m, k) => (
          <li key={k}>
            <span className="hint">
              {beijingShort(m.at)} · {MAIL_KINDS[m.kind] ?? m.kind}
            </span>{" "}
            {m.subject}
          </li>
        ))}
      </ul>
      <p className="hint">
        外面的检查：
        <a href="https://github.com/KFChitken/arknights_map/actions/workflows/uptime.yml" target="_blank" rel="noreferrer">
          每 10 分钟的在线检查
        </a>
        {" · "}
        <a href="https://github.com/KFChitken/arknights_map/actions/workflows/mainland-check.yml" target="_blank" rel="noreferrer">
          每天的内地访问检查
        </a>
      </p>
    </section>
  );
}

function Retention() {
  const [s, setS] = useState<RetentionStats | null>(null);
  useEffect(() => {
    call<RetentionStats>("retention")
      .then(setS)
      .catch(() => {});
  }, []);
  if (!s) return null;
  const share = s.lastWeekSignups ? `（${Math.round((100 * s.lastWeekSignupsBack) / s.lastWeekSignups)}%）` : "";
  return (
    <section className="admin-case">
      <h2>回访统计</h2>
      <ul>
        <li>
          最近 7 天来过 <strong>{s.activeWeek}</strong> 人
          {s.activeWeekBefore === null ? "，还没有更早一周的数可以比" : `，再往前 7 天是 ${s.activeWeekBefore} 人`}
        </li>
        <li>
          7 到 13 天前注册的 {s.lastWeekSignups} 人里，<strong>{s.lastWeekSignupsBack}</strong> 人最近 7 天又来过{share}
        </li>
        <li>
          最近 7 天新成 <strong>{s.friendshipsWeek}</strong> 对触须之交
        </li>
      </ul>
      <p className="hint">只有总数，看不出是谁。来访只记日期，按北京时间算。</p>
    </section>
  );
}

type NameHit = { id: string; name: string; anonymous: boolean };
type NameList = { total: number; found: number; words: NameWord[]; hits: NameHit[] };

/**
 * 名字黑名单: the words no name may contain (or be, marked 「=」), searchable since the list
 * runs to thousands, and the names in use that they block now, to clear by hand. The
 * rules in src/lib/nameRules.ts apply as well.
 */
function NameList({ added }: { added: number }) {
  const [list, setList] = useState<NameList | null>(null);
  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback((q: string) => {
    call<NameList>("nameWords", q)
      .then(setList)
      .catch((e) => setNote(e instanceof Error ? e.message : "出了点问题。"));
  }, []);
  // a moment after typing stops, not on every key; and again when a case card added a name
  useEffect(() => {
    const t = window.setTimeout(() => load(search), 300);
    return () => window.clearTimeout(t);
  }, [search, load, added]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      setNote(await fn());
      load(search);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "出了点问题。");
    }
    setBusy(false);
  };
  const add = () =>
    run(async () => {
      const n = await call<number>("addNameWords", text);
      setText("");
      return `加好了 ${n} 个词。`;
    });
  const removeAll = () => {
    if (!window.confirm("把框里的词都从名单上删掉？")) return;
    run(async () => {
      const n = await call<number>("removeNameWords", text);
      setText("");
      return `删掉了 ${n} 个词。`;
    });
  };
  const remove = (w: NameWord) => run(async () => (await call("removeNameWord", w.word), `删掉了「${w.word}」。`));
  const clear = (h: NameHit) => {
    if (!window.confirm(`清掉「${h.name}」这个名字，把 TA 改成匿名？`)) return;
    run(async () => (await call("clearName", h.id), DONE.clearName));
  };

  return (
    <section className="admin-case">
      <h2>名字黑名单 · {list?.total ?? "…"} 个词</h2>
      <p className="hint">
        存资料时名字里出现这些词就存不了（前面带「=」的只在整个名字就是这个词时才挡）。比对前去掉空格和符号、全角转半角、英文转小写，繁体不会自动转。
      </p>
      <p className="hint">
        写在代码里、这里删不了的：
        {CODE_WORDS.map((w) => (w.whole ? `=${w.word}` : w.word)).join("、")}
        ；还有网址、QQ/微信号和 6 位以上的数字。
      </p>
      <label className="field">
        找词
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="输入要找的字" />
      </label>
      {list && (
        <p className="hint">
          {search.trim() ? `找到 ${list.found} 个` : "最新加的"}
          {list.found > list.words.length ? `，下面只列出前 ${list.words.length} 个` : ""}
        </p>
      )}
      {list && (
        <div className="word-chips">
          {list.words.map((w) => (
            <span key={w.word} className="word-chip">
              {w.whole ? `=${w.word}` : w.word}
              <button aria-label={`删掉${w.word}`} disabled={busy} onClick={() => remove(w)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <label className="field">
        批量添加或删除（一行一个，前面加 = 表示整名比对）
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="account-actions">
        <button className="pill" disabled={busy || !text.trim()} onClick={add}>
          批量添加
        </button>
        <button className="pill danger-pill" disabled={busy || !text.trim()} onClick={removeAll}>
          批量删除
        </button>
      </div>
      {note && <p className="admin-note">{note}</p>}

      <h2>现在的名字里命中的</h2>
      {list?.hits.length === 0 && <p className="hint">没有。</p>}
      <ul>
        {list?.hits.map((h) => (
          <li key={h.id}>
            {h.name}
            {h.anonymous && <span className="hint">（现在是匿名，名字还留着）</span>}{" "}
            <button className="pill" disabled={busy} onClick={() => clear(h)}>
              清掉名字
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 所有玩家, searched on the server (a list of every account would not do at this size): to find someone to act on */
function Players() {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<FoundPlayers | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // searched as one types, once they stop for a moment
  useEffect(() => {
    if (!q.trim()) {
      setFound(null);
      return;
    }
    const t = window.setTimeout(() => {
      call<FoundPlayers>("findPlayers", q)
        .then((f) => {
          setFound(f);
          setNote(null);
        })
        .catch((e) => setNote(e instanceof Error ? e.message : "出了点问题。"));
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <section className="admin-case">
      <h2>所有玩家</h2>
      <p className="hint">只用来找到要处理的人。这里不放蟑螂位置、游戏 UID 和哪天来过。</p>
      <label className="field">
        按邮箱、名字或账号 ID 找
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="比如 @qq.com、一个名字，或 ID 的开头" />
      </label>
      {note && <p className="admin-note">{note}</p>}
      {!q.trim() ? (
        <p className="hint">输入邮箱、名字或账号 ID 找人</p>
      ) : !found ? null : found.total === 0 ? (
        <p className="hint">没找到。</p>
      ) : (
        <>
          <p className="hint">
            找到 {found.total} 个{found.total > found.players.length && `，这里列出最新注册的 ${found.players.length} 个`}
          </p>
          <ul className="player-list">
            {found.players.map((p) => (
              <li key={p.id}>
                <strong>{p.name || "（没有名字）"}</strong>
                {p.anonymous && <span className="tag">匿名</span>}
                <br />
                <span className="hint">
                  {p.email} · {beijingDate(p.joinedAt)} 注册 · ID {p.id.slice(0, 8)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** 查邮箱: whether a mailbox was banned, however it is written, when and why; and who signs in with that very address */
function BanLookup() {
  const [email, setEmail] = useState("");
  const [info, setInfo] = useState<BanInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const look = async () => {
    setBusy(true);
    try {
      setInfo(await call<BanInfo>("banInfo", email));
      setNote(null);
    } catch (e) {
      setInfo(null);
      setNote(e instanceof Error ? e.message : "出了点问题。");
    }
    setBusy(false);
  };
  return (
    <section className="admin-case">
      <h2>查邮箱</h2>
      <p className="hint">看一个邮箱有没有被封过，连同它的其他写法（加了「+」的、Gmail 加了点的都算同一个）。</p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) void look();
        }}
      >
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="要查的邮箱" />
        <button className="pill" type="submit" disabled={busy || !email.trim()}>
          查
        </button>
      </form>
      {note && <p className="admin-note">{note}</p>}
      {info && (
        <>
          <p>
            <strong>{info.banned ? `封过：${beijingDayWords(info.banned.at)}，原因：${ruleWords(info.banned.reason)}` : "没封过"}</strong>
          </p>
          {info.accounts.length === 0 ? (
            <p className="hint">现在没有用这个邮箱的账号。</p>
          ) : (
            <ul className="player-list">
              {info.accounts.map((p) => (
                <li key={p.id}>
                  <strong>{p.name || "（没有名字）"}</strong>
                  {p.anonymous && <span className="tag">匿名</span>}
                  <br />
                  <span className="hint">
                    {p.email} · {beijingDate(p.joinedAt)} 注册 · ID {p.id.slice(0, 8)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** 内测功臣 is handed out here, and any badge can be taken back from someone gaming it. */
function BadgeDesk() {
  const [email, setEmail] = useState("");
  const [badge, setBadge] = useState("beta");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const run = async (give: boolean) => {
    if (!give && !window.confirm("确定收回这个称号吗？")) return;
    setBusy(true);
    try {
      await call(give ? "giveBadge" : "takeBadge", email, give ? "beta" : badge);
      setNote(give ? "发好了，TA 下次打开网站时会看到。" : "收回了。");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "出了点问题。");
    }
    setBusy(false);
  };
  return (
    <section className="admin-case">
      <h2>称号</h2>
      <label className="field">
        玩家的登录邮箱
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </label>
      <div className="account-actions">
        <button className="pill" disabled={busy || !email.trim()} onClick={() => run(true)}>
          发「内测功臣」
        </button>
      </div>
      <label className="field">
        收回哪个称号
        <select value={badge} onChange={(e) => setBadge(e.target.value)}>
          {BADGES.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <div className="account-actions">
        <button className="pill danger-pill" disabled={busy || !email.trim()} onClick={() => run(false)}>
          收回
        </button>
      </div>
      {note && <p className="admin-note">{note}</p>}
    </section>
  );
}
