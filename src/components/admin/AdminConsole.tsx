"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FRESH_MINUTES, MOD_PAGES, type AdminRole, type BanRequestCard, type GateState } from "@/lib/adminConsole";
import type { AdminAppeal, CasePage } from "@/lib/safety";
import Accounts from "./Accounts";
import Admins from "./Admins";
import { adminCall, AdminError, errorWords, type CallOptions } from "./api";
import Cases from "./Cases";
import { ConsoleContext, PAGES, useConsole, type Console, type OpenGate, type Page, type Route } from "./context";
import Door, { BackupCodes, Gone } from "./Gate";
import { useHeld } from "./held";
import Log from "./Log";
import Site from "./Site";
import { BrandMark, CodeInput, Icon } from "./ui";
import "./console.css";

/**
 * /admin, the 管理台 (src/app/admin/page.tsx): its door until it lets one in, then 待处理, 搜索账号, 网站和工具,
 * 管理员 and 操作记录 under one menu. A moderator has less of it: 网站和工具 is only the name blocklist, 操作记录 only
 * their own, and no 管理员 (MOD_PAGES). Every look and step goes through src/app/api/admin/[op] and into the 操作记录.
 */

type Title = { title: string; sub: string };

const TITLES: Record<Page, Title & { mod?: Title }> = {
  cases: { title: "待处理", sub: "红色先看：可能未成年、留了联系方式、一直贴着放、放在不合适的地方。" },
  accounts: { title: "搜索账号", sub: "找到一个人，看 TA 的资料和以前的记录，没人举报也能直接处理。" },
  log: {
    title: "操作记录",
    sub: "谁、什么时候、看了谁、做了什么。留 1 年。管理员只能看到自己的。",
    mod: { title: "我的操作记录", sub: "你在管理台的每次查看、搜索和处理都会记下来，站长能看到。" },
  },
  site: {
    title: "网站和工具",
    sub: "网站状态、这周的人、名字黑名单、查邮箱和称号。",
    mod: { title: "名字黑名单", sub: "名字里有这些词就存不上。加词、删词都会记进操作记录。" },
  },
  admins: { title: "管理员", sub: "只有站长能看到这一页。" },
};

const NAV: { page: Page; label: string; modLabel?: string; icon: "cases" | "accounts" | "site" | "log" | "admins" }[] = [
  { page: "cases", label: "待处理", icon: "cases" },
  { page: "accounts", label: "搜索账号", icon: "accounts" },
  { page: "site", label: "网站和工具", modLabel: "名字黑名单", icon: "site" },
  { page: "admins", label: "管理员", icon: "admins" },
  { page: "log", label: "操作记录", modLabel: "我的操作记录", icon: "log" },
];

/** The pages someone sees: a moderator not the owner's (MOD_PAGES) */
const seesPage = (role: AdminRole, page: Page) => role === "owner" || MOD_PAGES.has(page);

export type Start = { page?: string; caseId?: string; account?: string };

const routeOf = (s: Start, role: AdminRole): Route => {
  const known = (PAGES as readonly string[]).includes(s.page ?? "") ? (s.page as Page) : "cases";
  const page = seesPage(role, known) ? known : "cases";
  if (s.caseId) return { page: "cases", caseId: s.caseId };
  if (page === "accounts" && s.account) return { page, account: s.account };
  return { page };
};

const urlOf = (r: Route) => {
  const q = new URLSearchParams();
  if (r.page !== "cases") q.set("page", r.page);
  if (r.caseId) q.set("case", r.caseId);
  if (r.account) q.set("account", r.account);
  const s = q.toString();
  return s ? `/admin?${s}` : "/admin";
};

const searchRoute = (role: AdminRole) => {
  const q = new URLSearchParams(window.location.search);
  return routeOf({ page: q.get("page") ?? undefined, caseId: q.get("case") ?? undefined, account: q.get("account") ?? undefined }, role);
};

export default function AdminConsole({ initial, start }: { initial: GateState; start: Start }) {
  const [gate, setGate] = useState<GateState>(initial);
  const [gone, setGone] = useState(false);

  const refreshGate = useCallback(async () => {
    try {
      setGate(await adminCall<GateState>("gate"));
    } catch (e) {
      if (e instanceof AdminError && e.status === 404) setGone(true);
    }
  }, []);

  if (gone) return <Gone />;
  if (gate.state !== "open") return <Door gate={gate} onGate={setGate} />;
  return <Inside gate={gate} start={start} onGate={setGate} refreshGate={refreshGate} />;
}

