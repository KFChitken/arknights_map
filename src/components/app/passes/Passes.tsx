"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { fmt, T } from "@/i18n";
import { characterName, nameMatches } from "@/i18n/names";
import { fmtNodes } from "@/i18n/nodes";
import type { Game } from "@/lib/games";
import { CATALOG_SIZE, catalogCounts, PASS_CATALOG, passChar, passCharNamed, type PassChar } from "@/lib/passCatalog";
import {
  bestOf,
  claimable,
  DAY_TICKETS,
  GIFTS_IN_PER_DAY,
  gotToday,
  isFancy,
  padNo,
  passesDot,
  PITY,
  pityLeft,
  TASK_MAX,
  TICKETS_CAP,
  unclaimed,
  WELCOME_TICKETS,
  WISH_MAX,
  type Collection,
  type Drawn,
  type DrawSize,
  type LogRow,
  type OwnedChar,
  type PassCopy,
  type PassesMe,
  type PassState,
  type Task,
  type Tier,
  type WornPass,
} from "@/lib/passes";
import { passesApi } from "@/lib/passesClient";
import { useLeanArt } from "@/lib/passLean";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError } from "@/lib/world/types";
import { useOperatorArt, type Art } from "../OperatorNames";
import { CardBack, FullPass, issued, MiniPass, PassArtProvider, picOf, smallUrl, usePassArt } from "./PassCard";
import "./passes.css";

/**
 * 通行证寻访 (src/lib/passes.ts), over everything on the map in each of the three layouts: the page with the wish list,
 * the count towards a sure wish and 每日任务 (whose tickets are claimed there, a tap on a task); 刷券, where the passes a draw brought (decided by the server
 * before anything shows) come out of a reader face down and are turned over one by one; 我的通行证 (each character
 * opens to their whole pass, its look and the one worn), the wish list's editor, 概率说明 and 寻访记录. ×, ‹ 地图,
 * a tap beside it and Escape close it, or step back a screen.
 * holder: the name printed on the player's passes (their card's, 匿名舟P for the anonymous); onRefused: a refusal the
 * map page answers itself (sign in, say again they are 18, agree to the privacy policy), which closes this first;
 * onWallet: the tickets the map's button shows and the pass worn, as they change; onGift: 送券, the 触须之交 page
 * picking whom to give a 寻访券 (this closes first).
 */
export default function Passes({
  favourites,
  holder,
  onClose,
  onGift,
  onRefused,
  onWallet,
}: {
  favourites: Record<Game, string[]>;
  holder: string;
  onClose: () => void;
  onGift: () => void;
  onRefused: (e: unknown) => void;
  onWallet: (p: PassesMe) => void;
}) {
  const art = useOperatorArt();
  const passArt = usePassArt();
  const lean = useLeanArt();
  const [st, setSt] = useState<PassState | null>(null);
  const [failed, setFailed] = useState(false);
  const [msg, setMsg] = useState("");
  const [screen, setScreen] = useState<"home" | "wallet" | "wish" | "odds" | "log">("home");
  const [busy, setBusy] = useState(false);
  const [term, setTerm] = useState<{ drawn: Drawn[]; n: DrawSize; key: number } | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const walletRef = useRef(onWallet);
  walletRef.current = onWallet;
  const refusedRef = useRef(onRefused);
  refusedRef.current = onRefused;
  // the wallet as the last answer had it, for what runs after an await
  const stRef = useRef<PassState | null>(null);
  const took = useCallback((s: PassState) => {
    stRef.current = s;
    setSt(s);
    walletRef.current({ tickets: s.tickets, dot: passesDot(true, s.tickets, s.tasks), worn: s.worn });
  }, []);
  /** A refusal: the map page's own kinds there, the rest said here */
  const refuse = useCallback((e: unknown) => {
    if (mapsOwn(e)) return refusedRef.current(e);
    if (live.current) setMsg(sayWhy(e));
  }, []);

  const load = useCallback(() => {
    setFailed(false);
    passesApi.open().then(
      (s) => {
        if (!live.current) return;
        took(s);
        if (s.welcomed) setMsg(fmt(T.passes.welcome, { n: WELCOME_TICKETS }));
      },
      (e) => {
        if (mapsOwn(e)) return refusedRef.current(e);
        if (live.current) setFailed(true);
      },
    );
  }, [took]);
  useEffect(load, [load]);

  // 每日任务: claims one after another, so each answer is the wallet after the one before it; a row tapped again
  // before its answer came is not asked twice. Once claimed, the count of tickets jumps (not for less motion), a
  // screen reader is told, and the focus goes on to the next row to claim, or to 寻访十次 (Home)
  const claims = useRef<Promise<void>>(Promise.resolve());
  const claiming = useRef(new Set<Task>());
  const [bump, setBump] = useState<{ n: number; key: number } | null>(null);
  const [said, setSaid] = useState("");
  const [claimed, setClaimed] = useState(0);
  const claim = (task: Task) => {
    if (claiming.current.has(task)) return;
    claiming.current.add(task);
    setMsg("");
    claims.current = claims.current.then(async () => {
      try {
        const was = stRef.current?.tasks.find((t) => t.task === task)?.got ?? 0;
        const s = await passesApi.claim(task);
        if (!live.current) return;
        took(s);
        const n = Math.max(0, (s.tasks.find((t) => t.task === task)?.got ?? 0) - was);
        setSaid(fmt(T.passes.tasks.claimed, { n, tickets: s.tickets }));
        if (n && !stillMotion()) setBump({ n, key: Date.now() });
        setClaimed((k) => k + 1);
      } catch (e) {
        refuse(e);
        // what the page shows may be of a day gone by, or behind the wallet: as it is now
        if (!mapsOwn(e)) passesApi.open().then((s) => live.current && took(s), () => {});
      } finally {
        claiming.current.delete(task);
      }
    });
  };
  useEffect(() => {
    if (!bump) return;
    const t = window.setTimeout(() => setBump(null), 900);
    return () => window.clearTimeout(t);
  }, [bump]);

  const pulling = useRef(false);
  const pull = async (n: DrawSize) => {
    if (busy || pulling.current) return;
    pulling.current = true;
    try {
      // a claim on its way first: its tickets count
      await claims.current;
      const now = stRef.current;
      if (!now || !live.current) return;
      if (now.tickets < n) {
        const left = Math.min(unclaimed(now.tasks), TICKETS_CAP - now.tickets);
        return setMsg(left > 0 ? fmt(T.passes.notEnoughClaim, { n: left }) : T.passes.notEnough);
      }
      await drawNow(n);
    } finally {
      pulling.current = false;
    }
  };
  const drawNow = async (n: DrawSize) => {
    setBusy(true);
    setMsg("");
    try {
      const r = await passesApi.draw(n);
      // the small pictures of who came, on their way while the ticket goes in (a whole pass's only once held up)
      for (const d of r.drawn) {
        const c = passChar(d.charId);
        const src = c && smallUrl(picOf(c, passArt, art), lean);
        if (src) new Image().src = src;
      }
      if (!live.current) return;
      took(r.state);
      setTerm({ drawn: r.drawn, n, key: Date.now() });
    } catch (e) {
      refuse(e);
    } finally {
      if (live.current) setBusy(false);
    }
  };

  // Into it for the keyboard and screen readers, and kept in it: Tab goes round what it has to press, Escape steps
  // back (刷券: shows all at once, then puts it away; a character of 我的通行证: back to the list; a screen: back to
  // 寻访; 寻访: closes it); closed, back to where the focus was
  const box = useRef<HTMLDivElement>(null);
  const termEscape = useRef<(() => void) | null>(null);
  const stepBack = useRef<(() => void) | null>(null);
  const escape = useRef(() => {});
  escape.current = () => {
    if (term) termEscape.current?.();
    else if (stepBack.current) stepBack.current();
    else if (screen !== "home") setScreen("home");
    else onClose();
  };
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus({ preventScroll: true });
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        escape.current();
      } else if (e.key === "Tab") keepFocus(e, box.current);
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  // a new screen takes the focus, so the keyboard starts at its top
  useEffect(() => {
    if (!term) box.current?.focus({ preventScroll: true });
  }, [screen, term]);

  const night = screen === "home";
  return (
    <div className="passes" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={`ps-box ${night ? "night" : "day"}`} role="dialog" aria-modal="true" aria-label={T.passes.label} tabIndex={-1}>
        <PassArtProvider value={passArt}>
        {!st ? (
          <div className="ps-wait">
            {failed ? (
              <>
                <p>{T.map.common.tryAgain}</p>
                <button className="ps-pill" onClick={load}>
                  {T.passes.retry}
                </button>
                <button className="ps-pill ghost" onClick={onClose}>
                  {T.passes.back}
                </button>
              </>
            ) : (
              <p>{T.passes.loading}</p>
            )}
          </div>
        ) : screen === "home" ? (
          <Home
            st={st}
            art={art}
            msg={msg}
            said={said}
            busy={busy}
            bump={bump}
            claimed={claimed}
            onPull={pull}
            onClaim={claim}
            onScreen={setScreen}
            onGift={onGift}
            onClose={onClose}
            hidden={Boolean(term)}
          />
        ) : screen === "wallet" ? (
          <Wallet st={st} art={art} holder={holder} stepBack={stepBack} onBack={() => setScreen("home")} onTook={took} onRefused={refuse} />
        ) : screen === "wish" ? (
          <WishEditor
            st={st}
            art={art}
            favourites={favourites}
            onBack={() => setScreen("home")}
            onSaved={(s) => {
              took(s);
              setMsg(T.passes.wish.saved);
              setScreen("home");
            }}
            onRefused={refuse}
          />
        ) : screen === "odds" ? (
          <Odds gifts={st.gifts} onBack={() => setScreen("home")} />
        ) : (
          <Log art={art} onBack={() => setScreen("home")} onRefused={refuse} />
        )}
        {term && st && (
          <Terminal
            key={term.key}
            drawn={term.drawn}
            n={term.n}
            at={term.key}
            art={art}
            holder={holder}
            escapeRef={termEscape}
            enough={st.tickets >= term.n}
            onKeep={() => setTerm(null)}
            onAgain={() => {
              setTerm(null);
              void pull(term.n);
            }}
          />
        )}
        </PassArtProvider>
      </div>
    </div>
  );
}

