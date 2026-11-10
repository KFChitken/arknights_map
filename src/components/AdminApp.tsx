"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { BADGES } from "@/lib/badges";
import { GAME_NAMES } from "@/lib/games";
import { CODE_WORDS, type NameWord } from "@/lib/nameRules";
import { beijingDate, beijingDayWords, beijingShort } from "@/lib/beijing";
import { BLOCKS_TO_REVIEW, BLOCKS_WINDOW_DAYS, PROFILE_REPORTS_TO_HOLD, SUSPEND_DAYS, YELLOW_DAYS, YELLOWS_TO_WORRY } from "@/lib/rules";
import {
  CASE_LEVELS,
  REPORT_REASONS,
  RULES,
  type AdminAction,
  type AdminCase,
  type AdminPlayer,
  type CaseLevel,
  type ReporterInfo,
  type ReportReason,
  type RetentionStats,
  type RuleCode,
} from "@/lib/safety";
import { lasted, LEVEL_MARK, type IncidentView, type SiteStatus } from "@/lib/siteStatus";
import { ago } from "./app/InboxSheet";
import RoachIcon from "./RoachIcon";

/**
 * /admin: what the site's own checks found (网站状态), this week's totals, open
 * reports grouped by player with the ways to settle them, the name blocklist,
 * every account's email and name, and badges by hand. The API refuses everyone
 * but the admins.
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
  ban: "封号了：账号和数据都删了，这个邮箱（连同它的其他写法）不能再登录。",
};

/** The keys of the queue: only while typing nowhere; a ban always needs its button and a confirm */
const KEYS: Record<string, AdminAction> = { d: "dismiss", n: "clearName", u: "clearUid", w: "warn", s: "suspend" };

const LEVEL_NAMES: Record<CaseLevel, string> = { red: "红", yellow: "黄", green: "绿" };

/** Whether a reported player filled in a UID for a game they play */
const hasUid = (c: AdminCase) => c.games.some((g) => g.uid);

/** 「骚扰刷屏 2、名字不合适 1」, or why a case without reports is one */
function reasonsOf(c: AdminCase) {
  if (!c.reports.length) return `${BLOCKS_WINDOW_DAYS} 天内被 ${c.blockedRecently} 个人拉黑`;
  const n = new Map<string, number>();
  for (const r of c.reports) n.set(REPORT_REASONS[r.reason], (n.get(REPORT_REASONS[r.reason]) ?? 0) + 1);
  return [...n].map(([reason, k]) => `${reason} ${k}`).join("、");
}

/** 「关掉过 3 次，警告过 1 次……」 */
function settledWords(s: AdminCase["settled"]) {
  const parts = [
    s.dismissed && `关掉过 ${s.dismissed} 次`,
    s.warned && `警告过 ${s.warned} 次`,
    s.suspended && `暂停过 ${s.suspended} 次`,
    s.nameCleared && `清过名字 ${s.nameCleared} 次`,
    s.uidCleared && `清过 UID ${s.uidCleared} 次`,
    s.ageChecks && `请 TA 确认过 ${s.ageChecks} 次年龄`,
  ].filter(Boolean);
  return parts.length ? parts.join("，") : "没有";
}

/** How a reporter's reports went before, never who they are */
function reporterWords(r: ReporterInfo | null) {
  if (!r) return "举报人已注销";
  const before = r.upheld + r.dismissed ? `以前举报 ${r.upheld + r.dismissed} 次，${r.dismissed} 次判了没问题` : "以前没举报过";
  return `注册 ${r.days} 天 · ${before}${r.reliable ? "" : " · 不算进自动处理"}`;
}

function tagsOf(c: AdminCase) {
  return [
    c.heldAt ? "先藏起来了" : c.anonymous ? "现在是匿名" : null,
    c.suspendedAuto ? "自动暂停中" : c.suspendedUntil ? "暂停中" : null,
    c.brigade ? "可能是一起来刷的" : null,
    c.ageCheckAt ? "等 TA 确认年龄" : null,
  ].filter((t): t is string => Boolean(t));
}

