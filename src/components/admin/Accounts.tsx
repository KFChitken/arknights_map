"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ACCOUNT_ACTIONS, type AdminAccount, type AdminHistoryItem, type AdminNote, type AdminRole, type FoundAccount, type FoundAccounts } from "@/lib/adminConsole";
import { beijingDate, beijingShort } from "@/lib/beijing";
import { SUSPEND_DAYS, YELLOW_DAYS } from "@/lib/rules";
import { reasonWords, RULES, type AdminAction, type RuleCode } from "@/lib/safety";
import { ago } from "../app/InboxSheet";
import { AdminError, errorWords } from "./api";
import BanBox, { BanRequestBox } from "./BanBox";
import { useConsole } from "./context";
import { Empty, Facts, Mark, Tag } from "./ui";
import { ACTION_WORDS, HELD_WORDS, historyWords, joinedWords, personFacts, reporterWords, savedName } from "./words";

/**
 * 搜索账号: find anyone by name, the start of their id, a game UID or (the owner) their email; open them to see what
 * they wrote, the reports about them, what was done and the notes on them, and act on them even unreported, under
 * a rule picked first. Every search and every account opened goes into the 操作记录. A moderator never finds the
 * 管理台's own people, sees emails masked, and asks the owner for a ban instead of banning.
 */

/** Of the 管理台's own people (only the owner finds them) */
const staffWords = (staff: AdminRole | null) => (staff === "owner" ? "站长" : staff === "mod" ? "管理员" : null);

type Tab = "info" | "reports" | "history" | "notes";
type AccountAct = Exclude<(typeof ACCOUNT_ACTIONS)[number], "ban">;

const RESOLUTION_WORDS: Record<string, string> = {
  name_cleared: "清掉了名字",
  uid_cleared: "清掉了 UID",
  both_cleared: "清掉了名字和 UID",
  warned: "警告了 TA",
  suspended: "暂停了 TA 的互动",
  age_check: "请 TA 确认年龄",
  roach_removed: "收回了蟑螂",
};

function badgesOf(a: Pick<FoundAccount, "suspendedUntil" | "yellow" | "open" | "held" | "anonymous">, now: number) {
  const days = a.suspendedUntil ? Math.max(1, Math.ceil((a.suspendedUntil - now) / 86_400_000)) : 0;
  return [
    ...(a.suspendedUntil && a.suspendedUntil > now ? [{ text: `暂停中，还有 ${days} 天`, kind: "warn" as const }] : []),
    ...(a.yellow ? [{ text: `${YELLOW_DAYS} 天内 ${a.yellow} 张黄牌`, kind: "warn" as const }] : []),
    ...(a.open ? [{ text: `${a.open} 件待处理`, kind: "open" as const }] : []),
    ...(a.held ? [{ text: "名字和 UID 先藏起来了", kind: "plain" as const }] : a.anonymous ? [{ text: "自己选了匿名", kind: "plain" as const }] : []),
  ];
}