/** The refusals the map page answers itself: sign in, say again they are 18, agree to the updated privacy policy */
const mapsOwn = (e: unknown) => e instanceof SignInNeeded || e instanceof AgeCheckNeeded || e instanceof ConsentNeeded;
/** What to tell the player of any other refusal */
function sayWhy(e: unknown): string {
  if (e instanceof WorldError) return e.message;
  console.error(e);
  return T.map.common.tryAgain;
}

/** Tab and Shift+Tab kept going round what can be pressed in it */
function keepFocus(e: KeyboardEvent, root: HTMLElement | null) {
  if (!root) return;
  const all = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]')].filter(
    (b) => !b.closest("[inert]") && b.offsetParent !== null,
  );
  if (!all.length) return;
  const at = document.activeElement;
  const out = !root.contains(at) || at === root;
  if (e.shiftKey ? out || at === all[0] : at === all[all.length - 1] || !root.contains(at)) {
    e.preventDefault();
    (e.shiftKey ? all[all.length - 1] : all[0]).focus();
  }
}

/** A word and a button that act as one when pressed, or Enter or Space on it */
const pressKeys = (fn: () => void) => (e: ReactKeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
};

/** The tickets held; bump: just claimed so many, the count jumps and +n rises from it */
function TicketCount({ n, bump }: { n: number; bump?: { n: number; key: number } | null }) {
  return (
    <span className={`tk${bump ? " bump" : ""}`} role="img" aria-label={fmt(T.passes.tickets, { n })}>
      <i aria-hidden="true" />
      {/* a new key each claim, so the jump plays again */}
      <em key={`n${bump?.key ?? ""}`} aria-hidden="true">
        {n}
      </em>
      {bump && (
        <span key={`p${bump.key}`} className="tk-plus" aria-hidden="true">
          +{bump.n}
        </span>
      )}
    </span>
  );
}

/** The wish list as six places: who is on it (in colour, with the number of their first, once drawn), and the empty ones */
function WishSlots({ st, art, draft, onRemove }: { st: PassState; art: Art | null; draft?: number[]; onRemove?: (id: number) => void }) {
  const ids = draft ?? st.wish;
  return (
    <>
      {Array.from({ length: WISH_MAX }, (_, k) => {
        const c = ids[k] !== undefined ? passChar(ids[k]) : null;
        if (!c) {
          return (
            <div key={`e${k}`} className="hw empty" role="img" aria-label={fmt(T.passes.wish.emptySlot, { n: k + 1 })}>
              <div className="slotx" aria-hidden="true">
                +
              </div>
              <span aria-hidden="true">{T.passes.emptySlot}</span>
            </div>
          );
        }
        const own = st.wishOwned.find((o) => o.charId === c.id);
        return (
          <div key={c.id} className={`hw${own ? " got" : ""}`}>
            {own && !onRemove && (
              <span className="ck" aria-hidden="true">
                ✓
              </span>
            )}
            {onRemove && (
              <button className="x" aria-label={fmt(T.passes.wish.remove, { name: characterName(c.name) })} onClick={() => onRemove(c.id)}>
                ✕
              </button>
            )}
            <MiniPass c={c} no={own ? own.no : null} fancy={own ? isFancy(own.copies, st.plain.includes(c.id)) : false} art={art} />
            <span>{characterName(c.name)}</span>
            {own && !onRemove && <span className="sr">{T.passes.owned}</span>}
          </div>
        );
      })}
    </>
  );
}