function Inside({
  gate,
  start,
  onGate,
  refreshGate,
}: {
  gate: OpenGate;
  start: Start;
  onGate: (g: GateState) => void;
  refreshGate: () => Promise<void>;
}) {
  const role = gate.role;
  const owner = role === "owner";
  const [route, setRoute] = useState<Route>(() => routeOf(start, role));
  const [count, setCount] = useState<number | null>(null);
  const [said, setSaid] = useState<{ key: number; text: string } | null>(null);
  // the page's own line in the header, kept only for the page that set it
  const [line, setLineFor] = useState<{ page: Page; text: string } | null>(null);
  const fresh = useRef<number | null>(gate.freshUntil);
  const { held, hold, undo } = useHeld();
  const [now, setNow] = useState(() => Date.now());

  // the device locks again UNLOCK_HOURS after the code: the door shows itself then
  useEffect(() => {
    const t = window.setTimeout(() => void refreshGate(), Math.max(1000, gate.until - Date.now() + 1000));
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(tick);
    };
  }, [gate.until, refreshGate]);

  useEffect(() => {
    const back = () => setRoute(searchRoute(role));
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [role]);

  const go = useCallback((r: Route) => {
    window.history.pushState(null, "", urlOf(r));
    setRoute(r);
    window.scrollTo(0, 0);
  }, []);

  const say = useCallback((text: string) => {
    const key = Date.now();
    setSaid({ key, text });
    window.setTimeout(() => setSaid((s) => (s?.key === key ? null : s)), 5000);
  }, []);

  const call = useCallback(
    async <T,>(op: string, args: unknown[] = [], opts: CallOptions = {}): Promise<T> => {
      try {
        const result = await adminCall<T>(op, args, opts);
        if (opts.fresh) fresh.current = Date.now() + FRESH_MINUTES * 60_000;
        return result;
      } catch (e) {
        if (e instanceof AdminError) {
          if (e.code === "ADMIN_FRESH") fresh.current = null;
          // the door shut meanwhile (the hours passed, locked from another device, paused): show it again
          if (e.gate || e.status === 404) void refreshGate();
        }
        throw e;
      }
    },
    [refreshGate],
  );

  const needsFresh = useCallback(() => !fresh.current || fresh.current - Date.now() < 15_000, []);

  // 待处理's count for the menu: read when the 管理台 opens elsewhere and after steps taken elsewhere; 待处理 keeps it up itself
  const pageNow = useRef(route.page);
  pageNow.current = route.page;
  const recount = useCallback(() => {
    Promise.all([
      call<CasePage>("cases", [{ auto: true }]),
      call<AdminAppeal[]>("appeals"),
      owner ? call<BanRequestCard[]>("banRequests") : Promise.resolve([]),
    ])
      .then(([page, appeals, requests]) => {
        if (pageNow.current !== "cases") setCount(page.levels.red + page.levels.yellow + page.levels.green + appeals.length + requests.length);
      })
      .catch(() => {});
  }, [call, owner]);
  const setLine = useCallback((text: string | null) => setLineFor(text === null ? null : { page: pageNow.current, text }), []);
  useEffect(() => {
    if (route.page !== "cases") recount();
    // once, on opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ctx = useMemo<Console>(
    () => ({ gate, call, say, hold, go, needsFresh, setCounts: setCount, recount, setLine }),
    [gate, call, say, hold, go, needsFresh, recount, setLine],
  );

  const left = Math.max(0, gate.until - now);
  const leftWords = left >= 3_600_000 ? `${Math.floor(left / 3_600_000)} 小时` : `${Math.max(1, Math.ceil(left / 60_000))} 分钟`;
  const t = (!owner && TITLES[route.page].mod) || TITLES[route.page];
  const own = line?.page === route.page ? line.text : "";
  // 管理员's count goes before its words, 待处理's today after
  const sub = route.page === "admins" ? `${own}${t.sub}` : `${t.sub}${own}`;

  return (
    <ConsoleContext.Provider value={ctx}>
      <div className="ac ac-shell">
        <nav className="ac-side" aria-label="管理台菜单">
          <div className="ac-brand">
            <BrandMark />
            <div>
              <strong>舟P 管理台</strong>
              <span>只给管理员用</span>
            </div>
          </div>
          {NAV.filter((n) => seesPage(role, n.page)).map((n) => (
            <a
              key={n.page}
              href={urlOf({ page: n.page })}
              className={`ac-nav${route.page === n.page ? " on" : ""}`}
              aria-current={route.page === n.page ? "page" : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                go({ page: n.page });
              }}
            >
              <Icon name={n.icon} />
              <span className="ac-nav-label">{(!owner && n.modLabel) || n.label}</span>
              {n.page === "cases" && count !== null && count > 0 && <span className="ac-nav-count">{count}</span>}
            </a>
          ))}
          <Link className="ac-nav" href="/">
            <Icon name="map" />
            <span className="ac-nav-label">回到地图</span>
          </Link>
          <p className="ac-side-foot">在管理台的每次查看和处理都会记下来，站长能看到。</p>
        </nav>

        <main className="ac-main">
          <header className="ac-head">
            <div className="ac-head-text">
              <h1>{t.title}</h1>
              <p>{sub}</p>
            </div>
            <div className="ac-head-me">
              <span className="ac-verified">
                <Icon name="shield" size={16} />
                已验证 · 这台设备还剩 {leftWords}
              </span>
              <MeMenu gate={gate} onGate={onGate} refreshGate={refreshGate} />
            </div>
          </header>

          {route.page === "cases" && <Cases key="cases" start={route.caseId} />}
          {route.page === "accounts" && <Accounts key={`accounts-${route.account ?? ""}`} start={route.account} />}
          {route.page === "log" && <Log />}
          {route.page === "site" && <Site />}
          {route.page === "admins" && owner && <Admins />}
        </main>

        <div className="ac-bars" aria-live="polite">
          {held ? (
            <div className="ac-bar" role="status">
              <span>{held.text}</span>
              <button type="button" onClick={undo}>
                撤销 {held.left}
              </button>
            </div>
          ) : (
            said && (
              <div className="ac-bar" role="status">
                <span>{said.text}</span>
              </div>
            )
          )}
        </div>
      </div>
    </ConsoleContext.Provider>
  );
}

