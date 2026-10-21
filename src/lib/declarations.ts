import { GAME_NAMES, type Game } from "./games";

/** A declaration is always one of a few fixed sentences with blanks picked from lists. */
export type Declaration =
  | { template: "launch"; game: Game }
  | { template: "iam"; character: string; title: string }
  | { template: "alsoplay"; game: Game };

export type Template = Declaration["template"];

export function declarationText(d: Declaration): string {
  switch (d.template) {
    case "launch":
      return `${GAME_NAMES[d.game]}，启动！`;
    case "iam":
      return `我是${d.character}的${d.title}`;
    case "alsoplay":
      return `原来，你也玩${GAME_NAMES[d.game]}`;
  }
}