/** The small pictures of 每日任务: a roach, a speech bubble, an arrow back, a star (the NPC), a gift */
const TASK_ICON: Record<Task | "gift", ReactNode> = {
  touch: (
    <>
      <ellipse cx="6.5" cy="8.7" rx="2.4" ry="3.1" />
      <path d="M6.5 6.6v5M5.8 5.7C5.3 3.7 4.2 2.2 2.5 1.5M7.2 5.7c.5-2 1.6-3.5 3.3-4.2M4.1 8.2 2.3 7.4M4.1 10l-1.8.9M8.9 8.2l1.8-.8M8.9 10l1.8.9" />
    </>
  ),
  declare: <path d="M2 2.6h9v6.1H6.2L3.4 11V8.7H2z" />,
  reply: (
    <>
      <path d="M5.4 3 2 6.4l3.4 3.4" />
      <path d="M2.4 6.4h5.4a3.2 3.2 0 0 1 3.2 3.2v.9" />
    </>
  ),
  npc: <path d="m6.5 1.6 1.45 2.95 3.25.47-2.35 2.3.55 3.23L6.5 9.03 3.6 10.55l.55-3.23L1.8 5.02l3.25-.47z" />,
  gift: (
    <>
      <rect x="1.9" y="5.2" width="9.2" height="6.3" rx="1" />
      <path d="M1.4 3.3h10.2v1.9H1.4zM6.5 3.3v8.2M6.5 3.3C5.6 1.5 3.6 1.5 3.9 2.7c.3.6 1.6.6 2.6.6m0 0c.9-1.8 2.9-1.8 2.6-.6-.3.6-1.6.6-2.6.6" />
    </>
  ),
};

function TaskIcon({ k }: { k: Task | "gift" }) {
  return (
    <svg viewBox="0 0 13 13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round">
      {TASK_ICON[k]}
    </svg>
  );
}

/**
 * 每日任务: a row a task, its little boxes its tickets of the day (solid: claimed, outlined: done and not claimed
 * yet, grey: not done); a row with tickets to claim is the button that claims them (as many as TICKETS_CAP leaves
 * room for: 满 50 张 when none). Under them, while 触须之交 may give them, the tickets given today: theirs at once.
 */
export function Tasks({ st, onClaim }: { st: PassState; onClaim: (task: Task) => void }) {
  const t = T.passes.tasks;
  return (
    <div className="g-task">
      <div className="gt-h">
        <b>
          {t.title}
          <small>{t.refresh}</small>
        </b>
        <em>{fmtNodes(t.got, { b: <b>{gotToday(st.tasks)}</b>, n: DAY_TICKETS })}</em>
      </div>
      {st.tasks.map((k) => {
        const name = t.name[k.task];
        const n = claimable(k, st.tickets);
        const max = k.max;
        const inner = (
          <>
            <TaskIcon k={k.task} />
            <span className="l">{name}</span>
            <span className="gt-p" aria-hidden="true">
              {Array.from({ length: max }, (_, i) => (
                <i key={i} className={i < k.got ? "g" : i < k.done ? "d" : ""} />
              ))}
            </span>
            {n > 0 ? (
              <span className="gt-x can">{fmt(t.claim, { n })}</span>
            ) : k.done > k.got ? (
              <span className="gt-x full">{fmt(t.full, { n: TICKETS_CAP })}</span>
            ) : k.got >= max ? (
              <span className="gt-x ok">{t.done}</span>
            ) : (
              <span className="gt-x">{fmt(t.count, { done: k.done, max })}</span>
            )}
          </>
        );
        return n > 0 ? (
          <button key={k.task} type="button" className="gt-r can" aria-label={fmt(t.claimLabel, { name, n })} onClick={() => onClaim(k.task)}>
            {inner}
          </button>
        ) : (
          <div key={k.task} className="gt-r">
            {inner}
          </div>
        );
      })}
      {st.gifts && (
        <div className="gt-r gift">
          <TaskIcon k="gift" />
          <span className="l">{t.gifts}</span>
          <span className="gt-p" aria-hidden="true">
            {Array.from({ length: GIFTS_IN_PER_DAY }, (_, i) => (
              <i key={i} className={i < st.giftsIn ? "g" : ""} />
            ))}
          </span>
          <span className="gt-x">{fmt(t.giftsIn, { n: st.giftsIn })}</span>
        </div>
      )}
    </div>
  );
}

function Home({
  st,
  art,
  msg,
  said,
  busy,
  bump,
  claimed,
  hidden,
  onPull,
  onClaim,
  onScreen,
  onGift,
  onClose,
}: {
  st: PassState;
  art: Art | null;
  msg: string;
  /** what the last claim brought, for screen readers */
  said: string;
  busy: boolean;
  bump: { n: number; key: number } | null;
  /** claims answered so far: each moves the focus on */
  claimed: number;
  /** 刷券 is over it */
  hidden: boolean;
  onPull: (n: DrawSize) => void;
  onClaim: (task: Task) => void;
  onScreen: (s: "wallet" | "wish" | "odds" | "log") => void;
  /** 送券: to the 触须之交 page */
  onGift: () => void;
  onClose: () => void;
}) {
  const has = st.wish.length > 0;
  const miss = has ? st.miss : 0;
  // a task claimed: on to the next with tickets to claim, else to 寻访十次
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!claimed) return;
    const next = root.current?.querySelector<HTMLElement>("button.gt-r") ?? root.current?.querySelector<HTMLElement>(".g-btns .y");
    next?.focus({ preventScroll: true });
  }, [claimed]);
  return (
    <div ref={root} className="ps-home" inert={hidden || undefined}>
      <div className="g-top">
        <button className="g-back" onClick={onClose} aria-label={T.passes.close}>
          ‹ <span>{T.passes.back}</span>
        </button>
        <b>{T.passes.title}</b>
        <TicketCount n={st.tickets} bump={bump} />
      </div>
      <div className="ps-scroll">
        <section className="hb">
          <div className="hb-t">
            <em>{T.passes.kicker}</em>
            <b>{T.passes.banner}</b>
            <span>{fmt(T.passes.pool, { n: CATALOG_SIZE })}</span>
          </div>
          <div className="hb-w">
            <WishSlots st={st} art={art} />
          </div>
          <div className="hb-n">
            <span>{fmt(T.passes.wishHead, { pity: PITY })}</span>
            <button className="hb-edit" onClick={() => onScreen("wish")}>
              {T.passes.editWish} ›
            </button>
          </div>
        </section>
        <div className="hp">
          <div className="hp-bar" aria-hidden="true">
            {Array.from({ length: PITY }, (_, i) => (
              <i key={i} className={`${i < miss ? "on" : ""}${i === PITY - 1 ? " last" : ""}`} />
            ))}
          </div>
          <div className="hp-t">
            {has ? (
              <>
                <span>{fmtNodes(T.passes.missed, { b: <b>{miss}</b> })}</span>
                <span>{fmtNodes(T.passes.left, { b: <b>{pityLeft(miss)}</b> })}</span>
              </>
            ) : (
              <span>{T.passes.noPity}</span>
            )}
          </div>
        </div>
        <Tasks st={st} onClaim={onClaim} />
        <div className="g-btns">
          {/* too few tickets: dimmed, and pressed, says how to get more */}
          <button className={st.tickets < 1 ? "dim" : ""} onClick={() => onPull(1)} disabled={busy}>
            {T.passes.drawOne}
            <small>{fmt(T.passes.cost, { n: 1 })}</small>
          </button>
          <button className={`y${st.tickets < 10 ? " dim" : ""}`} onClick={() => onPull(10)} disabled={busy}>
            {T.passes.drawTen}
            <small>{fmt(T.passes.cost, { n: 10 })}</small>
          </button>
        </div>
        <p className="g-msg" role="status">
          {msg}
        </p>
        <p className="sr" role="status">
          {said}
        </p>
        <div className="g-links">
          <button onClick={() => onScreen("odds")}>{T.passes.links.odds}</button>
          <button onClick={() => onScreen("log")}>{T.passes.links.log}</button>
          <button onClick={() => onScreen("wallet")}>{T.passes.links.wallet}</button>
          {st.gifts && <button onClick={onGift}>{T.passes.links.gift}</button>}
        </div>
        <p className="ps-copy">{T.passes.copyright}</p>
      </div>
    </div>
  );
}

