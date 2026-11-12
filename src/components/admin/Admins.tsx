"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ALIAS_MAX,
  clockWords,
  CODE_TRIES,
  FRESH_MINUTES,
  PAUSE_MAX_HOURS,
  PAUSE_MINUTES,
  UNLOCK_HOURS,
  type AdminCandidate,
  type AdminMember,
} from "@/lib/adminConsole";
import { beijingShort } from "@/lib/beijing";
import { YELLOW_DAYS } from "@/lib/rules";
import { AdminError, errorWords } from "./api";
import { useConsole } from "./context";
import { CodeInput, PanelHead } from "./ui";

/**
 * 管理员, the owner's alone: who may come into the 管理台 and how each stands; resetting a moderator's authenticator
 * or removing them (with a code from the last FRESH_MINUTES), renaming one, lifting a pause early; adding one (an
 * account that signed up with its own email); and what a moderator may do, and how the door keeps everyone else out.
 */
export default function Admins() {
  const { call, setLine } = useConsole();
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await call<AdminMember[]>("admins");
      setMembers(list);
      setLine(`现在 ${list.length} 个人能进管理台。`);
      setNote(null);
    } catch (e) {
      setNote(errorWords(e));
    }
  }, [call, setLine]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="ac-admins">
      {note && <p className="ac-notice">{note}</p>}
      <section className="ac-panel ac-team" aria-label="现在的管理员">
        <div className="ac-list-head">
          <h2>现在能进管理台的人</h2>
          <span>玩家只会看到「站长」，看不到这些名字</span>
        </div>
        {members?.map((m) => <Member key={m.userId} m={m} onChange={load} />)}
        {!members && !note && <p className="ac-list-empty">正在读取…</p>}
      </section>
      <div className="ac-admins-two">
        <AddAdmin onAdded={load} />
        <CanDo />
      </div>
      <Safety />
    </div>
  );
}

/** 验证器: bound, waiting for them to bind it the first time, or reset and waiting for them again */
function totpWords(m: AdminMember, now: number) {
  if (m.bound) return { text: m.lastUnlock ? `已绑定 · 最近 ${clockWords(m.lastUnlock, now)} 进来` : "已绑定", waiting: false };
  return { text: m.lastUnlock ? "重置了，等 TA 重新绑定" : "等 TA 绑定", waiting: true };
}

/** What to look into: a pause (why, until when), or wrong codes in a row */
function alertWords(m: AdminMember, now: number) {
  if (m.pausedUntil) {
    return m.pauseReason === "views"
      ? `一小时里看了太多账号，管理台暂停到 ${clockWords(m.pausedUntil, now)}，已经发邮件给你。`
      : `连续输错太多次验证码，暂停到 ${clockWords(m.pausedUntil, now)}，已经发邮件给你。不是 TA 本人在输的话，重置 TA 的验证器，或者移除 TA。`;
  }
  return m.fails > 0 ? `连续输错 ${m.fails} 次验证码。` : "";
}

type Confirming = null | "reset" | "remove";

