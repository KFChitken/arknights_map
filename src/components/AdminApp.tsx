"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BADGES } from "@/lib/badges";
import { CODE_WORDS, type NameWord } from "@/lib/nameRules";
import { beijingDate } from "@/lib/beijing";
import { REPORT_REASONS, type AdminAction, type AdminCase, type AdminPlayer, type RetentionStats } from "@/lib/safety";
import { ago } from "./app/InboxSheet";
import RoachIcon from "./RoachIcon";

/**
 * /admin: this week's totals, open reports grouped by player with the three
 * ways to settle them, the name blocklist, every account's email and name, and
 * badges by hand. The API refuses everyone but the admins.
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
  dismiss: "关掉了这些举报。",
  clearName: "名字清掉了，TA 现在是匿名。",
  ban: "封号了：账号和数据都删了，这个邮箱不能再登录。",
};

export default function AdminApp() {
  const [cases, setCases] = useState<AdminCase[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

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

  const resolve = async (c: AdminCase, action: AdminAction) => {
    if (action === "ban" && !window.confirm("封号会删除这个账号和 TA 的所有数据，这个邮箱以后不能再登录。确定吗？")) return;
    setBusy(c.targetId);
    try {
      await call("resolve", c.targetId, action);
      setNote(DONE[action]);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "出了点问题。");
    }
    setBusy(null);
  };

  if (forbidden) {
    return (
      <main className="doc">
        <h1>管理</h1>
        <p>这个页面只有管理员能打开。请先在地图上用管理员的邮箱登录。</p>
        <p>
          <Link href="/">回到地图</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="doc admin">
      <h1>管理</h1>
      <Retention />

      <h2>举报处理</h2>
      <p className="hint">
        同一个人的举报放在一起。「没问题」只关掉举报；「清掉名字」把 TA 改成匿名；「封号」删掉账号和所有数据，这个邮箱以后不能再登录。
      </p>
      {note && <p className="admin-note">{note}</p>}
      {cases === null && !note && <p>正在读取…</p>}
      {cases?.length === 0 && <p>没有待处理的举报。</p>}
      {cases?.map((c) => (
        <section key={c.targetId} className="admin-case">
          <div className="who-card">
            <RoachIcon color={c.color} size={44} avatar={c.avatar} />
            <div>
              <strong>{c.name || "（没有名字）"}</strong>
              {c.anonymous && <span className="tag">现在是匿名</span>}
              <p className="hint">
                {ago(c.joinedAt)}注册 · 最近 24 小时碰了 {c.last24h.touches} 次、发了 {c.last24h.declarations} 条宣言
              </p>
            </div>
          </div>

          <h2>被 {c.reporters} 个人举报</h2>
          <ul>
            {c.reports.map((r, i) => (
              <li key={i}>
                <strong>{REPORT_REASONS[r.reason]}</strong>
                {r.note && <>：{r.note}</>}
                <br />
                <span className="hint">
                  {ago(r.at)} · {r.context} · 当时的名字：{r.name}
                </span>
              </li>
            ))}
          </ul>

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

          <div className="account-actions">
            <button className="pill" disabled={busy === c.targetId} onClick={() => resolve(c, "dismiss")}>
              没问题
            </button>
            <button
              className="pill"
              disabled={busy === c.targetId || (c.anonymous && !c.name)}
              onClick={() => resolve(c, "clearName")}
            >
              清掉名字
            </button>
            <button className="pill danger-pill" disabled={busy === c.targetId} onClick={() => resolve(c, "ban")}>
              封号
            </button>
          </div>
        </section>
      ))}
      <NameList />
      <Players />
      <BadgeDesk />
      <p className="hint" style={{ marginTop: 24 }}>
        <Link href="/">回到地图</Link>
      </p>
    </main>
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
function NameList() {
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
  // a moment after typing stops, not on every key
  useEffect(() => {
    const t = window.setTimeout(() => load(search), 300);
    return () => window.clearTimeout(t);
  }, [search, load]);

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
    run(async () => (await call("clearName", h.id), "名字清掉了，TA 现在是匿名。"));
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
