// Types of scripts/msr-music.mjs, for its tests (src/lib/msrMusic.test.ts)

export type CatalogSong = {
  name: string;
  album: string;
  artists: string[];
  seconds: number;
  file: string;
  bytes: number;
  game: "arknights";
  added: string;
  /** Its smaller copy (scripts/make-lite-music.mjs), also in music/files/, and its bytes; neither before it is made */
  lite?: string;
  liteBytes?: number;
};
export type CatalogAlbum = { id: string; name: string; order: number; songs: string[] };
export type Catalog = { v: 1; updated: string | null; albums: CatalogAlbum[]; songs: Record<string, CatalogSong> };

/** An album as the site's list of albums gives it */
export type SiteAlbum = { cid: string; name: string; artistes?: string[] };
/** A song as the site's list of songs gives it */
export type SiteSong = { cid: string; name: string; albumCid: string; artists?: string[] };
/** An album's detail as the site gives it */
export type SiteAlbumDetail = { cid: string; name: string; belong?: string; songs?: { cid: string; name: string; artistes?: string[] }[] };

export const CATALOG_VERSION: 1;
export function isCid(id: unknown): id is string;
export function isFileName(name: unknown): name is string;
export function clean(s: unknown): string;
export function cleanList(list: unknown): string[];
export function isArknights(detail: { belong?: string } | null | undefined): boolean;
export function emptyCatalog(): Catalog;
export function readCatalog(text: string): Catalog;
export function albumsToCheck(siteAlbums: SiteAlbum[], siteSongs: SiteSong[] | null, catalog: Catalog, hasFile: (file: string) => boolean): string[];
export function songsToFetch(detail: SiteAlbumDetail, catalog: Catalog, hasFile: (file: string) => boolean): string[];
export function addSong(
  catalog: Catalog,
  cid: string,
  song: { name: string; album: string; artists: unknown; seconds: number; file: string; bytes: number },
  now?: Date,
): Catalog;
export function keepAlbum(catalog: Catalog, detail: SiteAlbumDetail): Catalog;
export function orderAlbums(catalog: Catalog, siteAlbums: SiteAlbum[]): Catalog;
export function totals(catalog: Catalog): { albums: number; songs: number; bytes: number; lite: number; liteBytes: number };
export function songsToLighten(catalog: Catalog, hasFile: (file: string) => boolean): string[];
export function addLite(catalog: Catalog, cid: string, lite: { file: string; bytes: number }): Catalog;
export function moovFirst(bytes: Uint8Array): boolean;
/** What ffprobe says of a file (-show_entries stream=codec_type,codec_name,profile,channels:format=duration -of json) */
export type Probe = {
  streams?: { codec_type?: string; codec_name?: string; profile?: string; channels?: number }[];
  format?: { duration?: string };
};
export function liteProblem(probe: Probe | null | undefined, seconds: number): string | null;
