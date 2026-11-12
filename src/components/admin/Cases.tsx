"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BLOCKS_TO_REVIEW, BLOCKS_WINDOW_DAYS } from "@/lib/rules";
import {
  CASES_PER_PAGE,
  reasonWords,
  RULES,
  type AdminAction,
  type AdminAppeal,
  type AdminCase,
  type AnyReason,
  type CaseLevel,
  type CasePage,
  type RuleCode,
} from "@/lib/safety";
import type { BanRequestCard, DoneToday } from "@/lib/adminConsole";
import { beijingShort } from "@/lib/beijing";
import { ago } from "../app/InboxSheet";
import { errorWords } from "./api";
import BanBox, { BanRequestBox } from "./BanBox";
import { useConsole } from "./context";
import { Empty, Facts, LevelTag, Mark, Tag } from "./ui";
import {
  ACTION_WORDS,
  caseTitle,
  HELD_WORDS,
  joinedWords,
  personFacts,
  personTags,
  reporterWords,
  ruleWords,
  savedName,
  shownName,
  UNDO_WORDS,
  waitWords,
} from "./words";

/**
 * 待处理: the reports (each player's, and each reported roach's apart) and the appeals, the most pressing first, a
 * case opened beside the list with every way to settle it. A step waits 5 seconds for 撤销 before it is sent, and
 * the next case comes up meanwhile; keys for going through them quickly; several at once from the ticks. The owner
 * also has the bans moderators asked for, on top; a moderator asks for a ban where the owner would ban.
 */

type Settle = Exclude<AdminAction, "ban">;

const REASON_OPTIONS: [AnyReason | "blocks", string][] = [
  ["contact", "留了联系方式或个人信息"],
  ["minor", "可能未成年"],
  ["stalk", "一直贴着我的蟑螂放"],
  ["place", "蟑螂放在不合适的地方"],
  ["pattern", "好几只摆成字或图案"],
  ["impersonate", "冒充官方或别人"],
  ["spam", "骚扰刷屏"],
  ["name", "名字不合适"],
  ["other", "其他"],
  ["blocks", "被很多人拉黑"],
];

/** The keys of the queue, while typing nowhere: a ban only by its button and a code */
const KEYS: Record<string, Settle> = { d: "dismiss", n: "clearName", u: "clearUid", w: "warn", s: "suspend" };

const BATCH: { action: "dismiss" | "clearName" | "warn"; label: string; done: string }[] = [
  { action: "dismiss", label: "都没问题", done: "都标成没问题了" },
  { action: "clearName", label: "都清掉名字", done: "都清掉了名字" },
  { action: "warn", label: "都警告", done: "都警告了，各记一张黄牌" },
];

const SPOT_STATE = { here: "举报以后还在原地", moved: "举报以后挪过窝了", gone: "已经收回了" } as const;

const hasUid = (c: AdminCase) => c.games.some((g) => g.uid);

/** 「留了联系方式或个人信息 ×2」, or why a case without reports is one */
function reasonsOf(c: AdminCase) {
  if (!c.reports.length) return `${BLOCKS_WINDOW_DAYS} 天内被 ${c.blockedRecently} 个人拉黑（没人举报）`;
  const n = new Map<string, number>();
  for (const r of c.reports) n.set(reasonWords(r.reason), (n.get(reasonWords(r.reason)) ?? 0) + 1);
  return [...n].map(([reason, k]) => `${reason} ×${k}`).join("、");
}

/** 「2 人举报，都算可靠」 */
function reportersWords(c: AdminCase) {
  if (!c.reports.length) return "没有举报";
  const reliable = c.reporters === 1 ? (c.reliable ? "算可靠" : "不算可靠") : c.reliable === c.reporters ? "都算可靠" : `${c.reliable} 个可靠`;
  return `${c.reporters} 人举报，${reliable}`;
}

/** Of the 管理台's own people (only the owner sees cases about them), and the rest */
const staffTag = (p: { staff: AdminCase["staff"] }) => (p.staff === "owner" ? ["站长"] : p.staff === "mod" ? ["管理员"] : []);

function caseTags(c: AdminCase) {
  return [...staffTag(c), ...(c.kind === "roach" && c.anonymous ? ["主人现在是匿名"] : []), ...personTags(c, c.brigade)];
}

/**
 * The blue button: what such cases usually come to. Reporters none of whom count for the automatic steps: nothing
 * wrong; a roach: taken back; a name or one pretending: the name cleared; contact details: the UID (or the name);
 * maybe a minor: asked their age; the rest: a warning.
 */
