import { createElement, Fragment, type ReactNode } from "react";

/**
 * fmtParts (./core), for a sentence with elements in its blanks: a drop-down, a badge, a list of
 * lines. Each piece of the words and each value is a child of its own, as JSX text around {values}
 * was, so the page draws the same; a value React shows as nothing (false, null) shows as nothing.
 */
export function fmtNodes(text: string, params: Readonly<Record<string, ReactNode>>): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(/\{([^{}]+)\}/g)) {
    if (!Object.hasOwn(params, m[1])) continue;
    out.push(text.slice(at, m.index), params[m[1]]);
    at = m.index + m[0].length;
  }
  out.push(text.slice(at));
  // as arguments, not an array: children in their places, which need no keys
  return createElement(Fragment, null, ...out.filter((p) => p !== ""));
}