function Member({ m, onChange }: { m: AdminMember; onChange: () => Promise<void> }) {
  const { call, say, needsFresh } = useConsole();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const owner = m.role === "owner";
  const totp = totpWords(m, now);
  const alert = alertWords(m, now);

  const unpause = async () => {
    setBusy(true);
    try {
      await call("unpauseAdmin", [{ userId: m.userId }]);
      say(`${m.alias}的暂停解除了。`);
      await onChange();
    } catch (e) {
      say(errorWords(e));
    }
    setBusy(false);
  };

  return (
    <div className="ac-member">
      <div className="ac-member-row">
        <div className="ac-member-who">
          <div className="ac-member-name">
            <strong>{owner ? `${m.alias}（你）` : m.alias}</strong>
            <span className={`ac-role ${m.role}`}>{owner ? "站长" : "管理员"}</span>
            {!owner && !renaming && (
              <button type="button" className="ac-link small" onClick={() => setRenaming(true)}>
                改称呼
              </button>
            )}
          </div>
          <span className="ac-sub">{m.email}</span>
        </div>
        <div className="ac-member-fact">
          <span>验证器</span>
          <span className={totp.waiting ? "waiting" : "ok"}>{totp.text}</span>
        </div>
        <div className="ac-member-fact">
          <span>最近 7 天处理</span>
          <span>{m.bound || m.week ? `${m.week} 件` : "还没开始"}</span>
        </div>
        <div className="ac-member-fact">
          <span>备用码</span>
          <span>{m.bound ? `还剩 ${m.backupLeft} 个` : m.lastUnlock ? "重新绑定时给" : "绑定时给"}</span>
        </div>
        <div className="ac-member-acts">
          {owner ? (
            <span className="ac-muted small">写在服务器设置里，这里改不了</span>
          ) : (
            <>
              <button type="button" className="ac-btn small" onClick={() => setConfirming(confirming === "reset" ? null : "reset")} aria-expanded={confirming === "reset"}>
                重置验证器
              </button>
              <button type="button" className="ac-btn small danger" onClick={() => setConfirming(confirming === "remove" ? null : "remove")} aria-expanded={confirming === "remove"}>
                移除
              </button>
            </>
          )}
        </div>
      </div>
      {alert && (
        <p className="ac-member-alert">
          {alert}
          {m.pausedUntil && !owner && (
            <button type="button" className="ac-btn small" onClick={unpause} disabled={busy}>
              提前解除暂停
            </button>
          )}
        </p>
      )}
      {renaming && <Rename m={m} onClose={() => setRenaming(false)} onDone={onChange} />}
      {confirming && <ConfirmBox m={m} kind={confirming} needed={needsFresh()} onClose={() => setConfirming(null)} onDone={onChange} />}
    </div>
  );
}

/** 重置验证器 or 移除, confirmed beside the row, with a code unless one was typed in the last FRESH_MINUTES */
function ConfirmBox({ m, kind, needed, onClose, onDone }: { m: AdminMember; kind: "reset" | "remove"; needed: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const { call, say } = useConsole();
  const [need, setNeed] = useState(needed);
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = kind === "remove";
  const go = async () => {
    if (need && code.length < 6) return;
    setBusy(true);
    try {
      await call(remove ? "removeAdmin" : "resetAdminTotp", [{ userId: m.userId }], { fresh: code || undefined });
      say(remove ? `移除了${m.alias}，TA 已经进不了管理台。` : `${m.alias}的验证器重置了，TA 要重新绑定。`);
      onClose();
      await onDone();
    } catch (e) {
      if (e instanceof AdminError && e.code === "ADMIN_FRESH") setNeed(true);
      setNote(errorWords(e));
      setCode("");
      setBusy(false);
    }
  };
  return (
    <div className="ac-ban" role="group" aria-label={remove ? "移除" : "重置验证器"}>
      <strong>{remove ? `移除${m.alias}？` : `重置${m.alias}的验证器？`}</strong>
      <p>
        {remove
          ? "TA 马上就进不了管理台，正开着的下一次点击就退出。TA 处理过的记录还留着，TA 的舟P 账号不受影响。"
          : "TA 旧的验证器和备用码马上作废，要用邮箱登录后重新绑定。手机丢了、换手机时用这个。"}
      </p>
      {need && (
        <label className="ac-field">
          再输一次你的验证器里的 6 位数字
          <CodeInput value={code} onChange={setCode} invalid={Boolean(note)} autoFocus onEnter={go} />
        </label>
      )}
      {note && (
        <p role="alert" className="ac-error">
          {note}
        </p>
      )}
      <div className="ac-row">
        <button type="button" className="ac-btn danger-solid" onClick={go} disabled={busy || (need && code.length < 6)}>
          {remove ? "确认移除" : "确认重置"}
        </button>
        <button type="button" className="ac-btn" onClick={onClose} disabled={busy}>
          算了
        </button>
      </div>
    </div>
  );
}

/** 改称呼: what the 管理台 calls them from now on (what they did keeps the name they had then) */
function Rename({ m, onClose, onDone }: { m: AdminMember; onClose: () => void; onDone: () => Promise<void> }) {
  const { call, say } = useConsole();
  const [alias, setAlias] = useState(m.alias);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await call<{ alias: string }>("renameAdmin", [{ userId: m.userId, alias }]);
      say(`改好了，以后叫 TA「${r.alias}」。`);
      onClose();
      await onDone();
    } catch (e) {
      setNote(errorWords(e));
      setBusy(false);
    }
  };
  return (
    <form
      className="ac-member-rename"
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
    >
      <label className="ac-field">
        在管理台里叫 TA 什么（只有管理员看得到，以前的记录还是旧称呼）
        <input value={alias} maxLength={ALIAS_MAX * 2} autoFocus onChange={(e) => (setAlias(e.target.value), setNote(null))} />
      </label>
      {note && (
        <p role="alert" className="ac-error">
          {note}
        </p>
      )}
      <div className="ac-row">
        <button type="submit" className="ac-btn primary" disabled={busy || !alias.trim()}>
          改好了
        </button>
        <button type="button" className="ac-btn" onClick={onClose} disabled={busy}>
          算了
        </button>
      </div>
    </form>
  );
}

