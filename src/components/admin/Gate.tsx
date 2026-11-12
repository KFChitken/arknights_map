"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { pausedWords, SETUP_LOGIN_MINUTES, UNLOCK_HOURS, type GateState, type SetupStart } from "@/lib/adminConsole";
import { adminCall, AdminError, errorWords } from "./api";
import { BrandMark, CodeInput, Icon } from "./ui";

/**
 * The 管理台's door (src/lib/server/admins.ts): binding an authenticator and keeping the backup codes, a code on each
 * device every UNLOCK_HOURS (or a backup code), and the pause after too many wrong ones. Nothing of the 管理台 shows
 * until it lets one in.
 */
export default function Door({ gate, onGate }: { gate: Exclude<GateState, { state: "open" }>; onGate: (g: GateState) => void }) {
  if (gate.state === "setup") return <Setup gate={gate} onGate={onGate} />;
  return <Unlock gate={gate} onGate={onGate} />;
}

function Shell({ wide = false, children, foot, steps }: { wide?: boolean; children: ReactNode; foot?: ReactNode; steps?: ReactNode }) {
  return (
    <div className="ac ac-door">
      <div className="ac-door-brand">
        <BrandMark />
        <strong>舟P 管理台</strong>
      </div>
      {steps}
      <main className={`ac-door-card${wide ? " wide" : ""}`}>{children}</main>
      {foot && <p className="ac-door-foot">{foot}</p>}
    </div>
  );
}

/** 再确认一下是你: a code from the authenticator, or a backup code; paused, the box waits until the pause is over */
function Unlock({ gate, onGate }: { gate: Extract<GateState, { state: "locked" | "paused" }>; onGate: (g: GateState) => void }) {
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const [wrong, setWrong] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const paused = gate.state === "paused";
  const owner = gate.role === "owner";

  // paused: look again once the pause is over
  useEffect(() => {
    if (gate.state !== "paused") return;
    const t = window.setTimeout(
      () => adminCall<GateState>("gate").then(onGate, () => {}),
      Math.max(1000, gate.until - Date.now() + 1000),
    );
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(tick);
    };
  }, [gate, onGate]);

  const send = useCallback(
    async (input: { code: string } | { backup: string }) => {
      setBusy(true);
      try {
        onGate(await adminCall<GateState>("unlock", [input]));
      } catch (e) {
        if (e instanceof AdminError && e.code === "ADMIN_PAUSED") {
          setWrong(null);
          onGate(await adminCall<GateState>("gate").catch(() => gate));
        } else {
          setWrong(errorWords(e));
          setCode("");
        }
      }
      setBusy(false);
    },
    [gate, onGate],
  );

  // six digits: in at once, as on a phone's code box
  const onCode = (v: string) => {
    setCode(v);
    setWrong(null);
    if (v.length === 6 && !busy) void send({ code: v });
  };
  const go = () => {
    if (backup) {
      if (typed.trim()) void send({ backup: typed });
    } else if (code.length === 6) void send({ code });
  };

  return (
    <Shell
      foot={
        owner
          ? "手机丢了：先用备用码进来，再重新绑验证器。备用码也没了，让上线线程在服务器上重置。"
          : "手机丢了：先用备用码进来，再请站长重置你的验证器。备用码也没了，就直接找站长。"
      }
    >
      <span className="ac-door-icon">
        <Icon name="lock" size={24} />
      </span>
      <div>
        <h1>{backup ? "用备用码进来" : "再确认一下是你"}</h1>
        <p className="ac-sub">
          你已经用 {gate.email} 登录了舟P。进管理台还要这一步，每台设备 {UNLOCK_HOURS} 小时一次。
        </p>
      </div>
      <form
        className="ac-stack"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        {backup ? (
          <div className="ac-field">
            <label htmlFor="ac-backup">一个备用码</label>
            <input
              id="ac-backup"
              className="ac-code big backup"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="xxxx-xxxx"
              value={typed}
              disabled={paused}
              onChange={(e) => {
                setTyped(e.target.value);
                setWrong(null);
              }}
            />
            <span className="ac-hint">绑定验证器时存下的 10 个备用码，每个只能用一次。用了会发邮件告诉站长。</span>
          </div>
        ) : (
          <div className="ac-field">
            <label htmlFor="ac-code">验证器里的 6 位数字</label>
            <CodeInput id="ac-code" big value={code} onChange={onCode} disabled={paused || busy} invalid={Boolean(wrong)} autoFocus />
            <span className="ac-hint">打开手机上的验证器 App，找「舟P 管理台」那一行。数字每 30 秒换一次。</span>
          </div>
        )}
        {wrong && !paused && (
          <p role="alert" className="ac-error">
            {wrong}
          </p>
        )}
        {gate.state === "paused" && (
          <p role="alert" className="ac-paused">
            {pausedWords(gate.role, gate.until, gate.minutes, now)}
          </p>
        )}
        <button type="submit" className="ac-btn primary tall full" disabled={paused || busy || (backup ? !typed.trim() : code.length < 6)}>
          {busy ? "正在确认…" : "进入管理台"}
        </button>
      </form>
      <div className="ac-door-links">
        <button
          type="button"
          className="ac-link"
          onClick={() => {
            setBackup((b) => !b);
            setWrong(null);
          }}
        >
          {backup ? "用验证器里的数字" : "手机不在身边？用备用码"}
        </button>
        {gate.state === "locked" && gate.backupLeft === 0 && <span className="ac-hint">备用码都用完了</span>}
      </div>
    </Shell>
  );
}

/**
 * 绑定验证器, then 存好备用码: the owner's two steps (moderators read their rules first, from the second step on).
 * Binding wants a sign-in from the last SETUP_LOGIN_MINUTES, so a stolen cookie cannot bind its own authenticator.
 */
