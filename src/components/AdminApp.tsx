"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { REPORT_REASONS, type AdminAction, type AdminCase } from "@/lib/safety";
import { ago } from "./app/InboxSheet";
import RoachIcon from "./RoachIcon";

/** /admin: open reports grouped by player, with the three ways to settle them. The API refuses everyone but the admins. */

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
        <h1>举报处理</h1>
        <p>这个页面只有管理员能打开。请先在地图上用管理员的邮箱登录。</p>
        <p>
          <Link href="/">回到地图</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="doc admin">
      <h1>举报处理</h1>
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
      <p className="hint" style={{ marginTop: 24 }}>
        <Link href="/">回到地图</Link>
      </p>
    </main>
  );
}