/** 加一个管理员: find the account by its full email (or id), say it is them, and add them with a code */
function AddAdmin({ onAdded }: { onAdded: () => Promise<void> }) {
  const { call, say, needsFresh } = useConsole();
  const [q, setQ] = useState("");
  const [alias, setAlias] = useState("");
  const [found, setFound] = useState<AdminCandidate | null>(null);
  const [added, setAdded] = useState(false);
  const [need, setNeed] = useState(false);
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const find = async () => {
    setBusy(true);
    try {
      setFound(await call<AdminCandidate>("findAdminCandidate", [{ q }]));
      setNeed(needsFresh());
      setNote(null);
    } catch (e) {
      setNote(errorWords(e));
    }
    setBusy(false);
  };
  const add = async () => {
    if (!found || (need && code.length < 6)) return;
    setBusy(true);
    try {
      const r = await call<{ alias: string }>("addAdmin", [{ userId: found.id, alias }], { fresh: code || undefined });
      say(`加好了：${r.alias}，等 TA 绑定验证器。`);
      setAdded(true);
      setNote(null);
      await onAdded();
    } catch (e) {
      if (e instanceof AdminError && e.code === "ADMIN_FRESH") setNeed(true);
      setNote(errorWords(e));
      setCode("");
    }
    setBusy(false);
  };
  const again = (clear: boolean) => {
    setFound(null);
    setAdded(false);
    setCode("");
    setNote(null);
    if (clear) {
      setQ("");
      setAlias("");
    }
  };

  return (
    <section className="ac-panel ac-tool" aria-label="加管理员">
      <PanelHead title="加一个管理员" />
      <p className="ac-sub">TA 要先用自己的邮箱注册舟P。加好后，TA 打开管理台会先绑定验证器，绑好之前什么都看不到。</p>
      {added ? (
        <div className="ac-stack tight">
          <p className="ac-ok">加好了。TA 会收到一封邮件：用这个邮箱登录后打开管理台，按提示绑定验证器。你也会在 TA 绑好时收到邮件。</p>
          <div>
            <button type="button" className="ac-btn" onClick={() => again(true)}>
              再加一个
            </button>
          </div>
        </div>
      ) : found ? (
        <form
          className="ac-stack tight"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className="ac-found">
            <span className="ac-muted small">找到了这个账号，确认是 TA 吗？</span>
            <strong>{found.name}</strong>
            <span className="ac-sub">
              {found.email} · {beijingShort(found.joinedAt).split(" ")[0]} 注册 · {found.reports ? `有 ${found.reports} 条举报还没处理` : "现在没人举报"} ·{" "}
              {found.yellow ? `${YELLOW_DAYS} 天内 ${found.yellow} 张黄牌` : `${YELLOW_DAYS} 天内没有黄牌`}
            </span>
            <span className="ac-sub">在管理台里叫 TA「{alias.trim()}」</span>
          </div>
          {need && (
            <label className="ac-field">
              再输一次你的验证器里的 6 位数字
              <CodeInput value={code} onChange={setCode} invalid={Boolean(note)} autoFocus />
            </label>
          )}
          {note && (
            <p role="alert" className="ac-error">
              {note}
            </p>
          )}
          <div className="ac-row">
            <button type="submit" className="ac-btn primary" disabled={busy || (need && code.length < 6)}>
              加为管理员
            </button>
            <button type="button" className="ac-btn" onClick={() => again(false)} disabled={busy}>
              不是，重新找
            </button>
          </div>
        </form>
      ) : (
        <form
          className="ac-stack tight"
          onSubmit={(e) => {
            e.preventDefault();
            void find();
          }}
        >
          <label className="ac-field">
            TA 登录舟P 用的邮箱
            <input type="text" inputMode="email" autoComplete="off" value={q} onChange={(e) => (setQ(e.target.value), setNote(null))} placeholder="name@example.com" />
            <span className="ac-hint">要完整的邮箱，或者 TA 的账号 ID。</span>
          </label>
          <label className="ac-field">
            在管理台里叫 TA 什么（只有管理员看得到）
            <input value={alias} maxLength={ALIAS_MAX * 2} onChange={(e) => (setAlias(e.target.value), setNote(null))} placeholder="比如：夜航" />
            <span className="ac-hint">最多 {ALIAS_MAX} 个字，不能和别人重名。</span>
          </label>
          {note && (
            <p role="alert" className="ac-error">
              {note}
            </p>
          )}
          <div>
            <button type="submit" className="ac-btn primary" disabled={busy || !q.trim() || !alias.trim()}>
              找这个账号
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

const CAN = [
  "看待处理和申诉，处理举报：没问题、清名字或 UID、警告、暂停、请确认年龄、移走蟑螂",
  "搜索账号（名字、账号 ID、游戏 UID），看资料和记录，直接处理",
  "名字快审、一起处理好几件",
  "维护名字黑名单",
  "写只有管理员看得到的备注",
];
const CANNOT = [
  "封号：只能提请，你确认了才封",
  "看完整邮箱、按邮箱找人、查邮箱封没封过",
  "回复自己处理的那件的申诉",
  "看举报管理员本人的案子（只给你）",
  "网站状态、统计、发称号，地图上的站长清理和站长地图",
  "加、删管理员，看别人的操作记录",
];

function CanDo() {
  return (
    <section className="ac-panel ac-tool" aria-label="管理员能做什么">
      <PanelHead title="管理员能做什么" />
      <div className="ac-can">
        <div>
          <h3 className="ac-can-yes">能做</h3>
          <ul>
            {CAN.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="ac-can-no">不能做</h3>
          <ul>
            {CANNOT.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const SAFETY: [string, string][] = [
  ["两道门", `先用邮箱登录舟P，再输验证器里的 6 位数字。邮箱被盗也进不来。每台设备 ${UNLOCK_HOURS} 小时输一次。`],
  ["要紧的事再输一次", `封号、加删管理员、重置验证器，${FRESH_MINUTES} 分钟内没输过就要再输一次。`],
  ["猜不出来", `连续输错 ${CODE_TRIES} 次暂停 ${PAUSE_MINUTES} 分钟，再错就翻倍，最长 ${PAUSE_MAX_HOURS} 小时，并发邮件给你。`],
  ["有动静就告诉你", "有人被加进来、绑好验证器、用了备用码、被暂停，或一小时看了太多账号，都发邮件给你。"],
  ["移除马上生效", "移除以后，TA 正开着的管理台下一次点击就退出。TA 处理过的记录还留着。"],
  ["别人看不出有这一页", "不是管理员的人打开管理台，看到的和不存在的网址一样：「找不到页面」。"],
];

function Safety() {
  return (
    <section className="ac-panel ac-tool" aria-label="安全设置">
      <PanelHead title="怎么保证只有管理员进得来" />
      <div className="ac-safety">
        {SAFETY.map(([title, text]) => (
          <div key={title}>
            <strong>{title}</strong>
            <p>{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