export default function Accounts({ start }: { start?: string }) {
  const { call, say, gate } = useConsole();
  const owner = gate.role === "owner";
  const [q, setQ] = useState("");
  const [found, setFound] = useState<FoundAccounts | null>(null);
  const [sel, setSel] = useState<string | null>(start ?? null);
  const [note, setNote] = useState<string | null>(null);

  // searched once typing stops a moment, not on every key: each search goes into the 操作记录
  useEffect(() => {
    const needle = q.trim();
    if (!needle) {
      setFound(null);
      return;
    }
    const t = window.setTimeout(() => {
      call<FoundAccounts>("findPlayers", [needle])
        .then((f) => {
          setFound(f);
          setNote(null);
        })
        .catch((e) => setNote(errorWords(e)));
    }, 500);
    return () => window.clearTimeout(t);
  }, [q, call]);

  // the account open beside the list, read again after a step: its row says what it says now
  const fresh = useCallback((a: AdminAccount) => {
    const p = a.person;
    setFound((f) =>
      f && {
        ...f,
        players: f.players.map((x) =>
          x.id === p.targetId ? { ...x, name: p.name, suspendedUntil: p.suspendedUntil, yellow: p.yellow, open: a.openCases, held: Boolean(p.heldAt), anonymous: p.anonymous } : x,
        ),
      },
    );
  }, []);

  const now = Date.now();
  return (
    <>
      <div className="ac-panel ac-search">
        <label htmlFor="ac-find">找人</label>
        <input
          id="ac-find"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={owner ? "名字、ID 开头几位或游戏 UID，或邮箱" : "名字、账号 ID 的开头或游戏 UID"}
          autoFocus={!start}
        />
        <span className="ac-hint">
          {owner ? "每次搜索都会记进操作记录（邮箱和 UID 打码记）。" : "管理员不能按邮箱找，看到的邮箱也是打码的。每次搜索都会记进操作记录。"}
        </span>
      </div>
      {note && <p className="ac-notice">{note}</p>}
      <div className="ac-split accounts">
        <section className="ac-panel ac-list narrow" aria-label="找到的账号">
          <div className="ac-list-head">
            <span>{!q.trim() ? "还没输入" : !found ? "正在找…" : found.total > found.players.length ? `找到 ${found.total} 个，这里是最新注册的 ${found.players.length} 个` : `找到 ${found.total} 个，最新注册的在前`}</span>
          </div>
          <div className="ac-list-rows">
            {(found?.players ?? []).map((p) => (
              <button key={p.id} type="button" className={`ac-account-row${sel === p.id ? " on" : ""}`} aria-current={sel === p.id || undefined} onClick={() => setSel(p.id)}>
                <span className="ac-row-top">
                  <Mark name={p.name} size={28} />
                  <strong>{p.name || "（没有名字）"}</strong>
                  {staffWords(p.staff) && <Tag>{staffWords(p.staff)}</Tag>}
                </span>
                <span className="ac-row-meta">
                  {p.email} · {joinedWords(p.joinedAt, now)} · ID {p.id.slice(0, 8)}
                </span>
                {badgesOf(p, now).length > 0 && (
                  <span className="ac-row-tags">
                    {badgesOf(p, now).map((b) => (
                      <Tag key={b.text} kind={b.kind}>
                        {b.text}
                      </Tag>
                    ))}
                  </span>
                )}
              </button>
            ))}
            {(!found || found.players.length === 0) && (
              <p className="ac-list-empty">{q.trim() && found ? "没找到。" : owner ? "输入名字、账号 ID、UID 或邮箱。" : "输入名字、账号 ID 或 UID。"}</p>
            )}
          </div>
        </section>
        <section className="ac-panel ac-detail" aria-label="账号详情">
          {sel ? <AccountDetail key={sel} id={sel} onRead={fresh} onGone={() => say("这个账号已经不在了。")} /> : <Empty>在上面输入，找到的人会列在左边。</Empty>}
        </section>
      </div>
    </>
  );
}

