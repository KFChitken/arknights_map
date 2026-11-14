"use client";

import { useEffect, useState } from "react";
import { monthOf, monthWords, SPONSOR_NOTE_MAX, yuan, yuanTyped, type LedgerRow, type SponsorAdmin, type SponsorMode } from "@/lib/sponsor";
import { errorWords } from "./api";
import { useConsole } from "./context";
import { PanelHead } from "./ui";

/** The month form: what is typed, in yuan */
type MonthForm = { month: string; spent: string; received: string; note: string };
const blankMonth = (): MonthForm => ({ month: monthOf(), spent: "", received: "", note: "" });

/** What starting the site cost, as typed (yuan; "" for none) */
type StartupForm = { spent: string; note: string };
const startupForm = (d: SponsorAdmin): StartupForm => ({ spent: d.startup.spent ? yuanTyped(d.startup.spent) : "", note: d.startup.note });

/** A step asked about first, in the panel's yellow bar */
type Asking = { kind: "open" } | { kind: "remove"; month: string };

/** Whom SPONSOR (src/lib/server/env.ts, set where the site runs) shows it to, said under the switch while not everyone */
const MODE_NOTE: Record<Exclude<SponsorMode, "on">, string> = {
  admins:
    "现在是先给管理员试的时候（SPONSOR=admins）：入口、/support 和谢礼称号都只有站长和管理员看得到，别人打开 /support 会显示找不到页面；谢礼称号也先只能发给站长和管理员。试好了要给所有玩家看，请上线线程把 SPONSOR 改成 on。",
  off: "现在 SPONSOR 是 off：入口、/support 和谢礼称号谁都看不到。这里可以先填好，等上线线程把 SPONSOR 设成 admins（只给站长和管理员）或 on（所有玩家）。",
};

/** The switch's line, by whether it is on with a link (shows) and whom SPONSOR shows it to */
const statusWords = ({ shows, mode }: SponsorAdmin) =>
  !shows
    ? "入口关着，玩家看不到"
    : mode === "on"
      ? "入口开着，玩家看得到"
      : mode === "admins"
        ? "入口开着，现在只有站长和管理员看得到"
        : "入口开着，但 SPONSOR 是 off，谁都看不到";

/** Asked before switching it on */
const OPEN_ASK: Record<SponsorMode, string> = {
  on: "打开以后，所有玩家在「我的资料」最下面都能看到「支持舟P地图」，/support 也能打开。确定打开吗？",
  admins: "打开以后，站长和管理员在「我的资料」最下面能看到「支持舟P地图」，/support 也能打开；别的玩家要等 SPONSOR 改成 on 才看得到。确定打开吗？",
  off: "现在 SPONSOR 是 off，打开以后也要等它设成 admins 或 on 才会出现。确定打开吗？",
};

/** Said once switched on, or off */
const TURNED: Record<SponsorMode, [on: string, off: string]> = {
  on: ["入口打开了，玩家半分钟内都能看到。", "入口关掉了，玩家半分钟内都看不到了。"],
  admins: ["入口打开了，站长和管理员半分钟内都能看到。", "入口关掉了，半分钟内谁都看不到了。"],
  off: ["入口打开了，等 SPONSOR 设成 admins 或 on 才会出现。", "入口关掉了。"],
};

/**
 * 支持舟P地图 (src/lib/server/sponsorAdmin.ts), the owner's: the switch and the links, what starting the site
 * cost, and each month's accounts as the card and /support show them. Players see the entry only while it is
 * switched on and has an 爱发电 link, and only those SPONSOR shows it to (MODE_NOTE); the other processes catch
 * up within half a minute.
 */