/** Room under a card for its name */
const CAPTION = 20;
/** How tall a card is for its width: a small pass is 5:9 (pass.css .mp) */
const TALL = 9 / 5;
/** Where the cards of a draw lie in a box W wide: one big in the middle, or two rows of five */
export function layout(n: number, W: number): { pos: { x: number; y: number; w: number }[]; h: number } {
  // under each card its name once turned (CAPTION), and over it the tag of what it was
  if (n === 1) {
    const w = Math.round(Math.min(96, W * 0.38));
    return { pos: [{ x: Math.round((W - w) / 2), y: 14, w }], h: 14 + Math.round(w * TALL) + CAPTION };
  }
  const gap = W < 240 ? 6 : 8;
  const w = Math.floor((W - 4 * gap) / 5);
  const x0 = Math.round((W - (5 * w + 4 * gap)) / 2);
  const rowH = Math.round(w * TALL);
  const rows = [14, 14 + rowH + CAPTION + 12];
  return { pos: Array.from({ length: n }, (_, i) => ({ x: x0 + (i % 5) * (w + gap), y: rows[Math.floor(i / 5)], w })), h: rows[1] + rowH + CAPTION };
}

/** The reader's light for the best of a draw: rainbow (a wish), gold (someone new), pearl (a second copy), blue */
const LIGHT: Record<Tier, string> = { wish: "var(--t-new)", new: "var(--t-new)", up: "var(--t-up)", dup: "var(--t-dup)" };
const TAG_CLASS: Record<Tier, string> = { wish: "w", new: "n", up: "u", dup: "d" };
/** How far the ticket goes down at most, and from how far it counts as pulled */
const PULL_MAX = 150;
const PULL_AT = 80;

const stillMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 刷券: the ticket over the reader, pulled down past PULL_AT (or tapped, Enter or Space); the reader lights up as the
 * best of the draw; the passes come out face down and are turned over one by one, or all at once; the first wish
 * among them is held up on its own; at the end what came, the best of it on a line of its own. 跳过 shows all of it
 * at once, as does a system that asks for less motion, from the start.
 */