function suggestOf(c: AdminCase): AdminAction {
  if (c.reports.length && c.reliable === 0) return "dismiss";
  if (c.kind === "roach") return c.roach?.state === "gone" ? "warn" : "removeRoach";
  if (!c.reports.length) return "warn";
  const n = new Map<AnyReason, number>();
  for (const r of c.reports) n.set(r.reason, (n.get(r.reason) ?? 0) + 1);
  const top = [...n].sort((a, b) => b[1] - a[1])[0][0];
  if ((top === "name" || top === "impersonate") && c.name) return "clearName";
  if (top === "contact") return hasUid(c) ? "clearUid" : c.name ? "clearName" : "warn";
  if (top === "minor" && !c.ageCheckAt) return "ageCheck";
  return "warn";
}

type Act = { action: Settle; label: string; kbd?: string; off?: boolean };

function actsOf(c: AdminCase): Act[] {
  if (c.kind === "roach") {
    const gone = c.roach?.state === "gone";
    return [
      { action: "dismiss", label: "没问题", kbd: "D" },
      { action: "warn", label: "警告（一张黄牌）", kbd: "W" },
      ...(gone ? [] : [{ action: "removeRoach" as const, label: c.roach?.main ? "收回本体（克隆体也一起收回，一张黄牌）" : "收回这只蟑螂（一张黄牌）" }]),
    ];
  }
  const uid = hasUid(c);
  return [
    { action: "dismiss", label: c.heldAt ? "没问题，恢复名字和 UID" : "没问题", kbd: "D" },
    ...(c.name ? [{ action: "clearName" as const, label: "清掉名字", kbd: "N" }] : []),
    ...(uid ? [{ action: "clearUid" as const, label: "清掉 UID", kbd: "U" }] : []),
    ...(c.name && uid ? [{ action: "clearBoth" as const, label: "名字和 UID 都清掉" }] : []),
    { action: "warn", label: "警告（一张黄牌）", kbd: "W" },
    { action: "suspend", label: ACTION_WORDS.suspend, kbd: "S" },
    { action: "ageCheck", label: "请 TA 确认年龄", off: Boolean(c.ageCheckAt) },
  ];
}

const heldText = (c: AdminCase, action: Settle) =>
  `${action === "removeRoach" && c.roach?.main ? "已收回这只和它的克隆体" : action === "dismiss" && c.reports.length ? `已标成没问题，关掉了 ${c.reports.length} 条举报` : HELD_WORDS[action]}：${caseTitle(c)}`;

/** The header's line: 「今天处理了 18 件：你 11 件，小林 7 件。」, a moderator only their own */
function todayLine(today: DoneToday[], owner: boolean) {
  const total = today.reduce((n, d) => n + d.n, 0);
  if (!owner || (today.length === 1 && today[0].you)) return `今天你处理了 ${total} 件。`;
  if (!total) return "今天还没处理过。";
  return `今天处理了 ${total} 件：${today.map((d) => `${d.you ? "你" : d.alias} ${d.n} 件`).join("，")}。`;
}

type Item = { id: string; kind: "case"; c: AdminCase } | { id: string; kind: "appeal"; a: AdminAppeal } | { id: string; kind: "request"; r: BanRequestCard };

const requestItem = (r: BanRequestCard): Item => ({ id: `request:${r.id}`, kind: "request", r });