export default function SponsorPanel() {
  const { call, say } = useConsole();
  const [data, setData] = useState<SponsorAdmin | null>(null);
  const [links, setLinks] = useState({ afdian: "", kofi: "" });
  const [startup, setStartup] = useState<StartupForm>({ spent: "", note: "" });
  const [form, setForm] = useState<MonthForm>(blankMonth);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // the links and the startup cost as stored, after loading and saving them (the server tidies them); saving
  // one leaves what is typed in the other alone
  const show = (d: SponsorAdmin, op: string | null) => {
    setData(d);
    if (op === null || op === "saveSponsor") setLinks({ afdian: d.afdian, kofi: d.kofi });
    if (op === null || op === "saveSponsorStartup") setStartup(startupForm(d));
  };
  useEffect(() => {
    call<SponsorAdmin>("sponsor")
      .then((d) => show(d, null))
      .catch((e) => setNote(`读不出来：${errorWords(e)}`));
  }, [call]);

  const run = async (op: string, arg: unknown, done: string) => {
    setBusy(true);
    try {
      show(await call<SponsorAdmin>(op, [arg]), op);
      setNote(null);
      setAsking(null);
      say(done);
      setBusy(false);
      return true;
    } catch (e) {
      setNote(errorWords(e));
      setBusy(false);
      return false;
    }
  };

  if (!data) {
    return (
      <section className="ac-panel ac-tool wide" aria-label="支持舟P地图">
        <PanelHead title="支持舟P地图" aside="只有站长" />
        <p className="ac-sub">{note ?? "正在读取…"}</p>
      </section>
    );
  }

  const turn = (on: boolean) => run("saveSponsor", { enabled: on, ...links }, TURNED[data.mode][on ? 0 : 1]);
  const saveMonth = async () => {
    const was = data.months.some((m) => m.month === form.month);
    if (await run("saveSponsorMonth", form, `${monthWords(form.month)}的账${was ? "改好了" : "记上了"}。`)) setForm(blankMonth());
  };
  const edit = (m: LedgerRow) => setForm({ month: m.month, spent: yuanTyped(m.spent), received: yuanTyped(m.received), note: m.note });
  const linksChanged = links.afdian !== data.afdian || links.kofi !== data.kofi;
  const stored = startupForm(data);
  const startupChanged = startup.spent.trim() !== stored.spent || startup.note.trim() !== stored.note;

  return (
    <section className="ac-panel ac-tool wide" aria-label="支持舟P地图">
      <PanelHead title="支持舟P地图" aside="只有站长" />
      <p className="ac-sub">
        玩家在「我的资料」最下面点「支持舟P地图」，看到说明卡和去爱发电的按钮；公开账目在 /support。打开开关、而且填了爱发电链接，才会出现。英文版一直不显示。
      </p>
      <div className="ac-status-line">
        <span className={`ac-dot${data.shows && data.mode !== "off" ? "" : " gray"}`} aria-hidden="true" />
        <strong>{statusWords(data)}</strong>
      </div>
      {data.mode !== "on" && <p className="ac-sub">{MODE_NOTE[data.mode]}</p>}

      <div className="ac-two">
        <label className="ac-field">
          爱发电链接
          <input
            type="url"
            value={links.afdian}
            onChange={(e) => setLinks((l) => ({ ...l, afdian: e.target.value }))}
            placeholder="https://ifdian.net/a/…"
          />
        </label>
        <label className="ac-field">
          Ko-fi 链接（可以不填，填了说明卡上多一个按钮）
          <input type="url" value={links.kofi} onChange={(e) => setLinks((l) => ({ ...l, kofi: e.target.value }))} placeholder="https://ko-fi.com/…" />
        </label>
      </div>
      {asking?.kind === "open" ? (
        <div className="ac-confirm" role="alert">
          <span>{OPEN_ASK[data.mode]}</span>
          <button type="button" className="ac-btn small primary" disabled={busy} onClick={() => turn(true)}>
            确认打开
          </button>
          <button type="button" className="ac-btn small" disabled={busy} onClick={() => setAsking(null)}>
            先不开
          </button>
        </div>
      ) : (
        <div className="ac-row">
          <button
            type="button"
            className="ac-btn"
            disabled={busy || !linksChanged}
            onClick={() => run("saveSponsor", { enabled: data.enabled, ...links }, "链接存好了。")}
          >
            保存链接
          </button>
          {data.enabled ? (
            <button type="button" className="ac-btn danger" disabled={busy} onClick={() => turn(false)}>
              关掉入口
            </button>
          ) : (
            <button type="button" className="ac-btn primary" disabled={busy || !links.afdian.trim()} onClick={() => setAsking({ kind: "open" })}>
              打开入口
            </button>
          )}
          {data.shows && data.mode !== "off" && (
            <a className="ac-btn" href="/support" target="_blank" rel="noreferrer">
              看 /support
            </a>
          )}
        </div>
      )}

      <h3 className="ac-sponsor-head">开站花费</h3>
      <p className="ac-sub">
        开这个网站时花的钱（开入口以前的服务器、域名、升级这些），是你先垫的。每个月付完账单多出来的钱，先用来补这笔，补完再留给以后的月份；补不上的就是你自己出。/support
        上单独写一段，写着已经补了多少。填 0 就不显示，多出来的钱也就直接留给以后的月份。
      </p>
      {data.startup.spent > 0 && (
        <div className="ac-status-line">
          <span className={`ac-dot${data.startup.repaid >= data.startup.spent ? "" : " gray"}`} aria-hidden="true" />
          <strong>
            {data.startup.repaid >= data.startup.spent
              ? `${yuan(data.startup.spent)} 已经补齐了`
              : `已经补了 ${yuan(data.startup.repaid)}，还差 ${yuan(data.startup.spent - data.startup.repaid)}`}
          </strong>
        </div>
      )}
      <div className="ac-two">
        <label className="ac-field">
          开站花了（元）
          <input
            type="text"
            inputMode="decimal"
            value={startup.spent}
            onChange={(e) => setStartup((f) => ({ ...f, spent: e.target.value }))}
            placeholder="比如 1460"
          />
        </label>
        <label className="ac-field">
          花在哪（可以不填，玩家能看到）
          <input
            type="text"
            maxLength={SPONSOR_NOTE_MAX}
            value={startup.note}
            onChange={(e) => setStartup((f) => ({ ...f, note: e.target.value }))}
            placeholder="比如：域名、服务器和邮件服务升级"
          />
        </label>
      </div>
      <div className="ac-row">
        <button
          type="button"
          className="ac-btn primary"
          disabled={busy || !startupChanged}
          onClick={() => run("saveSponsorStartup", { spent: startup.spent.trim() || "0", note: startup.note }, "开站花费存好了。")}
        >
          保存开站花费
        </button>
      </div>

      <h3 className="ac-sponsor-head">每个月的账</h3>
      <p className="ac-sub">
        每个月记一行：花了多少（服务器、邮件；这个月的先往多了估，月底再改成实数；开站时一次性花的记在上面），收到多少（填爱发电扣掉手续费以后到手的），按元填，可以带两位小数。同一个月再记一次就是改。
      </p>
      <div className="ac-sponsor-month">
        <label className="ac-field">
          月份
          <input type="month" value={form.month} onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))} placeholder="2026-11" />
        </label>
        <label className="ac-field">
          花了（元）
          <input type="text" inputMode="decimal" value={form.spent} onChange={(e) => setForm((f) => ({ ...f, spent: e.target.value }))} placeholder="比如 3000" />
        </label>
        <label className="ac-field">
          收到（元）
          <input
            type="text"
            inputMode="decimal"
            value={form.received}
            onChange={(e) => setForm((f) => ({ ...f, received: e.target.value }))}
            placeholder="比如 320.5"
          />
        </label>
        <label className="ac-field ac-sponsor-note">
          花在哪（可以不填，玩家能看到）
          <input
            type="text"
            maxLength={SPONSOR_NOTE_MAX}
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="比如：腾讯云两台、Resend 邮件"
          />
        </label>
      </div>
      <div className="ac-row">
        <button type="button" className="ac-btn primary" disabled={busy || !form.spent.trim() || !form.received.trim()} onClick={saveMonth}>
          {data.months.some((m) => m.month === form.month) ? "改这个月的账" : "记上这个月"}
        </button>
      </div>
      {asking?.kind === "remove" && (
        <div className="ac-confirm" role="alert">
          <span>删掉 {monthWords(asking.month)}的账？</span>
          <button
            type="button"
            className="ac-btn small danger-solid"
            disabled={busy}
            onClick={() => run("removeSponsorMonth", asking.month, `${monthWords(asking.month)}的账删掉了。`)}
          >
            删掉
          </button>
          <button type="button" className="ac-btn small" disabled={busy} onClick={() => setAsking(null)}>
            算了
          </button>
        </div>
      )}
      {data.months.length === 0 ? (
        <p className="ac-muted small">还没有记账。</p>
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table ac-sponsor-ledger">
            <thead>
              <tr>
                <th>月份</th>
                <th>花了</th>
                <th>收到</th>
                <th>结余</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month}>
                  <td>
                    {monthWords(m.month)}
                    {m.note && <small>{m.note}</small>}
                  </td>
                  <td>{yuan(m.spent)}</td>
                  <td>{yuan(m.received)}</td>
                  <td className={m.balance < 0 ? "short" : undefined}>
                    {yuan(m.balance)}
                    {m.repaid > 0 && <small>补开站 {yuan(m.repaid)}</small>}
                  </td>
                  <td>
                    <button type="button" className="ac-btn small" disabled={busy} onClick={() => edit(m)}>
                      改
                    </button>{" "}
                    <button type="button" className="ac-btn small danger" disabled={busy} onClick={() => setAsking({ kind: "remove", month: m.month })}>
                      删
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="ac-muted small">
        结余＝之前多出来的＋这个月收到的－花了的；是负数就是你自己补的，不往下个月带。多出来的先补开站花费（写着「补开站」），剩下的才带到下个月。
      </p>
      {note && <p className="ac-error">{note}</p>}
    </section>
  );
}
