"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ZoneItem, ZoneList } from "@/lib/adminConsole";
import { addDays, beijingDate, beijingShort } from "@/lib/beijing";
import { errorWords } from "./api";
import { useConsole } from "./context";
import { Icon } from "./ui";

/**
 * 禁放区 (the owner's, src/lib/server/zones.ts): the places the owner drew on the map, in force and lifted within a
 * year, and how many the code holds. One is drawn on the map (/?draw=1) and seen there (/?zone=<id>, which goes into
 * the 操作记录); 解除 asks first, in its row. A place still moving its roaches out is read again until it is done.
 */

/** 「今天 21:30」, 「昨天 09:10」, 「11/9 22:05」, Beijing time */
function whenWords(t: number, now: number) {
  const [day, clock] = beijingShort(t).split(" ");
  const date = beijingDate(t);
  const today = beijingDate(now);
  return date === today ? `今天 ${clock}` : date === addDays(today, -1) ? `昨天 ${clock}` : `${day} ${clock}`;
}

/** What came out when it was drawn: the roaches moved out and the visiting clones sent home */
function movedWords(z: ZoneItem) {
  if (!z.done) return "正在挪";
  return `${z.moved + z.sentHome} 只`;
}

const short = (label: string) => ([...label].length > 12 ? `${[...label].slice(0, 12).join("")}…` : label);

export default function Zones() {
  const { call, say } = useConsole();
  const [list, setList] = useState<ZoneList | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    () =>
      call<ZoneList>("zones")
        .then((l) => {
          setList(l);
          setNow(Date.now());
        })
        .catch((e) => setNote(errorWords(e))),
    [call],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const moving = Boolean(list?.live.some((z) => !z.done));
  useEffect(() => {
    if (!moving) return;
    const t = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(t);
  }, [moving, load]);

  const lift = async (z: ZoneItem) => {
    setBusy(true);
    try {
      await call("liftZone", [{ id: z.id }]);
      setAsking(null);
      say(`解除了「${short(z.label)}」，那里又能放蟑螂了。`);
      await load();
    } catch (e) {
      setNote(errorWords(e));
    }
    setBusy(false);
  };

  if (!list) {
    return (
      <div className="ac-zones">
        <section className="ac-panel ac-tool">{note ? <p className="ac-error">读不出来：{note}</p> : <p className="ac-sub">正在读取…</p>}</section>
      </div>
    );
  }
  return (
    <div className="ac-zones">
      <div className="ac-zone-cards">
        <section className="ac-panel ac-zone-card" aria-label="你圈的">
          <div>
            <div className="ac-sub">你圈的，正在生效</div>
            <div className="ac-zone-n">{list.live.length} 处</div>
            <div className="ac-muted small">圈好马上生效，不用等上线</div>
          </div>
          <Link className="ac-btn primary" href="/?draw=1">
            <Icon name="draw" size={16} />
            在地图上圈一块
          </Link>
        </section>
        <section className="ac-panel ac-zone-card" aria-label="写在代码里的">
          <div>
            <div className="ac-sub">写在代码里的</div>
            <div className="ac-zone-n">{list.inCode} 处</div>
            <div className="ac-muted small">这些在这里改不了，要改得写代码、上线。</div>
          </div>
        </section>
      </div>

      <section className="ac-panel ac-tool" aria-label="正在生效">
        <div className="ac-panel-head">
          <h2>正在生效</h2>
          <span className="ac-muted">只有站长能圈、能解除。每次都记在操作记录里。</span>
        </div>
        {note && <p className="ac-error">{note}</p>}
        {list.live.length ? (
          <>
            <div className="ac-zone-row ac-zone-cols" aria-hidden="true">
              <span className="zc-label">是哪儿、为什么圈（只有你看得到）</span>
              <span className="zc-r">半径</span>
              <span className="zc-by">谁圈的</span>
              <span className="zc-at">什么时候</span>
              <span className="zc-moved">当时挪走</span>
              <span className="zc-acts" />
            </div>
            <ul className="ac-zone-list">
              {list.live.map((z) => (
                <li key={z.id} className="ac-zone-row">
                  <div className="zc-label">
                    <strong>{z.label}</strong>
                    {asking === z.id && (
                      <div className="ac-confirm" role="alert">
                        <span>解除以后，这里又能放蟑螂了。之前挪走的不会挪回来。</span>
                        <button type="button" className="ac-btn small danger" disabled={busy} onClick={() => lift(z)}>
                          确认解除
                        </button>
                        <button type="button" className="ac-btn small" disabled={busy} onClick={() => setAsking(null)}>
                          先不解除
                        </button>
                      </div>
                    )}
                  </div>
                  <span className="zc-r">
                    <span className="zc-k">半径 </span>
                    {z.radiusM} 米
                  </span>
                  <span className="zc-by">
                    <span className="zc-k">谁圈的：</span>
                    {z.by}
                  </span>
                  <span className="zc-at">{whenWords(z.at, now)}</span>
                  <span className="zc-moved">
                    <span className="zc-k">当时挪走 </span>
                    {movedWords(z)}
                    {z.done && z.sentHome > 0 && <small>含送回家 {z.sentHome} 只</small>}
                  </span>
                  <span className="zc-acts">
                    <Link className="ac-btn small" href={`/?zone=${encodeURIComponent(z.id)}`}>
                      去地图上看
                    </Link>
                    <button type="button" className="ac-btn small" disabled={busy || asking === z.id} onClick={() => setAsking(z.id)}>
                      解除
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="ac-sub">现在没有你圈的禁放区。代码里的 {list.inCode} 处照常生效。</p>
        )}
      </section>

      {list.lifted.length > 0 && (
        <section className="ac-panel ac-tool" aria-label="已经解除的">
          <h2 className="ac-zone-h2">已经解除的</h2>
          <p className="ac-sub">解除的不删，留在这里一年，看得到当时为什么圈。</p>
          <ul className="ac-zone-list lifted">
            {list.lifted.map((z) => (
              <li key={z.id}>
                <strong>{z.label}</strong>
                <span>{z.radiusM} 米</span>
                <span>{beijingShort(z.at)} 圈</span>
                <span>{beijingShort(z.liftedAt!)} 解除</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="ac-muted small">
        圈的时候：圈里已经有的蟑螂当场挪到圈外 60 到 300 米，在圈里做客的克隆体送回家，主人收到一条站长通知，不记黄牌。管理员看不到这一页。
      </p>
    </div>
  );
}