function Setup({ gate, onGate }: { gate: Extract<GateState, { state: "setup" }>; onGate: (g: GateState) => void }) {
  const [start, setStart] = useState<SetupStart | null>(null);
  const [relogin, setRelogin] = useState(!gate.recentLogin);
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ codes: string[]; state: GateState } | null>(null);

  useEffect(() => {
    if (relogin) return;
    let live = true;
    adminCall<SetupStart>("setupStart")
      .then((s) => live && setStart(s))
      .catch((e) => {
        if (!live) return;
        if (e instanceof AdminError && e.code === "ADMIN_RELOGIN") setRelogin(true);
        else setNote(errorWords(e));
      });
    return () => {
      live = false;
    };
  }, [relogin]);

  const confirm = async () => {
    if (code.length < 6) return;
    setBusy(true);
    try {
      setDone(await adminCall<{ codes: string[]; state: GateState }>("setupConfirm", [{ code }]));
      setNote(null);
    } catch (e) {
      if (e instanceof AdminError && e.code === "ADMIN_RELOGIN") setRelogin(true);
      setNote(errorWords(e));
      setCode("");
    }
    setBusy(false);
  };

  const step = done ? 2 : 1;
  const steps = (
    <ol className="ac-steps" aria-label="步骤">
      {["绑定验证器", "存好备用码"].map((label, i) => (
        <li key={label} className={i + 1 === step ? "now" : i + 1 < step ? "past" : ""} aria-current={i + 1 === step ? "step" : undefined}>
          <span>{i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );

  return (
    <Shell wide steps={steps} foot="绑好后站长会收到一封邮件。没绑好之前，管理台里什么都看不到。">
      {done ? (
        <BackupCodes codes={done.codes} onDone={() => onGate(done.state)} />
      ) : relogin ? (
        <div className="ac-stack">
          <div>
            <h1>先重新登录一次</h1>
            <p className="ac-sub">
              为了安全，绑验证器要在登录后 {SETUP_LOGIN_MINUTES} 分钟内。先回到地图，在「我的资料」最下面退出，再用 {gate.email} 登录，然后马上回到这里。
            </p>
          </div>
          <div>
            <Link className="ac-btn primary tall" href="/">
              回到地图
            </Link>
          </div>
        </div>
      ) : (
        <div className="ac-stack">
          <div>
            <h1>绑定验证器</h1>
            <p className="ac-sub">以后每次进管理台，都要输验证器 App 里的 6 位数字。这样就算有人拿到了你的邮箱，也进不来。</p>
          </div>
          <div className="ac-qr-row">
            <div className="ac-qr" role="img" aria-label="绑定验证器的二维码">
              {start ? (
                // the server's own SVG of the otpauth link (qrcode), nothing a player wrote
                <span dangerouslySetInnerHTML={{ __html: start.qr }} />
              ) : (
                <span className="ac-hint">{note ? "" : "二维码生成中…"}</span>
              )}
            </div>
            <div className="ac-qr-steps">
              <p>1. 在手机上打开验证器 App：Google 身份验证器、微软 Authenticator 都行，iPhone 自带的「密码」App 也行。</p>
              <p>2. 点「添加」，扫左边的码。</p>
              <p className="ac-sub">
                扫不了就手动输入这串：<code className="ac-secret">{start?.secret ?? "…"}</code>
              </p>
            </div>
          </div>
          <form
            className="ac-field"
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            <label htmlFor="ac-first">3. 输入 App 里显示的 6 位数字</label>
            <CodeInput id="ac-first" big value={code} onChange={setCode} disabled={!start || busy} invalid={Boolean(note)} />
            {note && (
              <p role="alert" className="ac-error">
                {note}
              </p>
            )}
            <div>
              <button type="submit" className="ac-btn primary tall" disabled={!start || busy || code.length < 6}>
                {busy ? "正在确认…" : "确认绑定"}
              </button>
            </div>
          </form>
        </div>
      )}
    </Shell>
  );
}

/** The backup codes, shown this once: copy them, keep them as a file, and say they are kept before going on */
export function BackupCodes({ codes, onDone, doneWords = "进入管理台" }: { codes: string[]; onDone: () => void; doneWords?: string }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `舟P 管理台的备用码（每个只能用一次）\n\n${codes.join("\n")}\n`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const file = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "舟P管理台备用码.txt";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="ac-stack">
      <div>
        <h1>存好备用码</h1>
        <p className="ac-sub">手机不在身边时，用一个备用码进来，每个只能用一次。它们只显示这一次，关掉就看不到了。</p>
      </div>
      <ul className="ac-backup-codes" aria-label="备用码">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="ac-row">
        <button type="button" className="ac-btn" onClick={copy}>
          {copied ? "复制好了" : "复制全部"}
        </button>
        <button type="button" className="ac-btn" onClick={file}>
          存成文件
        </button>
      </div>
      <label className="ac-check-card">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>我存好了（别存在同一台手机上）</span>
      </label>
      <div>
        <button type="button" className="ac-btn primary tall" disabled={!saved} onClick={onDone}>
          {doneWords}
        </button>
      </div>
    </div>
  );
}

/** Signed out, or no longer let in, while the page was open */
export function Gone() {
  return (
    <div className="ac ac-door">
      <div className="ac-door-brand">
        <BrandMark />
        <strong>舟P 管理台</strong>
      </div>
      <main className="ac-door-card">
        <h1>打不开了</h1>
        <p className="ac-sub">可能是退出了登录。回到地图登录以后再来。</p>
        <div>
          <Link className="ac-btn primary tall" href="/">
            回到地图
          </Link>
        </div>
      </main>
    </div>
  );
}
