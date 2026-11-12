"use client";

import { createContext, useContext } from "react";
import type { GateState } from "@/lib/adminConsole";
import type { CallOptions } from "./api";
import type { Hold } from "./held";

/** The 管理台's pages (管理员 and 禁放区 the owner's alone), and what a link may open on one: a case in 待处理, an account in 搜索账号 */
export type Page = "cases" | "accounts" | "log" | "site" | "admins" | "zones";
export const PAGES: readonly Page[] = ["cases", "accounts", "log", "site", "admins", "zones"];
export type Route = { page: Page; caseId?: string; account?: string };

export type OpenGate = Extract<GateState, { state: "open" }>;

/** What every page of the 管理台 reaches for: who is in, its endpoints, the bars at the bottom, and moving about */
export type Console = {
  gate: OpenGate;
  /** An endpoint: a shut door shows the door again, and a code sent along keeps the heaviest steps open a while */
  call: <T>(op: string, args?: unknown[], opts?: CallOptions) => Promise<T>;
  /** A line in the bar at the bottom, for a few seconds */
  say: (text: string) => void;
  /** A step held HOLD_SECONDS with 撤销 before it is sent (held.ts) */
  hold: (h: Hold) => void;
  go: (r: Route) => void;
  /** Whether the heaviest steps want a code now */
  needsFresh: () => boolean;
  /** 待处理's counts, for the menu */
  setCounts: (n: number | null) => void;
  /** Read 待处理's count for the menu again, after a step taken elsewhere settled cases there */
  recount: () => void;
  /** A line of the page's own beside its title's words (待处理's today, 管理员's count), or none */
  setLine: (line: string | null) => void;
};

export const ConsoleContext = createContext<Console | null>(null);

export function useConsole() {
  const c = useContext(ConsoleContext);
  if (!c) throw new Error("useConsole outside the 管理台");
  return c;
}
