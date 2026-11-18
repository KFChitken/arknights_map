"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import { beijingDayWords } from "@/lib/beijing";
import { RELIABLE_AFTER_DAYS, REPORT_NOTE_MAX } from "@/lib/rules";
import { noteMissing, WRITING_REPORT_REASONS, type WritingReportReason } from "@/lib/safety";
import { BOARD, simplified, type BoardMine, type BoardPage, type DealState, type Passed, type RateState, type Sheet as Paper325, type Show } from "@/lib/study/board";
import { WRITE } from "@/lib/study/write325";
import { BoardPaused, StaleDeal, writingApi } from "@/lib/writingClient";
import { WorldError } from "@/lib/world/types";
import Sheet from "../Sheet";
import Paper from "./Paper";
import { mapsOwn, sayWhy } from "./refused";

/**
 * 徒手写's 手写榜 (src/lib/study/board.ts), opened from 325大学习's course list or from 下课's page after a round of
 * 徒手写: a page of the board, BOARD.page papers each with its place, its writer's name (or 匿名舟P), its score, how
 * many rated it and how many gave 799, and in its … a way to report it; 上一页 and 下一页. Under it, fixed, the player's
 * own paper with 撤下, and 去打分 or why they may not rate. Rating: one paper dealt at a time, never whose, rated 0 to
 * BOARD.max with the slider and − +, from BOARD.start every time; 交分 799 lights 325799 over it before the next comes
 * (with less motion, still, and for less long). A report blocks nobody. While the owner has paused the board, only the
 * player's own paper, to take it down. A refusal the map page answers itself (sign in, say again they are 18, agree to
 * the privacy policy) goes to onRefused, which closes this.
 */