function Terminal({
  drawn,
  n,
  at,
  art,
  holder,
  escapeRef,
  enough,
  onKeep,
  onAgain,
}: {
  drawn: Drawn[];
  n: DrawSize;
  /** when they were drawn, as printed on a pass held up */
  at: number;
  art: Art | null;
  holder: string;
  escapeRef: { current: (() => void) | null };
  /** tickets enough for the same again: else it is dimmed, and pressed, says so on 寻访 */
  enough: boolean;
  onKeep: () => void;
  onAgain: () => void;
}) {
  type Stage = "armed" | "going" | "cards" | "flip" | "done";
  const [stage, setStage] = useState<Stage>("armed");
  const [lit, setLit] = useState(false);
  const [shake, setShake] = useState(false);
  const [out, setOut] = useState(false);
  const [open, setOpen] = useState<boolean[]>(() => drawn.map(() => false));
  const opened = useRef(open);
  const [held, setHeld] = useState<Drawn | null>(null);
  const heldOnce = useRef(false);
  const [dy, setDy] = useState(0);
  const [springBack, setSpringBack] = useState(false);
  const from = useRef<number | null>(null);
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const best = bestOf(drawn)!;
  const cardsBox = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(340);
  useLayoutEffect(() => {
    const el = cardsBox.current;
    if (!el) return;
    const read = () => setW(el.clientWidth || 340);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const lay = useMemo(() => layout(drawn.length, W), [drawn.length, W]);

  const root = useRef<HTMLDivElement>(null);
  const focus = (sel: string) => window.setTimeout(() => root.current?.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true }), 0);

  const finish = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setHeld(null);
    setLit(true);
    setOut(true);
    opened.current = drawn.map(() => true);
    setOpen(opened.current);
    setStage("done");
    focus("[data-keep]");
  };
  const done = () => {
    setStage("done");
    focus("[data-keep]");
  };
  const fire = () => {
    if (stage !== "armed") return;
    if (stillMotion()) return finish();
    setStage("going");
    setSpringBack(false);
    setDy(170);
    later(() => {
      setLit(true);
      setShake(true);
    }, 260);
    later(() => {
      setStage("cards");
      // a frame face down at the reader's slot, then off to their places, one after another
      requestAnimationFrame(() => requestAnimationFrame(() => setOut(true)));
      later(() => {
        setStage("flip");
        focus(".cardx");
      }, drawn.length * 70 + 520);
    }, 1000);
  };
  const flip = (i: number, all = false) => {
    if (opened.current[i]) return;
    const next = opened.current.slice();
    next[i] = true;
    opened.current = next;
    setOpen(next);
    const d = drawn[i];
    if (d.tier === "wish" && !heldOnce.current && !stillMotion()) {
      heldOnce.current = true;
      later(() => setHeld(d), all ? 250 : 380);
    }
    if (next.every(Boolean)) later(done, heldOnce.current ? 500 : 520);
  };
  const openAll = () => drawn.forEach((_, i) => later(() => flip(i, true), i * 80));
  // a card turned over already is held up whole, its big picture fetched only now
  const press = (i: number) => {
    if (opened.current[i]) setHeld(drawn[i]);
    else if (stage === "flip") flip(i);
  };

  // with less motion, no show at all: what came, at once
  useEffect(() => {
    if (stillMotion()) finish();
    else focus(".t-ticket");
    // once, as it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  escapeRef.current = () => {
    if (held) setHeld(null);
    else if (stage === "done") onKeep();
    else finish();
  };

  // the ticket, held and pulled down
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (stage !== "armed") return;
    from.current = e.clientY;
    setSpringBack(false);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (from.current === null) return;
    setDy(Math.max(0, Math.min(PULL_MAX, e.clientY - from.current)));
  };
  const up = () => {
    if (from.current === null) return;
    from.current = null;
    if (dy >= PULL_AT) fire();
    else {
      setSpringBack(true);
      setDy(0);
    }
  };
  const p = stage === "armed" ? dy / PULL_MAX : 0;
  const glow: CSSProperties | undefined =
    p > 0 && !lit
      ? { background: `rgba(255,255,255,${(0.2 + p * 0.55).toFixed(2)})`, boxShadow: `0 0 ${Math.round(p * 12)}px ${Math.round(p * 3)}px rgba(255,255,255,${(p * 0.5).toFixed(2)})` }
      : undefined;

  const cards = stage === "cards" || stage === "flip" || stage === "done";
  // where the slot is, from the top left of the cards: the reader is under them
  const slotY = lay.h + 2 + 91;
  const count = (t: Tier) => drawn.filter((d) => d.tier === t).length;
  const bestChar = passChar(best.charId);
  const tail =
    best.tier === "wish" ? (best.up ? T.passes.term.tail.wishUp : T.passes.term.tail.wish) : T.passes.term.tail[best.tier];
  return (
    <div
      ref={root}
      className={`term${lit && best.tier === "wish" ? " rain" : ""}`}
      style={{ "--tc": LIGHT[best.tier] } as CSSProperties}
    >
      <div className="t-top" inert={held ? true : undefined}>
        <span />
        <b>{fmt(T.passes.term.head, { n })}</b>
        {stage !== "done" ? <button onClick={finish}>{T.passes.term.skip}</button> : <span />}
      </div>
      <div className="t-cards" ref={cardsBox} style={{ height: lay.h }} inert={held ? true : undefined}>
        {cards &&
          drawn.map((d, i) => {
            const c = passChar(d.charId);
            if (!c) return null;
            const at = lay.pos[i];
            const turned = open[i];
            const start = `translate(${Math.round(W / 2 - (at.x + at.w / 2))}px,${Math.round(slotY - (at.y + at.w * 0.75))}px) scale(.2)`;
            return (
              <div
                key={i}
                className={`cardx t-${d.tier}${turned ? " open" : ""}`}
                role="button"
                tabIndex={stage === "flip" || stage === "done" ? 0 : -1}
                aria-label={
                  turned
                    ? fmt(T.passes.term.card, { name: characterName(c.name), no: padNo(d.no), tier: T.passes.term.tier[d.tier] })
                    : fmt(T.passes.term.flipCard, { n: i + 1 })
                }
                aria-haspopup={turned ? "dialog" : undefined}
                style={{
                  left: at.x,
                  top: at.y,
                  width: at.w,
                  opacity: out ? 1 : 0,
                  transform: out ? undefined : start,
                  transitionDelay: out && stage === "cards" ? `${i * 70}ms` : undefined,
                }}
                onClick={() => press(i)}
                onKeyDown={pressKeys(() => press(i))}
              >
                <i className="glow" />
                <div className="fl">
                  <div className="bk">
                    <CardBack />
                  </div>
                  <div className="fr">
                    <MiniPass c={c} no={d.no} fancy={d.fancy} art={art} />
                    <span className={`ttag ${TAG_CLASS[d.tier]}`}>{T.passes.term.tag[d.tier]}</span>
                  </div>
                </div>
                {turned && (
                  <span className="cap" aria-hidden="true">
                    {characterName(c.name)}
                  </span>
                )}
              </div>
            );
          })}
      </div>
      <div className={`t-dev${shake ? " shake" : ""}`} style={{ opacity: stage === "done" ? 0 : stage === "flip" ? 0.35 : 1 }} inert={held ? true : undefined}>
        <i className={`t-led${lit ? " lit" : ""}`} style={glow} />
        <span className="t-tag">ZP · PASS READER</span>
        <i className={`t-beam${lit ? " lit" : ""}`} />
        <i className={`t-slot${lit ? " lit" : ""}`} />
        <div className="t-clip">
          {(stage === "armed" || stage === "going") && (
            <button
              className={`t-ticket${stage === "going" ? " go" : ""}${springBack ? " back" : ""}`}
              style={{ transform: dy ? `translateY(${dy}px)` : undefined }}
              aria-label={T.passes.term.ticketLabel}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onKeyDown={pressKeys(fire)}
              onClick={(e) => e.preventDefault()}
            >
              <b>{T.passes.term.ticket}</b>
              <em>× {n}</em>
            </button>
          )}
        </div>
      </div>
      <div className="t-hint" inert={held ? true : undefined}>
        {stage === "armed" && (
          <>
            {T.passes.term.pull}
            <i aria-hidden="true">↓</i>
            <button onClick={fire}>{T.passes.term.tap}</button>
          </>
        )}
        {stage === "flip" && (
          <>
            {T.passes.term.flip}
            {n > 1 && (
              <button className="t-open" onClick={openAll}>
                {T.passes.term.openAll}
              </button>
            )}
          </>
        )}
      </div>
      <div className={`t-sum${stage === "done" ? " on" : ""}`} inert={stage !== "done" || held ? true : undefined}>
        <div className="chipsx">
          {count("wish") > 0 && <span className="w">{fmt(T.passes.term.chips.wish, { n: count("wish") })}</span>}
          {count("new") > 0 && <span className="n">{fmt(T.passes.term.chips.new, { n: count("new") })}</span>}
          {count("up") > 0 && <span className="u">{fmt(T.passes.term.chips.up, { n: count("up") })}</span>}
          {count("dup") > 0 && <span className="d">{fmt(T.passes.term.chips.dup, { n: count("dup") })}</span>}
        </div>
        {bestChar && (
          <p>
            {T.passes.term.best}
            <b>
              {characterName(bestChar.name)} No.{padNo(best.no)}
              {tail}
            </b>
          </p>
        )}
        <div className="g-btns">
          <button data-keep onClick={onKeep}>
            {T.passes.term.keep}
          </button>
          <button className={`y${enough ? "" : " dim"}`} onClick={onAgain}>
            {n === 10 ? T.passes.term.againTen : T.passes.term.againOne}
            <small>{fmt(T.passes.cost, { n })}</small>
          </button>
        </div>
      </div>
      {held && <HeldUp d={held} at={at} art={art} holder={holder} done={stage === "done"} onClose={() => setHeld(null)} />}
    </div>
  );
}

