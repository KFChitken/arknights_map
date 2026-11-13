/**
 * 界面: which of the three layouts of the map page this device uses, remembered on this device only (like the map's
 * style, src/lib/mapStyle.ts), never by the account or the server. float 浮岛, the default: islands of glass over the
 * map, the sides able to fold away; drawer 抽屉: a bar at the top and a drawer at the bottom (a panel at the left on a
 * computer); hud 游戏风: laid out like a game's screen.
 *
 * Signed-in players are asked once on each device (UiPicker.tsx); visitors start on 浮岛 and can change it themselves.
 * Where nothing can be remembered (a private window), it is 浮岛, nobody is asked, and a fold lasts as long as the page.
 */
export type UiName = "float" | "drawer" | "hud";

export const UI_NAMES: readonly UiName[] = ["float", "drawer", "hud"];
export const DEFAULT_UI: UiName = "float";

/** Which sides are folded away, kept apart for each layout that folds (浮岛 both sides, 游戏风 its guides) */
export type UiFold = { float: { l: boolean; r: boolean }; hud: { r: boolean } };
export const UNFOLDED: UiFold = { float: { l: false, r: false }, hud: { r: false } };

const UI = "zhoup.ui";
/** This device answered the question once (picked one, or kept the default) */
const ASKED = "zhoup.uiAsked";
const FOLD = "zhoup.uiFold";

export const isUiName = (s: unknown): s is UiName => typeof s === "string" && (UI_NAMES as readonly string[]).includes(s);

function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/** The layout this device picked, or null if it never picked one */
export function storedUi(): UiName | null {
  const s = recall(UI);
  return isUiName(s) ? s : null;
}

export function saveUi(ui: UiName) {
  remember(UI, ui);
}

/** Whether this device can keep anything at all: a private window may throw, or forget at once */
export function uiStorable(): boolean {
  try {
    const probe = `${UI}.probe`;
    localStorage.setItem(probe, "1");
    const kept = localStorage.getItem(probe) === "1";
    localStorage.removeItem(probe);
    return kept;
  } catch {
    return false;
  }
}

/** Whether to ask this device which layout it wants: it never answered, never picked one, and could keep the answer */
export function shouldAskUi(): boolean {
  return recall(ASKED) !== "1" && storedUi() === null && uiStorable();
}

export function markUiAsked() {
  remember(ASKED, "1");
}

const yes = (v: unknown) => v === true;

/** What was kept of the folds, anything else unfolded */
export function parseFold(raw: string | null): UiFold {
  try {
    const v = JSON.parse(raw ?? "null") as { float?: { l?: unknown; r?: unknown }; hud?: { r?: unknown } } | null;
    if (!v || typeof v !== "object") return UNFOLDED;
    return { float: { l: yes(v.float?.l), r: yes(v.float?.r) }, hud: { r: yes(v.hud?.r) } };
  } catch {
    return UNFOLDED;
  }
}

export function loadFold(): UiFold {
  return parseFold(recall(FOLD));
}

export function saveFold(fold: UiFold) {
  remember(FOLD, JSON.stringify(fold));
}

/** The marks earlyUiScript puts on the page, taken off once the app has drawn what they stand for */
export const EARLY_UI_MARKS = ["data-ui-early", "data-fold-l", "data-fold-r"] as const;

/**
 * For the page's first paint, before the app starts (src/app/page.tsx): a layout other than 浮岛 hides 浮岛's buttons
 * until the app has drawn its own, and a side of 浮岛 folded away is folded already, so they do not show for a moment
 * and then change. choice: false when the server keeps everyone on 浮岛 (UI_CHOICE=off).
 */
export function earlyUiScript(choice: boolean) {
  const ui = choice ? `var u=localStorage.getItem(${JSON.stringify(UI)});if(u==="drawer"||u==="hud"){h.setAttribute("data-ui-early",u);return}` : "";
  const fold = `var f=JSON.parse(localStorage.getItem(${JSON.stringify(FOLD)})||"null");f=f&&f.float;if(f&&f.l===true)h.setAttribute("data-fold-l","");if(f&&f.r===true)h.setAttribute("data-fold-r","")`;
  return `(function(){try{var h=document.documentElement;${ui}${fold}}catch(e){}})()`;
}