export default function AdminApp() {
  const [cases, setCases] = useState<AdminCase[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // bumped when a case card adds to the name list, so the list below reads it again
  const [wordsAdded, setWordsAdded] = useState(0);

  const load = useCallback(async () => {
    try {
      setCases(await call<AdminCase[]>("cases"));
    } catch (e) {
      if (e instanceof Error && e.message === "forbidden") setForbidden(true);
      else setNote(e instanceof Error ? e.message : "出了点问题。");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

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
      <Cases cases={cases} note={note} setNote={setNote} reload={load} onWordsAdded={() => setWordsAdded((n) => n + 1)} />
      <NameList added={wordsAdded} />
      <Players />
      <BadgeDesk />
      <p className="hint" style={{ marginTop: 24 }}>
        <Link href="/">回到地图</Link>
      </p>
    </main>
  );
}

/**
 * 举报处理: one row a case, the most pressing first, opened to its card; filters by colour and reason,
 * 名字快审 for cases only about a name, several at once, and keys for going through them quickly.
 */
function Cases({
  cases,
  note,
  setNote,
  reload,
  onWordsAdded,
}: {
  cases: AdminCase[] | null;
  note: string | null;
  setNote: (n: string | null) => void;
  reload: () => Promise<void>;
  onWordsAdded: () => void;
}) {
  const [level, setLevel] = useState<CaseLevel | "all">("all");
  const [reason, setReason] = useState<ReportReason | "blocks" | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [quick, setQuick] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  const shown = (cases ?? []).filter(
    (c) =>
      (level === "all" || c.level === level) &&
      (reason === "all" || (reason === "blocks" ? !c.reports.length : c.reports.some((r) => r.reason === reason))),
  );
  const nameOnly = (cases ?? []).filter((c) => c.reports.length > 0 && c.reports.every((r) => r.reason === "name"));

  const run = useCallback(
    async (fn: () => Promise<string>) => {
      setBusy(true);
      try {
        setNote(await fn());
        await reload();
      } catch (e) {
        setNote(e instanceof Error ? e.message : "出了点问题。");
      }
      setBusy(false);
    },
    [reload, setNote],
  );

  const settle = useCallback(
    (c: AdminCase, action: AdminAction, rule?: RuleCode) => {
      if (action === "ban" && !window.confirm("封号会删除这个账号和 TA 的所有数据，这个邮箱以后不能再登录。确定吗？")) return;
      return run(async () => {
        await call("resolve", c.targetId, action, rule);
        return action === "dismiss" && c.heldAt ? "关掉了这些举报，TA 的名字和 UID 恢复了。" : DONE[action];
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
      else if ((e.key === "Enter" || e.key === "o") && c) setOpen((o) => (o === c.targetId ? null : c.targetId));
      else if (KEYS[e.key] && c) {
        if (KEYS[e.key] === "clearName" && !c.name) return;
        if (KEYS[e.key] === "clearUid" && !hasUid(c)) return;
        void settle(c, KEYS[e.key]);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, cursor, busy, settle]);

  const counts = CASE_LEVELS.map((l) => [l, (cases ?? []).filter((c) => c.level === l).length] as const);
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
        红的（可能未成年、留了联系方式）先看，再黄的、绿的；同一色里可靠的举报人多的在前。名字、联系方式、冒充这三类凑满 {PROFILE_REPORTS_TO_HOLD}{" "}
        个可靠的人，TA 的名字和 UID 会先藏起来。点开一行看详细；快捷键（不在输入框里时）：j、k 上下，Enter 或 o 点开，d 没问题，n 清名字，u 只清
        UID，w 警告，s 暂停 {SUSPEND_DAYS} 天。封号只能点按钮。
      </p>
      {note && <p className="admin-note">{note}</p>}
      {cases === null && !note && <p>正在读取…</p>}
      {cases?.length === 0 && <p>没有待处理的举报。</p>}
      {cases && cases.length > 0 && (
        <>
          <div className="case-filters">
            <div className="seg" role="group" aria-label="按轻重筛">
              <button className={level === "all" ? "on" : ""} onClick={() => setLevel("all")}>
                全部 {cases.length}
              </button>
              {counts.map(([l, n]) => (
                <button key={l} className={level === l ? "on" : ""} onClick={() => setLevel(l)}>
                  <span className={`dot ${l}`} /> {LEVEL_NAMES[l]} {n}
                </button>
              ))}
            </div>
            <select value={reason} onChange={(e) => setReason(e.target.value as ReportReason | "blocks" | "all")} aria-label="按理由筛">
              <option value="all">所有理由</option>
              {(Object.keys(REPORT_REASONS) as ReportReason[]).map((r) => (
                <option key={r} value={r}>
                  {REPORT_REASONS[r]}
                </option>
              ))}
              <option value="blocks">被很多人拉黑</option>
            </select>
            {nameOnly.length > 0 && (
              <button className="pill" onClick={() => setQuick((q) => !q)}>
                名字快审（{nameOnly.length}）
              </button>
            )}
          </div>

          {quick && <QuickNames cases={nameOnly} busy={busy} onSettle={settleMany} onClose={() => setQuick(false)} />}

          {picked.size > 0 && (
            <div className="batch-bar">
              选了 {picked.size} 个：
              <button className="pill" disabled={busy} onClick={() => settleMany([...picked], "dismiss", DONE.dismiss)}>
                没问题
              </button>
              <button className="pill" disabled={busy} onClick={() => settleMany([...picked], "clearName", "名字清掉了")}>
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
              <li key={c.targetId} className={i === Math.min(cursor, shown.length - 1) ? "cursor" : ""}>
                <div className="case-row" onClick={() => {
                  setCursor(i);
                  setOpen((o) => (o === c.targetId ? null : c.targetId));
                }}>
                  <input
                    type="checkbox"
                    aria-label="选中这一个"
                    checked={picked.has(c.targetId)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggle(c.targetId)}
                  />
                  <span className={`dot ${c.level}`} aria-label={LEVEL_NAMES[c.level]} />
                  <div className="case-row-text">
                    <strong>{c.name && !c.anonymous ? `${c.drPrefix ? "Dr. " : ""}${c.name}` : "匿名"}</strong>{" "}
                    <span className="hint">
                      {reasonsOf(c)}
                      {c.reports.length > 0 && ` · ${c.reporters} 人举报（${c.reliable} 个可靠）`} · 等了 {lasted(now - c.since)}
                    </span>
                    {tagsOf(c).map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                {open === c.targetId && <CaseCard c={c} busy={busy} onSettle={settle} onBlockName={blockName} />}
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="hint">这一类没有。</p>}
        </>
      )}
    </>
  );
}

/** 名字快审: every case only about a name in one list; tick the names to clear, the rest are fine */
function QuickNames({
  cases,
  busy,
  onSettle,
  onClose,
}: {
  cases: AdminCase[];
  busy: boolean;
  onSettle: (ids: string[], action: AdminAction, done: string) => Promise<void>;
  onClose: () => void;
}) {
  const [bad, setBad] = useState<Set<string>>(new Set());
  const rest = cases.filter((c) => !bad.has(c.targetId)).map((c) => c.targetId);
  return (
    <section className="admin-case quick-names">
      <h2>名字快审 · {cases.length} 个</h2>
      <p className="hint">勾上要清掉的名字，再点下面的按钮；没勾的就是没问题。</p>
      <ul className="case-rows">
        {cases.map((c) => (
          <li key={c.targetId}>
            <label className="check">
              <input
                type="checkbox"
                checked={bad.has(c.targetId)}
                onChange={(e) =>
                  setBad((b) => {
                    const next = new Set(b);
                    if (e.target.checked) next.add(c.targetId);
                    else next.delete(c.targetId);
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

/** One case opened: who it is, what they did, the reports with their reporters' record, and the ways to settle it */
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
  return (
    <section className="admin-case">
      <div className="who-card">
        <RoachIcon color={c.color} size={44} avatar={c.avatar} />
        <div>
          <strong>{c.name ? `${c.drPrefix ? "Dr. " : ""}${c.name}` : "（没有名字）"}</strong>
          {tagsOf(c).map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
          <p className="hint">
            {ago(c.joinedAt)}注册 · 最近 24 小时碰了 {c.last24h.touches} 次、发了 {c.last24h.declarations} 条宣言
          </p>
          {c.heldAt && <p className="hint">名字和 UID 先藏起来了（{ago(c.heldAt)}）</p>}
        </div>
      </div>
      <dl className="admin-facts">
        <dt>邮箱</dt>
        <dd>{c.email || "（没有）"}</dd>
        {c.games.length === 0 && (
          <>
            <dt>游戏</dt>
            <dd>没填</dd>
          </>
        )}
        {c.games.map((g) => (
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
          {c.shareUid ? "大胆碰过的人能看到" : "只有自己"}
          {c.heldAt && c.shareUid && "（现在先藏起来了）"}
        </dd>
        {c.support.length > 0 && (
          <>
            <dt>我的助战</dt>
            <dd>{c.support.join("、")}</dd>
          </>
        )}
        <dt>称号</dt>
        <dd>
          {c.badges.length ? `${c.badges.length} 个：${c.badges.join("、")}` : "没有"}
          {c.worn && `；戴着「${c.worn}」`}
        </dd>
        <dt>蟑螂</dt>
        <dd>
          {c.roaches.main ? "放了本体" : "没放本体"}
          {c.roaches.clones > 0 && `，${c.roaches.clones} 只克隆体`}
        </dd>
        <dt>触须之交</dt>
        <dd>{c.friends} 个</dd>
        <dt>被拉黑</dt>
        <dd>
          一共 {c.blockedBy} 个人
          {c.blockedRecently > 0 && `；${BLOCKS_WINDOW_DAYS} 天内被 ${c.blockedRecently} 个人拉黑`}
        </dd>
        <dt>黄牌</dt>
        <dd className={c.yellow >= YELLOWS_TO_WORRY ? "warn-text" : ""}>
          {c.yellow >= YELLOWS_TO_WORRY ? `${YELLOW_DAYS} 天内已经 ${c.yellow} 张黄牌，可以考虑封号` : `${YELLOW_DAYS} 天内 ${c.yellow} 张`}
        </dd>
        {c.suspendedUntil && (
          <>
            <dt>暂停互动</dt>
            <dd>
              到 {beijingDayWords(c.suspendedUntil)}
              {c.suspendedAuto && "（是举报自动暂停的，你处理时会先解除）"}
            </dd>
          </>
        )}
        {(c.ageCheckAt || c.settled.ageChecks > 0) && (
          <>
            <dt>年龄</dt>
            <dd>
              {c.ageCheckAt
                ? `等 TA 确认年龄（${ago(c.ageCheckAt)}请的）`
                : c.ageConfirmedAt
                  ? `${ago(c.ageConfirmedAt)}确认过满 18 岁`
                  : "确认过"}
            </dd>
          </>
        )}
        <dt>以前的处理</dt>
        <dd>{settledWords(c.settled)}</dd>
      </dl>

      {c.reports.length > 0 ? (
        <>
          <h2>
            被 {c.reporters} 个人举报（{c.reliable} 个可靠）
          </h2>
          <ul>
            {c.reports.map((r, i) => (
              <li key={i}>
                <strong>{REPORT_REASONS[r.reason]}</strong>
                {r.note && <>：{r.note}</>}
                <br />
                <span className="hint">
                  {ago(r.at)} · {r.context} · 当时的名字：{r.name}
                </span>
                <br />
                <span className="hint">举报人：{reporterWords(r.reporter)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="hint">没有举报：{BLOCKS_WINDOW_DAYS} 天内被 {c.blockedRecently} 个不同的人拉黑了。处理以后，再被拉黑 {BLOCKS_TO_REVIEW} 次才会再列出来。</p>
      )}

      {c.declarations.length > 0 && (
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

/** 所有玩家: login email, name and signup day of every account, to find the one a letter or report is about. */
function Players() {
  const [players, setPlayers] = useState<AdminPlayer[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    call<AdminPlayer[]>("players")
      .then(setPlayers)
      .catch(() => {});
  }, []);
  if (!players) return null;
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? players.filter((p) => p.email.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle) || p.id.startsWith(needle))
    : players;
  return (
    <section className="admin-case">
      <h2>所有玩家 · {players.length} 人</h2>
      <p className="hint">只用来找到要处理的人。这里不放蟑螂位置、游戏 UID 和哪天来过。</p>
      <label className="field">
        按邮箱、名字或账号 ID 找
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <ul className="player-list">
        {shown.map((p) => (
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
