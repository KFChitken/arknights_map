import type { Game } from "./games";

/**
 * Self-titles for 「我是<角色>的<称呼>」, most used first (from a survey of
 * player nicknames). A title with a game only fits that game's characters:
 * Arknights players are 博士, Endfield players are 管理员.
 */
export const SELF_TITLES: { title: string; game?: Game }[] = [
  { title: "狗" },
  { title: "佩洛" },
  { title: "博士", game: "arknights" },
  { title: "管理员", game: "endfield" },
  { title: "小狗" },
  { title: "刀客塔", game: "arknights" },
  { title: "修勾" },
  { title: "忠犬" },
  { title: "猫" },
  { title: "老公" },
  { title: "老婆" },
  { title: "屑博士", game: "arknights" },
];

export function titlesFor(game: Game) {
  return SELF_TITLES.filter((t) => !t.game || t.game === game).map((t) => t.title);
}