type MenuStep = null | "menu" | "lockAll" | "newCodes" | "reset";

/**
 * Who is in, and their own steps: 锁上 this device; from the menu under their name, 锁上所有设备, 重新生成备用码 and
 * the owner's 重新绑验证器 (the last two want a code from the last FRESH_MINUTES). A moderator's authenticator is reset
 * by the owner, on the 管理员 page.
 */
function MeMenu({ gate, onGate, refreshGate }: { gate: OpenGate; onGate: (g: GateState) => void; refreshGate: () => Promise<void> }) {
  const [step, setStep] = useState<MenuStep>(null);
  const [busy, setBusy] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (step !== "menu") return;
    const away = (e: MouseEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) setStep(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setStep(null);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [step]);

  const lock = async () => {
    setBusy(true);
    try {
      await adminCall("lock");
    } catch {
      // locked or not, ask the door where this device stands
    }
    await refreshGate();
    setBusy(false);
  };

  return (
    <>
      <div className="ac-me" ref={menu}>
        <button type="button" className="ac-me-name" aria-haspopup="menu" aria-expanded={step === "menu"} onClick={() => setStep(step === "menu" ? null : "menu")}>
          {gate.role === "owner" ? `${gate.alias}（你）` : `${gate.alias} · 管理员`}
        </button>
        {step === "menu" && (
          <div className="ac-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => setStep("lockAll")}>
              锁上所有设备
            </button>
            <button type="button" role="menuitem" onClick={() => setStep("newCodes")}>
              重新生成备用码（还剩 {gate.backupLeft} 个）
            </button>
            {gate.role === "owner" ? (
              <button type="button" role="menuitem" onClick={() => setStep("reset")}>
                重新绑验证器
              </button>
            ) : (
              <p className="ac-menu-note">换手机或者验证器丢了：请站长在「管理员」页重置你的验证器。</p>
            )}
          </div>
        )}
      </div>
      <button type="button" className="ac-btn" onClick={lock} disabled={busy}>
        <Icon name="lock" size={16} />
        锁上
      </button>
      {step === "lockAll" && <LockAll onClose={() => setStep(null)} refreshGate={refreshGate} />}
      {step === "newCodes" && <NewCodes gate={gate} onGate={onGate} onClose={() => setStep(null)} />}
      {step === "reset" && <Reset onClose={() => setStep(null)} refreshGate={refreshGate} />}
    </>
  );
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="ac-dialog-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ac-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function LockAll({ onClose, refreshGate }: { onClose: () => void; refreshGate: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    try {
      await adminCall<number>("lockAll");
      await refreshGate();
    } catch (e) {
      setNote(errorWords(e));
      setBusy(false);
    }
  };
  return (
    <Dialog title="锁上所有设备" onClose={onClose}>
      <p className="ac-sub">你登录过的每台设备（包括这台）都要重新输验证器里的数字才能进管理台。觉得别人可能进过你的管理台时用。</p>
      {note && <p className="ac-error">{note}</p>}
      <div className="ac-row">
        <button type="button" className="ac-btn primary" onClick={go} disabled={busy}>
          都锁上
        </button>
        <button type="button" className="ac-btn" onClick={onClose}>
          算了
        </button>
      </div>
    </Dialog>
  );
}