function AccountDetail({ id, onRead, onGone }: { id: string; onRead: (a: AdminAccount) => void; onGone: () => void }) {
  const { call, hold, say, go, gate, recount } = useConsole();
  const [a, setA] = useState<AdminAccount | null>(null);
  const [gone, setGone] = useState<"banned" | "gone" | null>(null);
  const [tab, setTab] = useState<Tab>("info");
  const [rule, setRule] = useState<RuleCode | "">("");
  const [banOpen, setBanOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // read when opened and after each step, not whenever the list beside it changes
  const tell = useRef({ onRead, onGone });
  tell.current = { onRead, onGone };
  const load = useCallback(async () => {
    try {
      const read = await call<AdminAccount>("account", [id]);
      setA(read);
      tell.current.onRead(read);
    } catch (e) {
      if (e instanceof AdminError && e.status === 404) {
        setGone((g) => g ?? "gone");
        tell.current.onGone();
      } else setNote(errorWords(e));
    }
  }, [call, id]);
  useEffect(() => {
    void load();
  }, [load]);
  // after a step: the account as it is now, and 待处理's count if it settled cases there
  const after = useCallback(() => {
    void load();
    recount();
  }, [load, recount]);

  if (gone === "banned") return <p className="ac-banned">已封号：账号和数据都删了，这个邮箱（连同它的其他写法）不能再登录。这条记录留在操作记录里。</p>;
  if (gone) return <Empty>这个账号已经不在了（注销了，或者封了）。</Empty>;
  if (!a) return <Empty>{note ?? "正在读取…"}</Empty>;

  const p = a.person;
  const now = Date.now();
  const suspended = Boolean(p.suspendedUntil && p.suspendedUntil > now);
  const hasUid = p.games.some((g) => g.uid);
  const me = gate.alias;
  const owner = gate.role === "owner";
  const asked = a.banRequest;
  const by = (who: string | null) => (who === me ? "你" : who);

  const act = (action: AccountAct) => {
    if (!rule) return;
    const chosen = rule;
    setTab("history");
    hold({
      text: `${HELD_WORDS[action]}：${savedName(p)}`,
      send: (keepalive) => call<AdminHistoryItem | null>("act", [{ id, action, rule: chosen }], { keepalive }),
      onDone: after,
      onFail: (e) => say(`没做成：${errorWords(e)}`),
    });
  };
  const unsuspend = () =>
    hold({
      text: `已解除暂停：${savedName(p)}`,
      send: (keepalive) => call("unsuspend", [id], { keepalive }),
      onDone: after,
      onFail: (e) => say(`没做成：${errorWords(e)}`),
    });
  const ban = async (fresh: string) => {
    if (!rule) throw new Error("先选一条 TA 违反的规则。");
    await call("act", [{ id, action: "ban", rule }], { fresh: fresh || undefined });
    say(`封号了：${savedName(p)} 的账号和数据都删了，这个邮箱不能再登录。`);
    setGone("banned");
    recount();
  };
  // a moderator's: the owner confirms it, or sends it back
  const askBan = async (why: string) => {
    if (!rule) throw new Error("先选一条 TA 违反的规则。");
    await call("banRequest", [{ id, rule, reason: why }]);
    setBanOpen(false);
    say(`${savedName(p)}：交给站长了，站长确认以后才会封。`);
    after();
  };
  const undo = async (h: AdminHistoryItem) => {
    try {
      await call("undo", [h.actionId]);
      say(`撤销了「${historyWords(h).what}」，TA 会在消息里看到。`);
      after();
    } catch (e) {
      say(errorWords(e));
    }
  };
  const addNote = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const n = await call<AdminNote>("addNote", [id, text]);
      setA((x) => (x ? { ...x, notes: [n, ...x.notes] } : x));
      setText("");
      say("备注加上了，只有管理员看得到。");
    } catch (e) {
      say(errorWords(e));
    }
    setBusy(false);
  };

  const facts = [
    ...personFacts(p, { support: true }),
    ...a.cleared.map((c) => ({ k: c.kind === "name" ? "清掉过的名字" : "清掉过的 UID", v: `「${c.value}」· ${beijingDate(c.at).slice(5).replace("-", "/")}，不能再用` })),
    {
      k: "TA 举报别人",
      v:
        a.reportsMade.upheld + a.reportsMade.dismissed + a.reportsMade.open
          ? `${a.reportsMade.upheld + a.reportsMade.dismissed + a.reportsMade.open} 次：${a.reportsMade.upheld} 次成立，${a.reportsMade.dismissed} 次判了没问题${a.reportsMade.open ? `，${a.reportsMade.open} 次还没处理` : ""}${a.reportsMade.reliable ? "，算进自动处理" : "，不算进自动处理"}`
          : "没举报过",
    },
  ];
  const personOpen = a.reports.some((r) => !r.resolvedAt && !r.roach);
  const ACTS: { action: AccountAct; show: boolean }[] = [
    { action: "warn", show: true },
    { action: "suspend", show: !suspended },
    { action: "clearName", show: Boolean(p.name) },
    { action: "clearUid", show: hasUid },
    { action: "clearBoth", show: Boolean(p.name) && hasUid },
    { action: "ageCheck", show: !p.ageCheckAt },
  ];
  const tabs: [Tab, string][] = [
    ["info", "资料"],
    ["reports", `被举报 ${a.reports.length}`],
    ["history", `处理记录 ${a.history.length}`],
    ["notes", `备注 ${a.notes.length}`],
  ];

  return (
    <div className="ac-stack">
      <div className="ac-person-head">
        <Mark name={p.name} color={p.color} size={52} />
        <div className="ac-person-text">
          <div className="ac-person-title">
            <h2>{savedName(p)}</h2>
            {staffWords(p.staff) && <Tag>{staffWords(p.staff)}</Tag>}
            {badgesOf({ suspendedUntil: p.suspendedUntil, yellow: p.yellow, open: a.openCases, held: Boolean(p.heldAt), anonymous: p.anonymous }, now).map((b) => (
              <Tag key={b.text} kind={b.kind}>
                {b.text}
              </Tag>
            ))}
          </div>
          <div className="ac-sub">
            {joinedWords(p.joinedAt, now)} · 账号 ID {p.targetId.slice(0, 8)} · 邮箱 {p.email || "（没有）"}
          </div>
          <div className="ac-sub">
            最近 24 小时：碰了 {a.last24.touches} 次，发了 {a.last24.declarations} 条宣言
          </div>
        </div>
      </div>

      {asked && (
        <div className="ac-banner">
          <span>
            {owner ? `${asked.by}提请封号，在「待处理」里等你确认。` : asked.mine ? "你已经提请封号，等站长确认。" : `${asked.by}已经提请封号，等站长确认。`}
            {owner && `理由：「${asked.reason}」`}
          </span>
          {owner && (
            <button type="button" className="ac-btn small" onClick={() => go({ page: "cases", caseId: `request:${asked.id}` })}>
              去确认
            </button>
          )}
        </div>
      )}
      {a.openCases > 0 && (owner || !asked) && (
        <div className="ac-banner">
          <span>有 {a.openCases} 件在「待处理」里。在这里处理也行，那边会一起关掉。</span>
          <button type="button" className="ac-btn small" onClick={() => go({ page: "cases", caseId: personOpen ? id : undefined })}>
            去待处理
          </button>
        </div>
      )}

      <div className="ac-account-body">
        <div className="ac-account-main">
          <div className="ac-tabs" role="tablist">
            {tabs.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "info" && (
            <div className="ac-stack">
              <Facts facts={facts} />
              <div>
                <h3 className="ac-h3">最近 7 天的宣言</h3>
                <p className="ac-hint">宣言都是固定的句子，只有名字是 TA 自己填的。名字有问题，清掉名字就行。</p>
                {a.declarations.map((d, i) => (
                  <div key={i} className="ac-line">
                    「{d.text}」<span className="ac-muted small"> · {ago(d.at)}</span>
                  </div>
                ))}
                {!a.declarations.length && <p className="ac-line-none">最近 7 天没发宣言。</p>}
              </div>
              <p className="ac-hint">这里不显示 TA 的蟑螂在哪、哪天来过。</p>
            </div>
          )}

          {tab === "reports" && (
            <div>
              {a.reports.map((r, i) => (
                <div key={i} className="ac-line">
                  <div className="ac-report-head">
                    <strong>
                      {reasonWords(r.reason)}
                      {r.roach ? `（${r.roach.main ? "本体" : "一只克隆体"}）` : ""}
                    </strong>
                    <span className="ac-muted small">{beijingShort(r.at)}</span>
                  </div>
                  {r.note && <div>举报人写：「{r.note}」</div>}
                  <div className={`small ${r.resolvedAt ? "ac-muted" : "ac-open-text"}`}>
                    {!r.resolvedAt
                      ? "还没处理"
                      : r.resolution === "dismissed"
                        ? `判了没问题${r.by ? `（${by(r.by)}）` : ""}`
                        : `成立：${r.by ? by(r.by) : ""}${RESOLUTION_WORDS[r.resolution ?? ""] ?? "处理了"}`}
                    {" · "}
                    {reporterWords(r.reporter)}
                  </div>
                </div>
              ))}
              {!a.reports.length && <p className="ac-line-none">90 天内没人举报过 TA。</p>}
              <p className="ac-hint">举报留 90 天。不显示是谁举报的。</p>
            </div>
          )}

          {tab === "history" && (
            <div>
              {a.history.map((h) => {
                const w = historyWords(h);
                return (
                  <div key={h.actionId} className="ac-line ac-history">
                    <div className="ac-history-text">
                      <div className="ac-muted small">
                        {beijingShort(h.at)} · {h.auto ? "举报自动处理" : by(h.by)}
                      </div>
                      <strong className={h.undoneAt ? "ac-muted" : undefined}>
                        {w.what}
                        {h.undoneAt ? "（已撤销）" : ""}
                      </strong>
                      {w.detail && <div className="small">{w.detail}</div>}
                      {w.status && <div className="ac-muted small">{w.status}</div>}
                    </div>
                    {h.canUndo && (
                      <button type="button" className="ac-btn small" onClick={() => undo(h)}>
                        撤销
                      </button>
                    )}
                  </div>
                );
              })}
              {!a.history.length && <p className="ac-line-none">没处理过 TA。</p>}
              <p className="ac-hint">处理记录留 1 年。玩家只看到「站长」，看不到是谁处理的。</p>
            </div>
          )}

          {tab === "notes" && (
            <div className="ac-stack tight">
              {a.notes.map((n) => (
                <div key={n.id} className="ac-note">
                  <div className="ac-muted small">
                    {by(n.by)} · {beijingShort(n.at)}
                  </div>
                  <div>{n.text}</div>
                </div>
              ))}
              {!a.notes.length && <p className="ac-line-none">还没有备注。</p>}
              <label className="ac-field">
                加一条备注（只有管理员看得到，TA 看不到）
                <textarea rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              <div>
                <button type="button" className="ac-btn" onClick={addNote} disabled={busy || !text.trim()}>
                  加备注
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="ac-act-side" aria-label="处理这个账号">
          <h3 className="ac-h3">处理这个账号</h3>
          <label className="ac-field">
            按哪条社区守则
            <select className={rule ? undefined : "need"} value={rule} onChange={(e) => setRule(e.target.value as RuleCode | "")}>
              <option value="">先选一条</option>
              {(Object.keys(RULES) as RuleCode[]).map((r) => (
                <option key={r} value={r}>
                  {RULES[r]}
                </option>
              ))}
            </select>
          </label>
          {!rule && <p className="ac-need-rule">没人举报时也要选一条，TA 收到的站长通知会写明。</p>}
          <div className="ac-side-acts">
            {ACTS.filter((x) => x.show).map((x) => (
              <button key={x.action} type="button" className="ac-btn" disabled={!rule} onClick={() => act(x.action)}>
                {ACTION_WORDS[x.action as AdminAction]}
              </button>
            ))}
            {suspended && (
              <button type="button" className="ac-btn" onClick={unsuspend}>
                解除暂停（还有 {Math.max(1, Math.ceil((p.suspendedUntil! - now) / 86_400_000))} 天）
              </button>
            )}
            {(owner || !asked) && (
              <button type="button" className="ac-btn danger" onClick={() => setBanOpen((o) => !o)} aria-expanded={banOpen}>
                {owner ? "封号…" : "提请封号…"}
              </button>
            )}
          </div>
          {banOpen &&
            (!rule ? (
              <p className="ac-need-rule">{owner ? "封号也要先在上面选一条 TA 违反的规则。" : "提请封号也要先在上面选一条 TA 违反的规则。"}</p>
            ) : owner ? (
              <BanBox onBan={ban} onClose={() => setBanOpen(false)} />
            ) : (
              <BanRequestBox onAsk={askBan} onClose={() => setBanOpen(false)} />
            ))}
          <p className="ac-hint">TA 会在消息里收到站长通知，写明按哪条守则，可以申诉一次（暂停 {SUSPEND_DAYS} 天、封号也一样写明）。</p>
        </aside>
      </div>
    </div>
  );
}