/**
 * A pass held up whole (its big picture fetched now, not before): a wish as it turns over, on a rainbow, or any card
 * turned over already, when pressed. A tap (Enter, Space, Escape) puts it down, and the turning goes on.
 */
function HeldUp({ d, at, art, holder, done, onClose }: { d: Drawn; at: number; art: Art | null; holder: string; done: boolean; onClose: () => void }) {
  const c = passChar(d.charId);
  const [on, setOn] = useState(false);
  const self = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOn(true));
    self.current?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!c) return null;
  const t = T.passes.term;
  const wish = d.tier === "wish";
  return (
    <div
      ref={self}
      className={`t-hl${wish ? "" : " calm"}${on ? " on" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={done ? t.closeDone : t.closeHit}
      onClick={onClose}
      onKeyDown={pressKeys(onClose)}
    >
      <FullPass c={c} no={d.no} fancy={d.fancy} art={art} holder={holder} at={at} w={c.game === "ef" ? 196 : 164} />
      <p>
        <b>{wish ? (d.up ? t.wishHitUp : t.wishHit) : t.tier[d.tier]}</b>
        {characterName(c.name)} No.{padNo(d.no)}
      </p>
      <p className="sm">{done ? t.putDown : t.onward}</p>
    </div>
  );
}

/** The top of a screen on paper: its name, and ‹ back to 寻访 */
function DayTop({ title, extra, onBack }: { title: string; extra?: string; onBack: () => void }) {
  return (
    <div className="w-top">
      <button className="w-back" onClick={onBack} aria-label={T.passes.title}>
        ‹
      </button>
      <b>{title}</b>
      {extra && <span>{extra}</span>}
    </div>
  );
}

type WalletFilter = "all" | "ak" | "ef" | "wish";
type Owned = OwnedChar & { c: PassChar };

/**
 * 我的通行证: everyone the player has, the most copies first, each in their look with the number of their first, the
 * one worn marked; under them a bar with the pass worn and 摘下. A character pressed opens over the list (Detail);
 * Escape or ‹ back to it (stepBack), where the list was.
 */
function Wallet({
  st,
  art,
  holder,
  stepBack,
  onBack,
  onTook,
  onRefused,
}: {
  st: PassState;
  art: Art | null;
  holder: string;
  stepBack: { current: (() => void) | null };
  onBack: () => void;
  onTook: (s: PassState) => void;
  onRefused: (e: unknown) => void;
}) {
  const [coll, setColl] = useState<Collection | null>(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<WalletFilter>("all");
  const [open, setOpen] = useState<Owned | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let live = true;
    passesApi.collection().then(
      (c) => live && setColl(c),
      (e) => (mapsOwn(e) ? onRefused(e) : live && setErr(sayWhy(e))),
    );
    return () => {
      live = false;
    };
  }, [onRefused]);
  const close = () => {
    setOpen(null);
    // back on the character it opened from
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
  };
  stepBack.current = open ? close : null;
  useEffect(
    () => () => {
      stepBack.current = null;
    },
    [stepBack],
  );
  const items = useMemo(() => {
    if (!coll) return [];
    return coll.chars
      .map((o) => ({ ...o, c: passChar(o.charId) }))
      .filter((o): o is Owned => Boolean(o.c))
      .filter((o) => (filter === "all" ? true : filter === "wish" ? st.wish.includes(o.charId) : o.c.game === filter))
      .sort((a, b) => b.copies - a.copies || a.charId - b.charId);
  }, [coll, filter, st.wish]);
  const takeOff = async () => {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      onTook(await passesApi.wear(null));
      setMsg(T.passes.wallet.tookOff);
    } catch (e) {
      if (mapsOwn(e)) onRefused(e);
      else setMsg(sayWhy(e));
    } finally {
      setBusy(false);
    }
  };
  const filters: WalletFilter[] = ["all", "ak", "ef", "wish"];
  return (
    <>
      <div className="ps-day" inert={open ? true : undefined}>
        <DayTop title={T.passes.wallet.title} onBack={onBack} />
        {!coll ? (
          <p className="w-sub">{err || T.passes.wallet.loading}</p>
        ) : (
          <>
            <p className="w-sub">
              {fmt(T.passes.wallet.count, { have: coll.chars.length, all: CATALOG_SIZE, n: coll.passes })}
              <br />
              {T.passes.wallet.note}
            </p>
            <div className="w-chips" role="group">
              {filters.map((f) => (
                <button key={f} className={filter === f ? "on" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {T.passes.wallet[f]}
                </button>
              ))}
            </div>
            <div className="w-grid">
              {items.length ? (
                items.map((o) => {
                  const worn = st.worn?.charId === o.charId;
                  const name = characterName(o.c.name);
                  return (
                    <button
                      key={o.charId}
                      type="button"
                      className="wc"
                      aria-label={fmt(worn ? T.passes.wallet.openWorn : T.passes.wallet.open, { name, n: o.copies })}
                      onClick={(e) => {
                        opener.current = e.currentTarget;
                        setMsg("");
                        setOpen(o);
                      }}
                    >
                      {worn && <u aria-hidden="true">{T.passes.wallet.worn}</u>}
                      {o.copies > 1 && <em aria-hidden="true">×{o.copies}</em>}
                      <MiniPass c={o.c} no={o.no} fancy={isFancy(o.copies, st.plain.includes(o.charId))} art={art} />
                      <span aria-hidden="true">{name}</span>
                    </button>
                  );
                })
              ) : (
                <p className="w-none">{coll.chars.length ? T.passes.wallet.noneHere : T.passes.wallet.none}</p>
              )}
            </div>
          </>
        )}
        <p className="w-msg" role="status">
          {msg}
        </p>
        {st.worn && <WornBar worn={st.worn} busy={busy} onTakeOff={() => void takeOff()} />}
      </div>
      {open && <Detail o={open} st={st} art={art} holder={holder} onBack={close} onTook={onTook} onRefused={onRefused} />}
    </>
  );
}

/** The pass worn, on a bar under 我的通行证: which, its look, when drawn and 潜能 (from a second copy), and 摘下 */
function WornBar({ worn, busy, onTakeOff }: { worn: WornPass; busy: boolean; onTakeOff: () => void }) {
  const w = T.passes.wallet;
  return (
    <div className="w-bar">
      <div>
        <b>{fmt(w.wornBar, { name: characterName(worn.name), no: padNo(worn.no) })}</b>
        <small>
          {fmt(w.wornSub, { look: worn.fancy ? w.fancyLook : w.plainLook, date: issued(worn.drawnAt) })}
          {worn.copies >= 2 && fmt(w.potential, { n: worn.copies })}
        </small>
      </div>
      <button type="button" onClick={onTakeOff} disabled={busy}>
        {w.takeOff}
      </button>
    </div>
  );
}

/** ① ③ for the normal look of a character's pass, ② ④ for the special one */
const MARKS = { ak: ["①", "②"], ef: ["③", "④"] } as const;

/**
 * One character of 我的通行证, over the list: their whole pass, leaning after the pointer; 普通 or 镭射 (from a second
 * copy); which of their passes to wear, by number, when they have more than one; 戴上, or 摘下 for the one worn. It
 * opens on the pass worn, else their first; their passes come from the server, but a pass known already shows at once.
 */
function Detail({
  o,
  st,
  art,
  holder,
  onBack,
  onTook,
  onRefused,
}: {
  o: Owned;
  st: PassState;
  art: Art | null;
  holder: string;
  onBack: () => void;
  onTook: (s: PassState) => void;
  onRefused: (e: unknown) => void;
}) {
  const d = T.passes.detail;
  const [copies, setCopies] = useState<PassCopy[] | null>(null);
  const [pickId, setPickId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const self = useRef<HTMLDivElement>(null);
  useEffect(() => {
    self.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    let live = true;
    passesApi.copies(o.charId).then(
      (r) => live && setCopies(r.copies),
      (e) => (mapsOwn(e) ? onRefused(e) : live && setMsg(sayWhy(e))),
    );
    return () => {
      live = false;
    };
  }, [o.charId, onRefused]);

  const worn = st.worn?.charId === o.charId ? st.worn : null;
  // the pass shown: the one picked, else the one worn, else their first; its id null until their passes come
  const shown: { id: number | null; no: number; at: number } | null =
    copies?.find((p) => p.id === pickId) ??
    (worn ? { id: worn.passId, no: worn.no, at: worn.drawnAt } : null) ??
    copies?.[0] ??
    (o.copies === 1 ? { id: null, no: o.no, at: o.lastAt } : null);
  const n = copies?.length ?? o.copies;
  const plain = st.plain.includes(o.charId);
  const fancy = isFancy(n, plain);
  const isWorn = shown?.id != null && st.worn?.passId === shown.id;
  const name = characterName(o.c.name);
  const marks = MARKS[o.c.game];
  // as big as the screen leaves room for under and over it: a 通行认证 150 to 220 wide, a 长条挂牌 (as tall again
  // as wide, a little taller) from 184
  const room = (typeof window === "undefined" ? 0 : window.innerHeight) - 430;
  const ra = Math.min(220, Math.max(150, room / 1.61));
  const w = Math.round(o.c.game === "ef" ? Math.max(184, Math.min(ra * 1.23, room / 1.61)) : ra);

  const send = async (ask: () => Promise<PassState>, said: string) => {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      onTook(await ask());
      setMsg(said);
    } catch (e) {
      if (mapsOwn(e)) onRefused(e);
      else setMsg(sayWhy(e));
    } finally {
      setBusy(false);
    }
  };
  const look = (wantPlain: boolean) => {
    if (wantPlain !== plain) void send(() => passesApi.look(o.charId, wantPlain), "");
  };
  const wear = () => {
    if (shown?.id == null) return;
    const id = shown.id;
    void send(() => passesApi.wear(isWorn ? null : id), isWorn ? d.tookOff : d.worn);
  };

  return (
    <div ref={self} className="ps-day wd" role="group" aria-label={name} tabIndex={-1}>
      <div className="w-top">
        <button className="w-back" onClick={onBack} aria-label={d.backLabel}>
          ‹
        </button>
        <b>{name}</b>
        <span>{fmt(d.copies, { n })}</span>
      </div>
      <div className="wd-stage">
        {shown ? (
          <FullPass
            c={o.c}
            no={shown.no}
            fancy={fancy}
            art={art}
            holder={holder}
            at={shown.at}
            w={w}
            tilt
            label={fmt(T.passes.pass.label, { name, no: padNo(shown.no) })}
          />
        ) : (
          <p className="wd-wait">{d.loading}</p>
        )}
      </div>
      <div className="wd-seg" role="group" aria-label={d.look}>
        <button type="button" aria-pressed={!fancy} onClick={() => look(true)} disabled={busy}>
          {fmt(d.plain, { mark: marks[0] })}
        </button>
        <button type="button" aria-pressed={fancy} onClick={() => look(false)} disabled={busy || n < 2}>
          {fmt(d.fancy, { mark: marks[1] })}
        </button>
      </div>
      <p className="wd-note">{n < 2 ? d.needsTwo : fancy ? d.fancyOn : d.plainOn}</p>
      {copies && copies.length > 1 && (
        <div className="wd-which" role="group" aria-label={d.which}>
          <span aria-hidden="true">{d.which}</span>
          {copies.map((p) => {
            const on = st.worn?.passId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={on ? "worn" : ""}
                aria-pressed={p.id === shown?.id}
                aria-label={fmt(on ? d.pickWorn : d.pick, { no: padNo(p.no), date: issued(p.at) })}
                onClick={() => {
                  setMsg("");
                  setPickId(p.id);
                }}
              >
                {padNo(p.no)}
              </button>
            );
          })}
        </div>
      )}
      <div className="g-btns wd-btns">
        <button type="button" onClick={onBack}>
          {d.back}
        </button>
        <button type="button" className="y" onClick={wear} disabled={busy || shown?.id == null}>
          {isWorn ? d.takeOff : d.wear}
        </button>
      </div>
      <p className="wd-msg" role="status">
        {msg}
      </p>
    </div>
  );
}

type WishFilter = "all" | "ak" | "ef" | "fav";
const STARS = (r: number | null) => (r ? "★".repeat(r) : null);

/**
 * 改心愿单: the six places (✕ takes one off), and everyone who may go in them, by name, game or the player's 厨力.
 * Saved once a site day; the first list they fill does not count, and the count towards a sure wish stays.
 */
function WishEditor({
  st,
  art,
  favourites,
  onBack,
  onSaved,
  onRefused,
}: {
  st: PassState;
  art: Art | null;
  favourites: Record<Game, string[]>;
  onBack: () => void;
  onSaved: (s: PassState) => void;
  onRefused: (e: unknown) => void;
}) {
  const [draft, setDraft] = useState<number[]>(st.wish);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WishFilter>("all");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const open = st.wishOpen;
  const first = st.wish.length === 0;
  const favIds = useMemo(() => {
    const ids = new Set<number>();
    for (const game of ["arknights", "endfield"] as const) for (const name of favourites[game]) {
      const c = passCharNamed(game, name);
      if (c) ids.add(c.id);
    }
    return ids;
  }, [favourites]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PASS_CATALOG.filter(
      (c) =>
        (filter === "all" || (filter === "fav" ? favIds.has(c.id) : c.game === filter)) &&
        (!q || c.name.toLowerCase().includes(q) || nameMatches(c.name, q)),
    );
  }, [query, filter, favIds]);
  const ownedNames = st.wish
    .filter((id) => st.wishOwned.some((o) => o.charId === id))
    .map((id) => passChar(id)?.name)
    .filter((name): name is string => Boolean(name))
    .map(characterName)
    .join(T.passes.wish.and);
  const changed = draft.length !== st.wish.length || draft.some((id, i) => id !== st.wish[i]);
  const toggle = (id: number) => {
    setNote("");
    setDraft((d) => {
      if (d.includes(id)) return d.filter((x) => x !== id);
      if (d.length >= WISH_MAX) {
        setNote(T.passes.wish.full);
        return d;
      }
      return [...d, id];
    });
  };
  const save = async () => {
    if (!open || !changed || !draft.length || saving) return;
    setSaving(true);
    try {
      onSaved(await passesApi.wish(draft));
    } catch (e) {
      if (mapsOwn(e)) onRefused(e);
      else setNote(sayWhy(e));
    } finally {
      setSaving(false);
    }
  };
  const filters: WishFilter[] = ["all", "ak", "ef", "fav"];
  return (
    <div className="ps-day">
      <DayTop title={T.passes.wish.title} onBack={onBack} />
      <div className="wl-body">
        <div className="wl-slots">
          <WishSlots st={st} art={art} draft={draft} onRemove={open ? (id) => toggle(id) : undefined} />
        </div>
        <p className="wl-note">
          {!open ? T.passes.wish.locked : first ? T.passes.wish.first : T.passes.wish.open}
          {open && ownedNames && (
            <>
              <br />
              {fmt(T.passes.wish.owned, { names: ownedNames })}
            </>
          )}
        </p>
        {open && (
          <>
            <input
              className="wl-search"
              type="search"
              value={query}
              placeholder={T.passes.wish.search}
              aria-label={T.passes.wish.search}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="w-chips" role="group">
              {filters.map((f) => (
                <button key={f} className={filter === f ? "on" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {T.passes.wish[f]}
                </button>
              ))}
            </div>
            <div className="wl-list">
              {list.length ? (
                list.map((c) => {
                  const on = draft.includes(c.id);
                  return (
                    <div key={c.id} className="wl-row">
                      <MiniPass c={c} no={null} fancy={false} art={art} />
                      <span className="nm">
                        {characterName(c.name)}
                        <small>
                          {c.game === "ak" ? T.passes.wish.ak : T.passes.wish.ef} · {STARS(c.rarity) ?? T.passes.wish.story}
                        </small>
                      </span>
                      <button className={on ? "on" : ""} aria-pressed={on} onClick={() => toggle(c.id)}>
                        {on ? T.passes.wish.added : T.passes.wish.add}
                      </button>
                    </div>
                  );
                })
              ) : (
                <p className="w-none">{T.passes.wish.none}</p>
              )}
            </div>
          </>
        )}
      </div>
      {open && (
        <div className="wl-foot">
          <p className="wl-msg" role="status">
            {note}
          </p>
          <button className="wl-save" onClick={() => void save()} disabled={!changed || !draft.length || saving}>
            {T.passes.wish.save}
            <small>{first ? T.passes.wish.saveFirst : T.passes.wish.saveNote}</small>
          </button>
        </div>
      )}
    </div>
  );
}

/** 概率说明: the rules, from the same numbers the server draws by */
function Odds({ gifts, onBack }: { gifts: boolean; onBack: () => void }) {
  const counts = catalogCounts();
  const o = T.passes.odds;
  return (
    <div className="ps-day">
      <DayTop title={o.title} onBack={onBack} />
      <div className="od-body">
        <p>{fmt(o.pool, { n: CATALOG_SIZE, ak: counts.ak, ef: counts.ef })}</p>
        <p>{fmt(o.each, { n: CATALOG_SIZE, pct: (100 / CATALOG_SIZE).toFixed(2) })}</p>
        <p>{fmt(o.pity, { max: WISH_MAX, miss: PITY - 1, pity: PITY })}</p>
        <p>{o.wish}</p>
        <p>
          {fmt(o.tickets, { ...TASK_MAX, day: DAY_TICKETS, cap: TICKETS_CAP, welcome: WELCOME_TICKETS })}
        </p>
        {gifts && <p>{fmt(o.gifts, { n: GIFTS_IN_PER_DAY, cap: TICKETS_CAP })}</p>}
        <p>{o.numbers}</p>
        <p>{o.fancy}</p>
        <p>{o.fair}</p>
        <p className="ps-copy">{T.passes.copyright}</p>
      </div>
    </div>
  );
}

const two = (n: number) => String(n).padStart(2, "0");
const when = (at: number) => {
  const d = new Date(at);
  return fmt(T.passes.log.at, { m: d.getMonth() + 1, d: d.getDate(), time: `${two(d.getHours())}:${two(d.getMinutes())}` });
};

/** 寻访记录: every pass drawn, newest first, a page at a time */
function Log({ art, onBack, onRefused }: { art: Art | null; onBack: () => void; onRefused: (e: unknown) => void }) {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    passesApi.log().then(
      (p) => {
        if (!live.current) return;
        setRows(p.rows);
        setMore(p.more);
      },
      (e) => (mapsOwn(e) ? onRefused(e) : live.current && setErr(sayWhy(e))),
    );
    return () => {
      live.current = false;
    };
  }, [onRefused]);
  const next = async () => {
    if (!rows?.length || busy) return;
    setBusy(true);
    try {
      const p = await passesApi.log(rows[rows.length - 1].id);
      if (!live.current) return;
      setRows([...rows, ...p.rows]);
      setMore(p.more);
    } catch (e) {
      if (mapsOwn(e)) onRefused(e);
      else if (live.current) setErr(sayWhy(e));
    } finally {
      if (live.current) setBusy(false);
    }
  };
  return (
    <div className="ps-day">
      <DayTop title={T.passes.log.title} onBack={onBack} />
      {!rows ? (
        <p className="w-sub">{err || T.passes.wallet.loading}</p>
      ) : !rows.length ? (
        <p className="w-none">{T.passes.log.none}</p>
      ) : (
        <div className="lg-list">
          {rows.map((r) => {
            const c = passChar(r.charId);
            if (!c) return null;
            return (
              <div key={r.id} className="lg-row">
                <MiniPass c={c} no={null} fancy={false} art={art} />
                <span className="nm">
                  {characterName(c.name)} <span className="no">No.{padNo(r.no)}</span>
                  {r.wish && <em>{T.passes.log.wish}</em>}
                  <small>{when(r.at)}</small>
                </span>
              </div>
            );
          })}
          {err && <p className="w-none">{err}</p>}
          {more && (
            <button className="lg-more" onClick={() => void next()} disabled={busy}>
              {T.passes.log.more}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