/** A step that wants a code from the last FRESH_MINUTES: the box shows only when one is needed, or the server asked */
function useFresh() {
  const [code, setCode] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  return { code, setCode, asked, setAsked };
}

function NewCodes({ gate, onGate, onClose }: { gate: OpenGate; onGate: (g: GateState) => void; onClose: () => void }) {
  const { call, needsFresh } = useConsole();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const f = useFresh();
  const [needed] = useState(needsFresh);
  const show = needed || Boolean(f.asked);
  const go = async () => {
    setBusy(true);
    try {
      setCodes(await call<string[]>("newBackupCodes", [], { fresh: f.code || undefined }));
      setNote(null);
    } catch (e) {
      if (e instanceof AdminError && e.code === "ADMIN_FRESH") f.setAsked(e.message);
      else setNote(errorWords(e));
      f.setCode("");
    }
    setBusy(false);
  };
  if (codes) {
    return (
      <Dialog title="新的备用码" onClose={() => {}}>
        <BackupCodes
          codes={codes}
          doneWords="好了"
          onDone={() => {
            onGate({ ...gate, backupLeft: codes.length });
            onClose();
          }}
        />
      </Dialog>
    );
  }
  return (
    <Dialog title="重新生成备用码" onClose={onClose}>
      <p className="ac-sub">换一组新的 10 个备用码，旧的马上作废，没用完的也不能用了。新的只显示这一次。</p>
      {show && (
        <div className="ac-field">
          <label htmlFor="ac-fresh-codes">验证器里的 6 位数字</label>
          <CodeInput id="ac-fresh-codes" value={f.code} onChange={f.setCode} invalid={Boolean(f.asked)} autoFocus onEnter={go} />
          {f.asked && <span className="ac-error">{f.asked}</span>}
        </div>
      )}
      {note && <p className="ac-error">{note}</p>}
      <div className="ac-row">
        <button type="button" className="ac-btn primary" onClick={go} disabled={busy || (show && f.code.length < 6)}>
          换一组
        </button>
        <button type="button" className="ac-btn" onClick={onClose}>
          算了
        </button>
      </div>
    </Dialog>
  );
}

function Reset({ onClose, refreshGate }: { onClose: () => void; refreshGate: () => Promise<void> }) {
  const { call, needsFresh } = useConsole();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const f = useFresh();
  const [needed] = useState(needsFresh);
  const show = needed || Boolean(f.asked);
  const go = async () => {
    setBusy(true);
    try {
      await call("resetAdminTotp", [], { fresh: f.code || undefined });
      await refreshGate();
    } catch (e) {
      if (e instanceof AdminError && e.code === "ADMIN_FRESH") f.setAsked(e.message);
      else setNote(errorWords(e));
      f.setCode("");
      setBusy(false);
    }
  };
  return (
    <Dialog title="重新绑验证器" onClose={onClose}>
      <p className="ac-sub">
        换手机、或者觉得验证器被别人看到了时用。现在的验证器和备用码马上作废，所有设备都锁上，然后重新扫码绑一个。绑新的要在登录后 15
        分钟内，太久了要先退出再登录一次。
      </p>
      {show && (
        <div className="ac-field">
          <label htmlFor="ac-fresh-reset">现在验证器里的 6 位数字</label>
          <CodeInput id="ac-fresh-reset" value={f.code} onChange={f.setCode} invalid={Boolean(f.asked)} autoFocus onEnter={go} />
          {f.asked && <span className="ac-error">{f.asked}</span>}
        </div>
      )}
      {note && <p className="ac-error">{note}</p>}
      <div className="ac-row">
        <button type="button" className="ac-btn danger" onClick={go} disabled={busy || (show && f.code.length < 6)}>
          作废，重新绑
        </button>
        <button type="button" className="ac-btn" onClick={onClose}>
          算了
        </button>
      </div>
    </Dialog>
  );
}
