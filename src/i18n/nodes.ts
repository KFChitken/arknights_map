import { createElement, Fragment, type ReactNode } from "react";
import { pieces, withCounts } from "./core";

/**
 * fmtParts (./core), for a sentence with elements in its blanks: a drop-down, a badge, a list of
 * lines. Each piece of the words and each value is a child of its own, as JSX text around {values}
 * was, so the page draws the same; a value React shows as nothing (false, null) shows as nothing.
 * An element cannot say what number it shows, so counts gives the number of each that a
 * {name|one|other} blank picks its form by ("{n} {n|Doctor|Doctors}" with n a <span>).
 */
export function fmtNodes(
  text: string,
  params: Readonly<Record<string, ReactNode>>,
  counts?: Readonly<Record<string, number | string>>,
): ReactNode {
  // as arguments, not an array: children in their places, which need no keys
  return createElement(Fragment, null, ...pieces<ReactNode, ReactNode>(counts ? withCounts(text, counts) : text, params, (v) => v));
}
