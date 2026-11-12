"use client";

import { useCallback, useEffect, useState } from "react";
import { clockWords, CODE_TRIES, VIEW_LIMIT, type AdminLogEntry, type AdminLogFilter, type AdminLogPage } from "@/lib/adminConsole";
import { errorWords } from "./api";
import { useConsole } from "./context";
import { isAlert, LOG_KIND, logText, stepWords } from "./words";

/**
 * 操作记录: everything done in the 管理台, every look at an account and every search, and the door's own lines, the
 * newest first, by kind and (the owner) by who; today's numbers on top. What may still be given back has 撤销 beside
 * it. A moderator sees only their own, and a ban they asked for says what the owner answered.
 */

/** What became of a ban asked for, after its line */
function answerWords(e: AdminLogEntry, owner: boolean) {
  if (e.what !== "act.banRequest") return "";
  if (e.answer === "done") return "（站长确认了，封了）";
  if (e.answer === "declined") return "（站长没同意）";
  // the account went another way meanwhile (banned from elsewhere, or deleted by its owner): nothing waits
  if (e.gone) return "";
  return owner ? "（等你确认）" : "（等站长确认）";
}

const FILTERS: [AdminLogFilter, string][] = [
  ["all", "全部"],
  ["act", "处理"],
  ["look", "查看和搜索"],
  ["gate", "验证和登录"],
  ["admin", "管理员变动"],
];

export default function Log() {
  const { call, say, go, gate } = useConsole();
  const owner = gate.role === "owner";
  const [kind, setKind] = useState<AdminLogFilter>("all");
  // the owner's: everyone's, or one person's
  const [who, setWho] = useState("");
  const [page, setPage] = useState<AdminLogPage | null>(null);
  const [more, setMore] = useState<AdminLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPage(await call<AdminLogPage>("log", [{ kind, ...(who ? { who } : {}) }]));
      setMore([]);
      setNote(null);
    } catch (e) {
      setNote(errorWords(e));
    }
  }, [call, kind, who]);
  useEffect(() => {
    void load();
  }, [load]);

  const entries = [...(page?.entries ?? []), ...more];
  const loadMore = async () => {
    const last = entries[entries.length - 1];
    if (!last) return;
    setBusy(true);
    try {
      const next = await call<AdminLogPage>("log", [{ kind, before: last.id, ...(who ? { who } : {}) }]);
      setMore((m) => [...m, ...next.entries]);
      setPage((p) => (p ? { ...p, more: next.more } : p));
    } catch (e) {
      setNote(errorWords(e));
    }
    setBusy(false);
  };
  const undo = async (e: AdminLogEntry) => {
    try {
      await call("undo", [e.actionId]);
      say(`撤销了${e.actor === gate.alias ? "" : `${e.actor}的`}「${stepWords(e)}」，TA 会在消息里看到。`);
      await load();
    } catch (err) {
      say(errorWords(err));
    }
  };

  const now = Date.now();
  const today = page?.today;
  const people = page?.people ?? [];
  const byWho = people.length > 1 ? people.map((p) => `${p.alias === gate.alias ? "你" : p.alias} ${p.acts}`).join(" · ") : null;
  return (
    <>
      <div className="ac-stats">
        <div className="ac-stat">
          <div className="ac-muted small">今天处理</div>
          <div className="ac-stat-n">{today ? `${today.acts} 件` : "…"}</div>
          <div className="ac-muted small">{byWho ?? "警告、清名字、黑名单这些都算"}</div>
        </div>
        <div className="ac-stat">
          <div className="ac-muted small">今天查看</div>
          <div className="ac-stat-n">{today ? `${today.views} 次` : "…"}</div>
          <div className="ac-muted small">{owner ? "打开账号、待处理和地图上的蟑螂" : `一小时打开到 ${VIEW_LIMIT} 个账号，管理台会暂停`}</div>
        </div>
        <div className="ac-stat">
          <div className="ac-muted small">今天搜索</div>
          <div className="ac-stat-n">{today ? `${today.searches} 次` : "…"}</div>
          <div className="ac-muted small">搜的词也记下来（邮箱和 UID 打码）</div>
        </div>
        <div className={`ac-stat${today?.fails ? " warn" : ""}`}>
          <div className="small">今天验证码输错</div>
          <div className="ac-stat-n">{today ? `${today.fails} 次` : "…"}</div>
          <div className="small">连续错 {CODE_TRIES} 次会暂停，并发邮件告诉{owner ? "你" : "站长"}</div>
        </div>
      </div>

      <div className="ac-filters">
        <div className="ac-chips" role="group" aria-label="按种类筛">
          {FILTERS.filter(([k]) => owner || k !== "admin").map(([k, label]) => (
            <button key={k} type="button" className="ac-chip dark" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
        {owner && people.length > 1 && (
          <label className="ac-inline-label">
            谁
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">所有人</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.alias === gate.alias ? "你" : p.alias}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {note && <p className="ac-notice">{note}</p>}

      <section className="ac-panel ac-log" aria-label="记录">
        <div className="ac-list-head">
          <span>新的在上面 · 留 1 年</span>
          <span>{entries.length} 条{page?.more ? "，还有更早的" : ""}</span>
        </div>
        {entries.map((e) => {
          const k = isAlert(e) ? LOG_KIND.alert : LOG_KIND[e.kind];
          return (
            <div key={e.id} className={`ac-log-row${isAlert(e) ? " alert" : ""}`}>
              <span className="ac-log-at">{clockWords(e.at, now)}</span>
              <strong className="ac-log-who">{e.actor === gate.alias ? "你" : e.actor}</strong>
              <span className="ac-log-kind" style={{ background: k.bg, color: k.fg }}>
                {k.name}
              </span>
              <span className={`ac-log-text${e.undone ? " undone" : ""}`}>
                {logText(e)}
                {answerWords(e, owner)}
                {e.undone ? "（撤销了）" : ""}
              </span>
              {e.target ? (
                <button type="button" className="ac-link" onClick={() => go({ page: "accounts", account: e.target!.id })}>
                  {e.target.name}
                </button>
              ) : (
                e.gone && <span className="ac-muted small">账号已经不在了</span>
              )}
              {e.canUndo && !e.undone && (
                <button type="button" className="ac-btn small" onClick={() => undo(e)}>
                  撤销
                </button>
              )}
            </div>
          );
        })}
        {page && entries.length === 0 && <p className="ac-list-empty">没有这样的记录。</p>}
        {!page && !note && <p className="ac-list-empty">正在读取…</p>}
        {page?.more && (
          <div className="ac-pager">
            <button type="button" className="ac-btn" onClick={loadMore} disabled={busy}>
              再往前看
            </button>
          </div>
        )}
      </section>
    </>
  );
}
