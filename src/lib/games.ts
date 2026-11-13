import { T } from "@/i18n";
export const GAMES = ["arknights", "endfield"] as const;
export type Game = (typeof GAMES)[number];

export const GAME_NAMES: Record<Game, string> = {
  get arknights() {
    return T.lib.games.names.arknights;
  },
  get endfield() {
    return T.lib.games.names.endfield;
  },
};

/**
 * Servers of each game that share neither accounts nor friend lists, so a UID only
 * means something with its server.
 */
export const SERVERS: Record<Game, { id: string; name: string }[]> = {
  arknights: [
    {
      id: "cn",
      get name() {
        return T.lib.games.servers.cn;
      },
    },
    {
      id: "bili",
      get name() {
        return T.lib.games.servers.bili;
      },
    },
    {
      id: "global",
      get name() {
        return T.lib.games.servers.global;
      },
    },
    {
      id: "jp",
      get name() {
        return T.lib.games.servers.jp;
      },
    },
    {
      id: "kr",
      get name() {
        return T.lib.games.servers.kr;
      },
    },
    {
      id: "tw",
      get name() {
        return T.lib.games.servers.tw;
      },
    },
  ],
  endfield: [
    {
      id: "cn",
      get name() {
        return T.lib.games.servers.cn;
      },
    },
    {
      id: "bili",
      get name() {
        return T.lib.games.servers.bili;
      },
    },
    {
      id: "asia",
      get name() {
        return T.lib.games.servers.asia;
      },
    },
    {
      id: "ameu",
      get name() {
        return T.lib.games.servers.ameu;
      },
    },
  ],
};

export const serverName = (game: Game, id: string | undefined) => SERVERS[game].find((s) => s.id === id)?.name;

/** The game a player is greeted as a player of: Endfield for those who play only Endfield, else Arknights (博士). */
export const homeGame = (games: Game[]): Game => (games.length === 1 && games[0] === "endfield" ? "endfield" : "arknights");

export function isGame(v: unknown): v is Game {
  return v === "arknights" || v === "endfield";
}
