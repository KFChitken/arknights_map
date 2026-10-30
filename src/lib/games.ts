export const GAMES = ["arknights", "endfield"] as const;
export type Game = (typeof GAMES)[number];

export const GAME_NAMES: Record<Game, string> = {
  arknights: "明日方舟",
  endfield: "终末地",
};

/**
 * Servers of each game that share neither accounts nor friend lists, so a UID only
 * means something with its server.
 */
export const SERVERS: Record<Game, { id: string; name: string }[]> = {
  arknights: [
    { id: "cn", name: "官服" },
    { id: "bili", name: "B服" },
    { id: "global", name: "国际服" },
    { id: "jp", name: "日服" },
    { id: "kr", name: "韩服" },
    { id: "tw", name: "繁中服" },
  ],
  endfield: [
    { id: "cn", name: "官服" },
    { id: "bili", name: "B服" },
    { id: "asia", name: "国际服·亚洲" },
    { id: "ameu", name: "国际服·美洲/欧洲" },
  ],
};

export const serverName = (game: Game, id: string | undefined) => SERVERS[game].find((s) => s.id === id)?.name;

export function isGame(v: unknown): v is Game {
  return v === "arknights" || v === "endfield";
}