export default function Board({
  signedIn,
  onUp,
  onClose,
  onRefused,
}: {
  signedIn: boolean;
  /** Back to where it was opened from */
  onUp: () => void;
  onClose: () => void;
  onRefused: (e: unknown) => void;
}) {
  const [view, setView] = useState<View>({ at: "list" });
  const [board, setBoard] = useState<BoardPage | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /** The page asked for, and whether another is on its way */
  const [page, setPage] = useState(1);
  const [turning, setTurning] = useState(false);
  /** Said over the board: the player's paper taken down, a report sent */
  const [said, setSaid] = useState("");
  /** The row whose … is open */
  const [menu, setMenu] = useState<string | null>(null);
  /** 撤下: asked whether they mean it, on its way, or what went wrong */
  const [asking, setAsking] = useState(false);
  const [withdrawing, setWithdrawing] = useState<"saving" | { why: string } | null>(null);

  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const refusedRef = useRef(onRefused);
  refusedRef.current = onRefused;
  const top = useRef<HTMLDivElement>(null);

  const load = useCallback((p: number) => {
    setFailed(null);
    setTurning(true);
    writingApi.board(p).then(
      (b) => {
        if (!live.current) return;
        setTurning(false);
        setBoard(b);
        if (!b.paused) setPage(b.page);
      },
      (e) => {
        if (!live.current) return;
        setTurning(false);
        if (mapsOwn(e)) return refusedRef.current(e);
        if (e instanceof BoardPaused) return setBoard((b) => ({ paused: true, mine: b?.mine ?? null }));
        setFailed(e instanceof WorldError && e.message !== T.requests.offline ? e.message : T.study.board.failed);
      },
    );
  }, []);
  useEffect(() => load(1), [load]);

  const turn = (p: number) => {
    setMenu(null);
    setSaid("");
    load(p);
    top.current?.closest(".sheet-body")?.scrollTo({ top: 0 });
  };

  const withdraw = () => {
    setWithdrawing("saving");
    writingApi.withdraw().then(
      () => {
        if (!live.current) return;
        setWithdrawing(null);
        setAsking(false);
        setSaid(T.study.board.withdrawn);
        load(page);
      },
      (e) => {
        if (!live.current) return;
        if (mapsOwn(e)) return refusedRef.current(e);
        setWithdrawing({ why: sayWhy(e) });
      },
    );
  };

  const back = (to: "list" | "rate") => {
    if (to === "rate") return startRating();
    setView({ at: "list" });
    load(page);
  };

  // ---- rating ----

  /** The paper dealt, and whether the player may rate on (null: on its way) */
  const [dealt, setDealt] = useState<DealState | null>(null);
  const [dealFailed, setDealFailed] = useState<string | null>(null);
  const [score, setScore] = useState(BOARD.start);
  const [busy, setBusy] = useState(false);
  /** Said under the buttons: the rating sent, the paper skipped (or what went wrong, err) */
  const [toast, setToast] = useState<{ text: string; err?: boolean } | null>(null);
  /** 325799, lit over the paper just rated 799 */
  const [lit, setLit] = useState(false);

  const deal = useCallback(() => {
    setDealFailed(null);
    writingApi.deal().then(
      (d) => {
        if (!live.current) return;
        setDealt(d);
        setScore(BOARD.start);
      },
      (e) => {
        if (!live.current) return;
        if (mapsOwn(e)) return refusedRef.current(e);
        setDealFailed(e instanceof BoardPaused ? T.study.board.paused : sayWhy(e));
      },
    );
  }, []);

  function startRating(note?: string) {
    setDealt(null);
    setToast(note ? { text: note } : null);
    setView({ at: "rate" });
    deal();
  }

  /** The next paper, as rating or skipping answered */
  const next = (d: DealState, text: string) => {
    setBusy(false);
    setLit(false);
    setDealt(d);
    setScore(BOARD.start);
    setToast({ text });
  };
  const refused = (e: unknown) => {
    if (!live.current) return;
    setBusy(false);
    setLit(false);
    if (mapsOwn(e)) return refusedRef.current(e);
    // another tab rated or skipped it, or it was hidden or taken down meanwhile: the one to rate now
    if (e instanceof StaleDeal) {
      setDealt(null);
      setToast({ text: T.study.board.rating.stale });
      return deal();
    }
    if (e instanceof BoardPaused) return setDealFailed(T.study.board.paused);
    setToast({ text: sayWhy(e), err: true });
  };

  const rate = () => {
    if (!dealt?.deal || busy) return;
    const r = T.study.board.rating;
    const v = score;
    const text = fmt(v === BOARD.meme ? r.sentMeme : v === BOARD.max ? r.sentFull : r.sent, { v });
    const meme = v === BOARD.meme;
    setBusy(true);
    setToast(meme ? { text } : null);
    setLit(meme);
    // 325799 stays lit a while, however soon the next paper comes
    const held = meme ? new Promise((done) => window.setTimeout(done, calm() ? MEME_CALM_MS : MEME_MS)) : null;
    Promise.all([writingApi.rate(dealt.deal.id, v), held]).then(([d]) => live.current && next(d, text), refused);
  };

  const skip = () => {
    if (!dealt?.deal || busy) return;
    setBusy(true);
    setToast(null);
    writingApi.skip(dealt.deal.id).then((d) => live.current && next(d, T.study.board.rating.skipped), refused);
  };

  const nudge = (by: number) => setScore((v) => Math.max(0, Math.min(BOARD.max, v + by)));

  // ---- reporting ----

  const report = async (paper: string, from: "list" | "rate", reason: WritingReportReason, note: string): Promise<string | null> => {
    try {
      await writingApi.report(paper, reason, note);
    } catch (e) {
      if (mapsOwn(e)) {
        refusedRef.current(e);
        return null;
      }
      return sayWhy(e);
    }
    if (!live.current) return null;
    const done = T.study.board.reported;
    // never dealt them again: the next one
    if (from === "rate") startRating(done);
    else {
      setSaid(done);
      setView({ at: "list" });
      load(page);
    }
    return null;
  };

  const b = T.study.board;

  if (view.at === "report") {
    const { paper, from } = view;
    return (
      <Sheet title={b.reportTitle} className="study" onUp={() => back(from)} onClose={onClose}>
        <ReportForm onSend={(reason, note) => report(paper, from, reason, note)} />
      </Sheet>
    );
  }

  if (view.at === "rate") {
    const r = b.rating;
    return (
      <Sheet title={r.title} className="study" onUp={() => back("list")} onClose={onClose}>
        {dealFailed ? (
          <div className="st-wait">
            <p>{dealFailed}</p>
            <button className="st-ghost" onClick={deal}>
              {T.study.retry}
            </button>
          </div>
        ) : !dealt ? (
          <div className="st-wait">
            {toast && <p className="wb-toast">{toast.text}</p>}
            <p>{r.loading}</p>
          </div>
        ) : !dealt.deal ? (
          <div className="wb-rest">
            {toast && <p className={toast.err ? "st-err" : "wb-toast"}>{toast.text}</p>}
            <p>{dealt.rate.can ? r.none : whyNot(dealt.rate)}</p>
            <button className="st-go wide" onClick={() => back("list")}>
              {r.back}
            </button>
          </div>
        ) : (
          <div className="wb-rate">
            <div className="wb-paper">
              <Paper key={dealt.deal.id} sheet={dealt.deal.sheet} label={r.paperSr} />
              {lit && (
                <div className="wb-meme" aria-hidden="true">
                  {[...MEME].map((d, k) => (
                    <i key={k} className={k < 3 ? `wb-m${d}` : "wb-mk"} style={{ "--k": k } as CSSProperties}>
                      {d}
                    </i>
                  ))}
                </div>
              )}
            </div>
            <div className="wb-num">
              <button className="wb-nudge" aria-label={r.less} disabled={busy || score <= 0} onClick={() => nudge(-1)}>
                −
              </button>
              <b>{score}</b>
              <span>{fmt(r.of, { max: BOARD.max })}</span>
              <button className="wb-nudge" aria-label={r.more} disabled={busy || score >= BOARD.max} onClick={() => nudge(1)}>
                +
              </button>
            </div>
            <input
              className="wb-slider"
              type="range"
              min={0}
              max={BOARD.max}
              step={1}
              value={score}
              disabled={busy}
              aria-label={fmt(r.slider, { max: BOARD.max })}
              onChange={(e) => setScore(Number(e.target.value))}
            />
            <div className="wb-ends" aria-hidden="true">
              <span>{r.bottom}</span>
              <span>{fmt(r.top, { max: BOARD.max })}</span>
            </div>
            <div className="wb-btns">
              <button className="st-go" disabled={busy} onClick={rate}>
                {r.go}
              </button>
              <button className="st-ghost" disabled={busy || (dealt.rate.can && dealt.rate.skipsLeft <= 0)} onClick={skip}>
                {r.skip}
              </button>
              <button
                className="st-ghost wb-warn"
                disabled={busy}
                onClick={() => dealt.deal && setView({ at: "report", paper: dealt.deal.id, from: "rate" })}
              >
                {r.report}
              </button>
            </div>
            <p className={toast?.err ? "st-err wb-said" : "wb-toast wb-said"} role="status">
              {toast?.text ?? ""}
            </p>
            {dealt.rate.can && <p className="wb-left">{fmt(r.left, { left: dealt.rate.left })}</p>}
            <p className="wb-mini">{fmt(r.rule, { n: BOARD.ratesPerDay })}</p>
          </div>
        )}
      </Sheet>
    );
  }

  const mine = board?.mine ?? null;
  const footer = board && (
    <div className="wb-foot">
      {mine && (
        <div className="wb-mine">
          {asking ? (
            <>
              <span>{b.withdrawAsk}</span>
              <span className="wb-mine-btns">
                <button className="wb-small wb-danger" disabled={withdrawing === "saving"} onClick={withdraw}>
                  {withdrawing === "saving" ? b.withdrawing : b.withdraw}
                </button>
                <button className="wb-small" disabled={withdrawing === "saving"} onClick={() => setAsking(false)}>
                  {b.withdrawNo}
                </button>
              </span>
            </>
          ) : (
            <>
              <span>{mineLine(mine)}</span>
              <button className="wb-small" onClick={() => setAsking(true)}>
                {b.withdraw}
              </button>
            </>
          )}
        </div>
      )}
      {withdrawing && withdrawing !== "saving" && <p className="st-err">{withdrawing.why}</p>}
      {!board.paused &&
        (board.rate.can ? (
          <button className="st-go wide" onClick={() => startRating()}>
            {fmt(b.rate, { left: board.rate.left })}
          </button>
        ) : (
          <p className="wb-why">{whyNot(board.rate)}</p>
        ))}
    </div>
  );

  return (
    <Sheet title={b.title} className="study" onUp={onUp} onClose={onClose} footer={footer || undefined}>
      <div ref={top} className="wb-list">
        {said && (
          <p className="st-note" role="status">
            {said}
          </p>
        )}
        {!board ? (
          <div className="st-wait">
            <p>{failed ?? b.loading}</p>
            {failed && (
              <button className="st-ghost" onClick={() => load(page)}>
                {T.study.retry}
              </button>
            )}
          </div>
        ) : board.paused ? (
          <p className="st-note">{b.paused}</p>
        ) : (
          <>
            {failed && <p className="st-err">{failed}</p>}
            {board.rows.length ? (
              <ol className="wb-board" aria-busy={turning || undefined}>
                {board.rows.map((row) => {
                  const own = mine?.id === row.id;
                  return (
                    <li key={row.id} className={own ? "wb-row wb-own" : "wb-row"}>
                      <span className="wb-rank">{row.rank}</span>
                      <span className="wb-who">
                        <Paper sheet={row.sheet} label={fmt(b.paperSr, { rank: row.rank })} />
                        <small>{row.name ?? T.lib.profile.anonymous}</small>
                      </span>
                      <span className="wb-score">
                        <b>{row.score}</b>
                        <small>{fmt(b.raters, { n: row.n })}</small>
                        {row.n799 > 0 && <small>{fmt(b.memes, { n: row.n799 })}</small>}
                      </span>
                      <span className="wb-menu">
                        {signedIn && !own && (
                          <>
                            <button className="wb-dots" aria-label={b.more} aria-expanded={menu === row.id} onClick={() => setMenu((m) => (m === row.id ? null : row.id))}>
                              …
                            </button>
                            {menu === row.id && (
                              <button
                                className="wb-report"
                                onClick={() => {
                                  setMenu(null);
                                  setView({ at: "report", paper: row.id, from: "list" });
                                }}
                              >
                                {b.report}
                              </button>
                            )}
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="wb-empty">{b.empty}</p>
            )}
            {board.pages > 1 && (
              <nav className="wb-pages">
                <button className="st-ghost" disabled={turning || page <= 1} onClick={() => turn(page - 1)}>
                  {b.prev}
                </button>
                <span>{fmt(b.pageOf, { page, pages: board.pages })}</span>
                <button className="st-ghost" disabled={turning || page >= board.pages} onClick={() => turn(page + 1)}>
                  {b.next}
                </button>
              </nav>
            )}
            <p className="wb-mini">{fmt(b.note, { n: BOARD.minRaters })}</p>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Where the board is: a page of it, rating a paper dealt, or reporting one (from either, and back there after) */
type View = { at: "list" } | { at: "rate" } | { at: "report"; paper: string; from: "list" | "rate" };

/** 325799 lit, tile by tile: 3, 2 and 5 in 节拍's colours, then 7, 9 and 9 dark */
const MEME = `325${BOARD.meme}`;
/** How long 325799 stays lit before the next paper (ms): with less motion, it comes on still and goes sooner */
const MEME_MS = 1900;
const MEME_CALM_MS = 1400;
const calm = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Why the player may not rate, in a line */
function whyNot(r: Exclude<RateState, { can: true }>): string {
  const w = T.study.board.why;
  if (r.why === "suspended") return fmt(w.suspended, { until: beijingDayWords(r.until) });
  return fmt(w[r.why], { pass: WRITE.pass, days: RELIABLE_AFTER_DAYS, n: BOARD.ratesPerDay });
}

/** The player's own paper, under the board: its place, not rated by enough yet, or hidden while reports wait */
function mineLine(m: BoardMine): string {
  const b = T.study.board;
  if (m.hidden) return b.mineHidden;
  if (m.rank === null) return fmt(b.mineWaiting, { min: BOARD.minRaters, n: m.n });
  return fmt(b.mine, { rank: m.rank, score: m.score, n: m.n }) + (m.n799 ? fmt(b.mineMemes, { n: m.n799 }) : "");
}

/** 举报这张字: a reason (别的 says what), and an optional note; onSend says what went wrong, if anything */
function ReportForm({ onSend }: { onSend: (reason: WritingReportReason, note: string) => Promise<string | null> }) {
  const [reason, setReason] = useState<WritingReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const missing = reason !== null && noteMissing(reason, note);
  const send = async () => {
    if (!reason || missing) return;
    setBusy(true);
    setErr(null);
    const why = await onSend(reason, note);
    setBusy(false);
    setErr(why);
  };
  return (
    <div className="wb-report-form">
      <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        {T.study.board.reportNote}
      </p>
      <div className="chips" role="radiogroup" aria-label={T.safety.reason} style={{ marginBottom: 10 }}>
        {(Object.keys(WRITING_REPORT_REASONS) as WritingReportReason[]).map((r) => (
          <button key={r} role="radio" aria-checked={reason === r} className={`chip ${reason === r ? "on" : ""}`} onClick={() => setReason(r)}>
            {WRITING_REPORT_REASONS[r]}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={note}
        maxLength={REPORT_NOTE_MAX}
        placeholder={reason === "writingOther" ? T.safety.noteAsk.otherReason : T.safety.notePlaceholder}
        aria-label={T.safety.noteLabel}
        onChange={(e) => setNote(e.target.value)}
      />
      {err && <p className="st-err">{err}</p>}
      <button className="primary wide" style={{ marginTop: 10 }} disabled={!reason || missing || busy} onClick={send}>
        {!reason ? T.safety.pickReason : missing ? T.safety.writeFirst : T.safety.report}
      </button>
    </div>
  );
}

/** 徒手写's paper just passed, by a player, as 下课's page has it: the server marking it again, and putting it up */
export type PaperUp = {
  /** The round's, so that what comes back for an earlier one is not taken for it */
  key: number;
  sheet: Paper325;
  pass: "sending" | Passed | { failed: string };
  put: null | "sending" | { mine: BoardMine | null } | { failed: string };
};

/**
 * 放上手写榜, on 下课's page after a round of 徒手写 passed by a player (方案页 ①): the paper as the board would keep
 * it, and three choices, 不放上去 first and chosen; either of the other two shows 放上去, and before it, if the player
 * has a paper up already, that this one takes its place and its ratings go with it. Put up: that it is, and the way to
 * the board. While the server has not marked it again, that it is on its way (or why not, with 再试一次); while the
 * board is paused, or the day's BOARD.publishesPerDay are used, why nothing can go up.
 */
export function PutUp({
  paper,
  onRetry,
  onPut,
  onBoard,
}: {
  paper: PaperUp;
  onRetry: () => void;
  onPut: (show: Show) => void;
  onBoard: () => void;
}) {
  const [show, setShow] = useState<Show | null>(null);
  const shown = useMemo(() => simplified(paper.sheet), [paper.sheet]);
  const p = T.study.board.put;
  const { pass, put } = paper;
  const choices: { v: Show | null; label: string; sub: string }[] = [
    { v: null, label: p.no, sub: p.noSub },
    { v: "anon", label: p.anon, sub: p.anonSub },
    { v: "named", label: p.named, sub: p.namedSub },
  ];

  let body;
  if (pass === "sending") body = <p className="wb-put-note">{p.checking}</p>;
  else if ("failed" in pass)
    body = (
      <p className="st-err">
        {fmt(p.failed, { why: pass.failed })}{" "}
        <button className="st-link" onClick={onRetry}>
          {p.retry}
        </button>
      </p>
    );
  else if (put && put !== "sending" && "mine" in put)
    body = (
      <>
        <p className="wb-put-done" role="status">
          {fmt(p.done, { n: BOARD.minRaters })}
        </p>
        <button className="st-ghost wide" onClick={onBoard}>
          {p.toBoard}
        </button>
      </>
    );
  else if (pass.paused) body = <p className="wb-put-note">{T.study.board.paused}</p>;
  else if (pass.publishesLeft <= 0) body = <p className="wb-put-note">{fmt(p.enough, { n: BOARD.publishesPerDay })}</p>;
  else
    body = (
      <>
        <div className="wb-choices" role="radiogroup" aria-label={p.title}>
          {choices.map((c) => (
            <label key={c.v ?? "no"} className={show === c.v ? "wb-choice wb-on" : "wb-choice"}>
              <input type="radio" name="wb-show" checked={show === c.v} disabled={put === "sending"} onChange={() => setShow(c.v)} />
              <span>
                {c.label}
                <small>{c.sub}</small>
              </span>
            </label>
          ))}
        </div>
        {show && (
          <>
            {pass.mine && <p className="wb-replace">{replaceLine(pass.mine)}</p>}
            <button className="st-go wide" disabled={put === "sending"} onClick={() => onPut(show)}>
              {put === "sending" ? p.going : p.go}
            </button>
          </>
        )}
        {put && put !== "sending" && "failed" in put && <p className="st-err">{fmt(p.failedPut, { why: put.failed })}</p>}
        <p className="wb-mini">{p.hint}</p>
      </>
    );

  return (
    <section className="wb-put" aria-label={p.title}>
      <Paper sheet={shown} label={p.paperSr} className="wb-put-paper" />
      {body}
    </section>
  );
}

/** Before a paper goes up in place of the player's last: what that one has */
function replaceLine(m: BoardMine): string {
  const p = T.study.board.put;
  if (m.hidden) return p.replaceHidden;
  if (m.rank === null) return fmt(p.replaceWaiting, { n: m.n });
  return fmt(p.replace, { rank: m.rank, score: m.score, n: m.n });
}