export default function Cases({ start }: { start?: string }) {
  const { call, hold, say, go, setCounts, setLine, gate } = useConsole();
  const owner = gate.role === "owner";
  const [tab, setTab] = useState<"cases" | "appeals">("cases");
  const [level, setLevel] = useState<CaseLevel | "all">("all");
  const [reason, setReason] = useState<AnyReason | "blocks" | "all">("all");
  const [nameOnly, setNameOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CasePage | null>(null);
  const [appeals, setAppeals] = useState<AdminAppeal[] | null>(null);
  // the owner's: bans moderators asked for
  const [requests, setRequests] = useState<BanRequestCard[]>([]);
  // the case a link opened (from the map, or 搜索账号) when it is not on the page shown
  const [pinned, setPinned] = useState<AdminCase | null>(null);
  // acted on: held for 撤销, or sent
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(start ?? null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [rules, setRules] = useState<Record<string, RuleCode>>({});
  const [banOpen, setBanOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    async (auto: boolean) => {
      try {
        const [d, a, q] = await Promise.all([
          call<CasePage>("cases", [{ page, level, reason, nameOnly, auto }]),
          call<AdminAppeal[]>("appeals"),
          owner ? call<BanRequestCard[]>("banRequests") : Promise.resolve([]),
        ]);
        // the last cases of the last page settled: back to the page that is last now
        if (!d.cases.length && page > 1 && d.total > 0) {
          setPage(Math.max(1, Math.ceil(d.total / CASES_PER_PAGE)));
          return;
        }
        setData(d);
        setAppeals(a);
        setRequests(q);
        setNow(Date.now());
      } catch (e) {
        setNote(errorWords(e));
      }
    },
    [call, page, level, reason, nameOnly, owner],
  );
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(() => void loadRef.current(true), []);

  useEffect(() => {
    void load(false);
  }, [load]);

  // a link to one case: open it, from wherever it is in the queue; once read, the address forgets it
  const started = useRef(false);
  useEffect(() => {
    if (!start || !data || started.current) return;
    started.current = true;
    window.history.replaceState(null, "", "/admin");
    // a ban asked for (from 搜索账号) is on top already, or answered meanwhile
    if (start.startsWith("request:") || data.cases.some((c) => c.caseId === start)) return;
    call<CasePage>("cases", [{ caseId: start, auto: true }])
      .then((one) => {
        if (one.cases[0]) setPinned(one.cases[0]);
        else setNote("这件已经处理过了。");
      })
      .catch((e) => setNote(errorWords(e)));
  }, [start, data, call]);

  // the bans asked for go on top, among the red, on the first page
  const showRequests = page === 1 && (level === "all" || level === "red") && reason === "all" && !nameOnly;
  const items = useMemo<Item[]>(() => {
    if (tab === "appeals") return (appeals ?? []).map((a) => ({ id: a.actionId, kind: "appeal" as const, a }));
    const cases = data?.cases ?? [];
    const all = pinned && !cases.some((c) => c.caseId === pinned.caseId) ? [pinned, ...cases] : cases;
    return [...(showRequests ? requests.map(requestItem) : []), ...all.map((c) => ({ id: c.caseId, kind: "case" as const, c }))];
  }, [tab, data, appeals, pinned, requests, showRequests]);
  const list = useMemo(() => items.filter((x) => !hidden.has(x.id)), [items, hidden]);
  const current = list.find((x) => x.id === sel) ?? list[0] ?? null;

  // the counts, less what was just settled here (held for 撤销, or sent and not read back yet)
  const left = useMemo(() => {
    if (!data) return null;
    const levels = { ...data.levels };
    let nameOnly = data.nameOnly;
    const seen = new Set<string>();
    for (const c of pinned ? [pinned, ...data.cases] : data.cases) {
      if (!hidden.has(c.caseId) || seen.has(c.caseId)) continue;
      seen.add(c.caseId);
      levels[c.level] = Math.max(0, levels[c.level] - 1);
      if (c.kind === "person" && c.reports.length > 0 && c.reports.every((r) => r.reason === "name")) nameOnly = Math.max(0, nameOnly - 1);
    }
    return { levels, all: levels.red + levels.yellow + levels.green, nameOnly };
  }, [data, pinned, hidden]);
  const appealsLeft = (appeals ?? []).filter((a) => !hidden.has(a.actionId)).length;
  const requestsLeft = requests.filter((r) => !hidden.has(requestItem(r).id)).length;

  useEffect(() => {
    if (data?.today) setLine(todayLine(data.today, owner));
  }, [data, owner, setLine]);

  // the menu's count: what waits
  useEffect(() => {
    if (left && appeals) setCounts(left.all + requestsLeft + appealsLeft);
  }, [left, appeals, appealsLeft, requestsLeft, setCounts]);

  const unhide = useCallback((ids: string[]) => {
    setHidden((h) => {
      const next = new Set(h);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  /** Out of the list now, the next one up; back where it was if taken back */
  const settleOut = useCallback(
    (ids: string[]) => {
      const i = current ? list.findIndex((x) => x.id === current.id) : -1;
      const later = list.slice(i + 1).find((x) => !ids.includes(x.id));
      const rest = list.filter((x) => !ids.includes(x.id));
      setSel(later ? later.id : rest.length ? rest[rest.length - 1].id : null);
      setHidden((h) => new Set([...h, ...ids]));
      setChecked(new Set());
      setBanOpen(false);
    },
    [current, list],
  );

  const ruleFor = useCallback((c: AdminCase) => rules[c.caseId] ?? c.rule, [rules]);

  const act = useCallback(
    (c: AdminCase, action: Settle) => {
      const rule = ruleFor(c);
      settleOut([c.caseId]);
      hold({
        text: heldText(c, action),
        send: (keepalive) => call("resolve", [c.caseId, action, rule], { keepalive }),
        onUndo: () => {
          unhide([c.caseId]);
          setSel(c.caseId);
        },
        onDone: reload,
        onFail: (e) => {
          unhide([c.caseId]);
          say(`没做成：${errorWords(e)}`);
          reload();
        },
      });
    },
    [ruleFor, settleOut, hold, call, unhide, reload, say],
  );

  const batch = (b: (typeof BATCH)[number]) => {
    const ids = list.filter((x) => checked.has(x.id)).map((x) => x.id);
    if (!ids.length) return;
    settleOut(ids);
    hold({
      text: `${ids.length} 件${b.done}`,
      send: (keepalive) => call<number>("resolveMany", [ids, b.action], { keepalive }),
      onUndo: () => unhide(ids),
      onDone: reload,
      onFail: (e) => {
        unhide(ids);
        say(`没做成：${errorWords(e)}`);
        reload();
      },
    });
  };

  const answer = (a: AdminAppeal, keep: boolean) => {
    settleOut([a.actionId]);
    hold({
      text: `${keep ? "维持了原来的处理" : "撤销了这次处理"}：${shownName(a.who)}`,
      send: (keepalive) => call("answerAppeal", [a.actionId, keep], { keepalive }),
      onUndo: () => {
        unhide([a.actionId]);
        setSel(a.actionId);
      },
      onDone: reload,
      onFail: (e) => {
        unhide([a.actionId]);
        say(`没做成：${errorWords(e)}`);
        reload();
      },
    });
  };

  const ban = async (c: AdminCase, fresh: string) => {
    await call("resolve", [c.caseId, "ban", ruleFor(c)], { fresh: fresh || undefined });
    settleOut([c.caseId]);
    say(`封号了：${savedName(c)} 的账号和数据都删了，这个邮箱（连同它的其他写法）不能再登录。`);
    reload();
  };

  // a moderator's: handed over, so the account's cases leave their 待处理 until the owner answers
  const askBan = async (c: AdminCase, why: string) => {
    await call("banRequest", [{ id: c.targetId, rule: ruleFor(c), reason: why }]);
    settleOut(list.filter((x) => x.kind === "case" && x.c.targetId === c.targetId).map((x) => x.id));
    say(`${caseTitle(c)}：交给站长了，站长确认以后才会封。`);
    reload();
  };

  // the owner's answer to a ban asked for: confirmed with a code and done at once, or sent back (held for 撤销)
  const confirmRequest = async (r: BanRequestCard, fresh: string) => {
    await call("answerBanRequest", [{ id: r.id, ban: true }], { fresh: fresh || undefined });
    settleOut(list.filter((x) => x.id === requestItem(r).id || (x.kind === "case" && x.c.targetId === r.who.targetId)).map((x) => x.id));
    say(`封号了：${savedName(r.who)} 的账号和数据都删了，这个邮箱（连同它的其他写法）不能再登录。`);
    reload();
  };
  const declineRequest = (r: BanRequestCard) => {
    const id = requestItem(r).id;
    settleOut([id]);
    hold({
      text: `没有封，退回给了${r.by}：${shownName(r.who)}`,
      send: (keepalive) => call("answerBanRequest", [{ id: r.id, ban: false }], { keepalive }),
      onUndo: () => {
        unhide([id]);
        setSel(id);
      },
      onDone: reload,
      onFail: (e) => {
        unhide([id]);
        say(`没做成：${errorWords(e)}`);
        reload();
      },
    });
  };

  const blockName = async (c: AdminCase) => {
    try {
      await call("addNameWords", [`=${c.name}`]);
      say(`加好了：以后谁都不能叫「${c.name}」。要挡名字里的某个词，到「网站和工具」的名字黑名单里加。`);
    } catch (e) {
      say(errorWords(e));
    }
  };

  // j/k move, d n u w s settle the case open beside the list
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (e.metaKey || e.ctrlKey || e.altKey || banOpen || tab !== "cases") return;
    if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
    const i = current ? list.findIndex((x) => x.id === current.id) : -1;
    if (e.key === "j" && list.length) setSel(list[Math.min(i + 1, list.length - 1)].id);
    else if (e.key === "k" && list.length) setSel(list[Math.max(i - 1, 0)].id);
    else if (KEYS[e.key] && current?.kind === "case") {
      const a = actsOf(current.c).find((x) => x.action === KEYS[e.key]);
      if (!a || a.off) return;
      act(current.c, a.action);
    } else return;
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filter = (f: () => void) => {
    f();
    setPage(1);
    setChecked(new Set());
    setSel(null);
    setBanOpen(false);
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / CASES_PER_PAGE)) : 1;
  const checkedCount = list.filter((x) => checked.has(x.id)).length;

  return (
    <>
      {note && (
        <p className="ac-notice" role="status">
          {note}
          <button type="button" className="ac-link" onClick={() => setNote(null)}>
            知道了
          </button>
        </p>
      )}
      <div className="ac-filters">
        <div className="ac-seg" role="group" aria-label="举报还是申诉">
          <button type="button" aria-pressed={tab === "cases"} onClick={() => filter(() => setTab("cases"))}>
            举报 {left ? left.all + requestsLeft : "…"}
          </button>
          <button type="button" aria-pressed={tab === "appeals"} onClick={() => filter(() => setTab("appeals"))}>
            申诉 {appeals ? appealsLeft : "…"}
          </button>
        </div>
        {tab === "cases" && (
          <>
            <div className="ac-chips" role="group" aria-label="按轻重筛">
              {(["all", "red", "yellow", "green"] as const).map((l) => (
                <button key={l} type="button" className={`ac-chip level-${l}`} aria-pressed={level === l} onClick={() => filter(() => setLevel(l))}>
                  {l === "all" ? "全部" : l === "red" ? "红" : l === "yellow" ? "黄" : "绿"}{" "}
                  {left ? (l === "all" ? left.all + requestsLeft : l === "red" ? left.levels.red + requestsLeft : left.levels[l]) : ""}
                </button>
              ))}
            </div>
            <label className="ac-inline-label">
              理由
              <select value={reason} onChange={(e) => filter(() => setReason(e.target.value as AnyReason | "blocks" | "all"))}>
                <option value="all">全部</option>
                {REASON_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="ac-chip" aria-pressed={nameOnly} onClick={() => filter(() => setNameOnly((x) => !x))}>
              只看名字（快审）{left && left.nameOnly > 0 ? ` ${left.nameOnly}` : ""}
            </button>
          </>
        )}
      </div>

      <div className="ac-split">
        <section className="ac-panel ac-list" aria-label="要处理的">
          <div className="ac-list-head">
            <span>{tab === "cases" ? "急的在前，一样急的等得久的在前" : "每次处理只能申诉一次，先来的在前"}</span>
            <span>{list.length} 件</span>
          </div>
          {checkedCount > 0 && (
            <div className="ac-batch">
              <span>选了 {checkedCount} 件，一起：</span>
              {BATCH.map((b) => (
                <button key={b.action} type="button" className="ac-btn" onClick={() => batch(b)}>
                  {b.label}
                </button>
              ))}
              <button type="button" className="ac-btn" onClick={() => setChecked(new Set())}>
                取消选择
              </button>
            </div>
          )}
          <div className="ac-list-rows">
            {list.map((x) => {
              const on = current?.id === x.id;
              const canCheck = x.kind === "case" && x.c.kind === "person";
              return (
                <div key={x.id} className={`ac-row-item${on ? " on" : ""}`}>
                  {canCheck ? (
                    <input
                      type="checkbox"
                      checked={checked.has(x.id)}
                      aria-label={`选中 ${caseTitle(x.c)}`}
                      onChange={() =>
                        setChecked((s) => {
                          const next = new Set(s);
                          if (next.has(x.id)) next.delete(x.id);
                          else next.add(x.id);
                          return next;
                        })
                      }
                    />
                  ) : (
                    <span className="ac-check-space" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    className="ac-row-main"
                    aria-current={on || undefined}
                    onClick={() => {
                      setSel(x.id);
                      setBanOpen(false);
                    }}
                  >
                    {x.kind === "request" ? (
                      <>
                        <span className="ac-row-top">
                          <LevelTag level="red" />
                          <strong>{shownName(x.r.who)}</strong>
                          <span className="ac-muted">{waitWords(now - x.r.at)}</span>
                        </span>
                        <span className="ac-row-sub">{x.r.by}提请封号</span>
                        <span className="ac-row-meta">等你确认</span>
                      </>
                    ) : x.kind === "case" ? (
                      <>
                        <span className="ac-row-top">
                          <LevelTag level={x.c.level} />
                          <strong>{caseTitle(x.c)}</strong>
                          <span className="ac-muted">{waitWords(now - x.c.since)}</span>
                        </span>
                        <span className="ac-row-sub">{reasonsOf(x.c)}</span>
                        <span className="ac-row-meta">{reportersWords(x.c)}</span>
                        {caseTags(x.c).length > 0 && (
                          <span className="ac-row-tags">
                            {caseTags(x.c).map((t) => (
                              <Tag key={t}>{t}</Tag>
                            ))}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="ac-row-top">
                          <LevelTag level="appeal" />
                          <strong>{shownName(x.a.who)}</strong>
                          <span className="ac-muted">{waitWords(now - x.a.appealedAt)}</span>
                        </span>
                        <span className="ac-row-sub">申诉：{appealWhat(x.a)}</span>
                        <span className="ac-row-meta">{x.a.by === gate.alias ? "你" : x.a.by}处理的</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
            {(data || tab === "appeals") && list.length === 0 && <p className="ac-list-empty">这一栏没有了。</p>}
            {!data && tab === "cases" && <p className="ac-list-empty">正在读取…</p>}
          </div>
          {tab === "cases" && pages > 1 && (
            <div className="ac-pager">
              <button type="button" className="ac-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </button>
              <span className="ac-muted">
                第 {page} / {pages} 页，一共 {data?.total} 件
              </span>
              <button type="button" className="ac-btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                下一页
              </button>
            </div>
          )}
        </section>

        <section className="ac-panel ac-detail" aria-label="详情">
          {!current ? (
            <Empty done={Boolean(data)}>{data ? "这里都处理完了。" : "正在读取…"}</Empty>
          ) : current.kind === "request" ? (
            <RequestDetail
              key={current.id}
              r={current.r}
              banOpen={banOpen}
              onBanOpen={setBanOpen}
              onBan={(fresh) => confirmRequest(current.r, fresh)}
              onDecline={() => declineRequest(current.r)}
              onAccount={() => go({ page: "accounts", account: current.r.who.targetId })}
            />
          ) : current.kind === "case" ? (
            <CaseDetail
              key={current.id}
              c={current.c}
              owner={owner}
              rule={ruleFor(current.c)}
              onRule={(r) => setRules((m) => ({ ...m, [current.c.caseId]: r }))}
              onAct={(action) => act(current.c, action)}
              banOpen={banOpen}
              onBanOpen={setBanOpen}
              onBan={(fresh) => ban(current.c, fresh)}
              onAskBan={(why) => askBan(current.c, why)}
              onBlockName={() => blockName(current.c)}
              onAccount={() => go({ page: "accounts", account: current.c.targetId })}
            />
          ) : (
            <AppealDetail key={current.id} a={current.a} me={gate.alias} onAnswer={(keep) => answer(current.a, keep)} onAccount={() => go({ page: "accounts", account: current.a.who.targetId })} />
          )}
        </section>
      </div>
      <p className="ac-foot-hint">
        处理以后 TA 会在消息里收到站长通知，写明按哪条守则，可以申诉一次。被 {BLOCKS_WINDOW_DAYS} 天内 {BLOCKS_TO_REVIEW} 个不同的人拉黑也会进这里。
      </p>
    </>
  );
}

const appealWhat = (a: AdminAppeal) =>
  a.action === "removeRoach" ? (a.main ? "收回本体（克隆体也一起收回了）" : "收回一只克隆体") : ACTION_WORDS[a.action];

function PersonHead({
  name,
  heading,
  color,
  level,
  tags,
  id,
  email,
  joinedAt,
  last24,
  onAccount,
}: {
  name: string;
  heading: string;
  color: AdminCase["color"];
  level: CaseLevel | "appeal";
  tags: string[];
  id: string;
  email: string;
  joinedAt: number;
  last24: { touches: number; declarations: number };
  onAccount: () => void;
}) {
  return (
    <div className="ac-person-head">
      <Mark name={name} color={color} />
      <div className="ac-person-text">
        <div className="ac-person-title">
          <h2>{heading}</h2>
          <LevelTag level={level} />
          {tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
        <div className="ac-sub">
          {joinedWords(joinedAt)} · 账号 ID {id.slice(0, 8)} · 邮箱 {email || "（没有）"}
        </div>
        <div className="ac-sub">
          最近 24 小时：碰了 {last24.touches} 次，发了 {last24.declarations} 条宣言
        </div>
      </div>
      <button type="button" className="ac-btn" onClick={onAccount}>
        看完整资料和记录
      </button>
    </div>
  );
}

function CaseDetail({
  c,
  owner,
  rule,
  onRule,
  onAct,
  banOpen,
  onBanOpen,
  onBan,
  onAskBan,
  onBlockName,
  onAccount,
}: {
  c: AdminCase;
  owner: boolean;
  rule: RuleCode;
  onRule: (r: RuleCode) => void;
  onAct: (a: Settle) => void;
  banOpen: boolean;
  onBanOpen: (open: boolean) => void;
  onBan: (fresh: string) => Promise<void>;
  onAskBan: (why: string) => Promise<void>;
  onBlockName: () => void;
  onAccount: () => void;
}) {
  const roach = c.kind === "roach" ? c.roach : undefined;
  const suggest = suggestOf(c);
  const stalk = c.reports.find((r) => r.reason === "stalk");
  return (
    <div className="ac-stack">
      <PersonHead
        name={c.name}
        heading={roach ? `${roach.main ? "本体" : "一只克隆体"}（主人：${savedName(c)}）` : savedName(c)}
        color={c.color}
        level={c.level}
        tags={caseTags(c)}
        id={c.targetId}
        email={c.email}
        joinedAt={c.joinedAt}
        last24={c.last24h}
        onAccount={onAccount}
      />

      {roach && (
        <div className="ac-spot">
          <strong>
            {roach.main ? "本体" : "克隆体"}，{SPOT_STATE[roach.state]}
          </strong>
          <span>
            {stalk ? (stalk.nearM == null ? "举报时举报人还没放蟑螂。" : `举报时离举报人最近的一只蟑螂 ${stalk.nearM} 米。`) : ""}
            只显示被举报的这一只，主人的其他蟑螂在哪不显示。
          </span>
          <Link href={`/?case=${encodeURIComponent(c.caseId)}`}>在舟P地图上看它（跳过去，标出它现在和举报时的位置）</Link>
        </div>
      )}

      <div className="ac-act-box">
        <label className="ac-field">
          按哪条社区守则（TA 收到的站长通知会写这一条）
          <select value={rule} onChange={(e) => onRule(e.target.value as RuleCode)}>
            {(Object.keys(RULES) as RuleCode[]).map((r) => (
              <option key={r} value={r}>
                {RULES[r]}
              </option>
            ))}
          </select>
        </label>
        <div className="ac-acts">
          {actsOf(c).map((a) => (
            <button key={a.action} type="button" className={`ac-btn${a.action === suggest ? " primary" : ""}`} disabled={a.off} onClick={() => onAct(a.action)}>
              {a.label}
              {a.kbd && <kbd>{a.kbd}</kbd>}
            </button>
          ))}
          {c.kind === "person" && c.name && (
            <button type="button" className="ac-btn" onClick={onBlockName}>
              名字加进黑名单
            </button>
          )}
          <button type="button" className="ac-btn danger" onClick={() => onBanOpen(!banOpen)} aria-expanded={banOpen}>
            {owner ? "封号…" : "提请封号…"}
          </button>
        </div>
        <p className="ac-hint">
          蓝色的是建议的做法。处理完自动跳到下一件，几秒内能撤销。键盘：J / K 上下，D 没问题，N 清名字，U 清 UID，W 警告，S 暂停。
          {owner ? "封号只能点按钮。" : "封号要站长确认。"}
          {roach?.state === "moved" && " 它举报以后挪过窝了，收回的是它现在的位置。"}
        </p>
        {banOpen && (owner ? <BanBox onBan={onBan} onClose={() => onBanOpen(false)} /> : <BanRequestBox onAsk={onAskBan} onClose={() => onBanOpen(false)} />)}
      </div>

      <section aria-label="举报">
        <h3 className="ac-h3">{c.reports.length ? `举报 ${c.reports.length} 条` : "举报"}</h3>
        {c.reports.map((r, i) => (
          <div key={i} className="ac-report">
            <div className="ac-report-head">
              <strong>{reasonWords(r.reason)}</strong>
              <span className="ac-muted">{ago(r.at)}</span>
            </div>
            {r.note && <div>举报人写：「{r.note}」</div>}
            <div className="ac-report-context">
              {[r.context, `${roach ? "主人当时的名字" : "当时的名字"}：${r.name || "（没有名字）"}`].filter(Boolean).join(" · ")}
              {r.place && roach && (r.place.lng !== roach.lng || r.place.lat !== roach.lat) && " · 这次举报时它在别处"}
            </div>
            <div className="ac-muted small">{reporterWords(r.reporter)}</div>
          </div>
        ))}
        {!c.reports.length && (
          <p className="ac-report-none">
            没有人举报，是 {BLOCKS_WINDOW_DAYS} 天内被 {c.blockedRecently} 个人拉黑才进了这里。处理以后，再被拉黑 {BLOCKS_TO_REVIEW} 次才会再列出来。
          </p>
        )}
        <p className="ac-hint">不显示是谁举报的，只显示举报人以前举报得准不准。</p>
      </section>

      <section aria-label="TA 的资料">
        <h3 className="ac-h3">TA 的资料</h3>
        <Facts facts={personFacts(c, { declarations: !roach })} />
        <p className="ac-hint">这里不显示 TA 的蟑螂在哪、哪天来过。</p>
      </section>
    </div>
  );
}

function AppealDetail({ a, me, onAnswer, onAccount }: { a: AdminAppeal; me: string; onAnswer: (keep: boolean) => void; onAccount: () => void }) {
  return (
    <div className="ac-stack">
      <PersonHead
        name={a.who.name}
        heading={savedName(a.who)}
        color={a.who.color}
        level="appeal"
        tags={personTags(a.who)}
        id={a.who.targetId}
        email={a.who.email}
        joinedAt={a.who.joinedAt}
        last24={a.who.last24h}
        onAccount={onAccount}
      />
      <div className="ac-spot">
        <span>
          {beijingShort(a.at)} · {a.by === me ? "你" : a.by}处理的
        </span>
        <strong>{appealWhat(a)}</strong>
        <span>
          按「{ruleWords(a.rule)}」{a.action === "suspend" && a.until ? `，到 ${beijingShort(a.until)}` : ""}
        </span>
      </div>
      <div>
        <h3 className="ac-h3">TA 的申诉 · {beijingShort(a.appealedAt)}</h3>
        <p className="ac-appeal-text">「{a.appeal}」</p>
      </div>
      {a.mine ? (
        <p className="ac-paused">这件是你自己处理的，申诉要由站长或别的管理员来看。</p>
      ) : (
        <div className="ac-stack tight">
          <div className="ac-acts">
            <button type="button" className="ac-btn" onClick={() => onAnswer(true)}>
              维持原来的处理
            </button>
            <button type="button" className="ac-btn primary" onClick={() => onAnswer(false)}>
              撤销这次处理
            </button>
          </div>
          <p className="ac-hint">撤销以后：{UNDO_WORDS[a.action] ?? "恢复原样"}。每次处理只能申诉一次，你回复后 TA 会在消息里看到。</p>
        </div>
      )}
      <section aria-label="TA 的资料">
        <h3 className="ac-h3">TA 的资料</h3>
        <Facts facts={personFacts(a.who)} />
      </section>
    </div>
  );
}

/**
 * A ban a moderator asked for (the owner's): who asked, why and under which rule, and the account's info box;
 * 确认封号 with a code, or 不封 back to them (their 操作记录 says 「站长没同意」)
 */
function RequestDetail({
  r,
  banOpen,
  onBanOpen,
  onBan,
  onDecline,
  onAccount,
}: {
  r: BanRequestCard;
  banOpen: boolean;
  onBanOpen: (open: boolean) => void;
  onBan: (fresh: string) => Promise<void>;
  onDecline: () => void;
  onAccount: () => void;
}) {
  return (
    <div className="ac-stack">
      <PersonHead
        name={r.who.name}
        heading={savedName(r.who)}
        color={r.who.color}
        level="red"
        tags={[...staffTag(r.who), ...personTags(r.who)]}
        id={r.who.targetId}
        email={r.who.email}
        joinedAt={r.who.joinedAt}
        last24={r.who.last24h}
        onAccount={onAccount}
      />
      <div className="ac-ban">
        <span className="ac-request-by">
          {r.by} 提请封号 · {beijingShort(r.at)}
        </span>
        <p className="ac-request-why">「{r.reason}」</p>
        <span className="ac-request-by">按「{RULES[r.rule]}」</span>
        <div className="ac-row">
          <button type="button" className="ac-btn danger-solid" onClick={() => onBanOpen(!banOpen)} aria-expanded={banOpen}>
            确认封号…
          </button>
          <button type="button" className="ac-btn" onClick={onDecline}>
            不封，退回给{r.by}
          </button>
        </div>
        {banOpen && <BanBox onBan={onBan} onClose={() => onBanOpen(false)} />}
      </div>
      <section aria-label="TA 的资料">
        <h3 className="ac-h3">TA 的资料</h3>
        <Facts facts={personFacts(r.who, { declarations: true })} />
        <p className="ac-hint">举报和以前的处理在「看完整资料和记录」里。</p>
      </section>
    </div>
  );
}
