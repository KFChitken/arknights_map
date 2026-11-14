// What scripts/fetch-msr-music.mjs decides apart from the fetching itself, kept here so it can be tested
// (src/lib/msrMusic.test.ts): which albums of the Monster Siren Records site are taken, which of their songs are
// still to fetch, and the catalogue it leaves, music/catalog.json, which the site reads:
//
//   {
//     v: 1,
//     updated: "<ISO time of the run that wrote it>",
//     albums: [{ id: "<album cid>", name, order: 0, songs: ["<song cid>", …] }],      the site's order, newest first
//     songs: { "<song cid>": { name, album: "<album cid>", artists: [...], seconds: 158.27,
//                              file: "<16 hex>.m4a", bytes, game: "arknights", added: "<ISO time>" } }
//   }
//
// Nothing is ever taken out: a song or an album the site no longer lists stays, with its file, as rooms and
// declarations may still point at it. Albums the site no longer lists come after the others, in their old order.

export const CATALOG_VERSION = 1;

/** Ids as the site gives them (digits, mostly); anything else is not used, as it goes into paths and keys */
export const isCid = (id) => typeof id === "string" && /^[0-9A-Za-z_-]{1,32}$/.test(id);

/** A file the fetch made: the first 16 hex digits of its content's sha256 */
export const isFileName = (name) => typeof name === "string" && /^[0-9a-f]{16}\.m4a$/.test(name);

/** A name as shown, without the spaces some of the site's names have around them */
export const clean = (s) => (typeof s === "string" ? s.trim() : "");

/** A list of names (artists), each cleaned, the empty ones left out */
export const cleanList = (list) => (Array.isArray(list) ? list.map(clean).filter(Boolean) : []);

/** Whether an album's detail says it is Arknights' (belong), the only game taken for now */
export const isArknights = (detail) => detail?.belong === "arknights";

export const emptyCatalog = () => ({ v: CATALOG_VERSION, updated: null, albums: [], songs: {} });

/** A catalogue an earlier run left (its text); one it cannot read is an error, so nothing is lost by writing over it */
export function readCatalog(text) {
  const c = JSON.parse(text);
  if (!c || c.v !== CATALOG_VERSION || !Array.isArray(c.albums) || !c.songs || typeof c.songs !== "object") {
    throw new Error("music/catalog.json is not a catalogue this script knows (v1)");
  }
  return c;
}

/**
 * The albums whose detail must be asked for, in the site's order: those not in the catalogue yet (only the detail says
 * whether an album is Arknights'), and those of which the site's list of songs has one the catalogue lacks or whose
 * file is gone. Without that list (siteSongs null), every album is asked for.
 */
export function albumsToCheck(siteAlbums, siteSongs, catalog, hasFile) {
  const known = new Set(catalog.albums.map((a) => a.id));
  const missing = new Set();
  if (siteSongs) {
    for (const s of siteSongs) {
      const have = catalog.songs[s.cid];
      if (!have || !hasFile(have.file)) missing.add(s.albumCid);
    }
  }
  return siteAlbums.filter((a) => isCid(a.cid) && (!siteSongs || !known.has(a.cid) || missing.has(a.cid))).map((a) => a.cid);
}

/** The songs of an album's detail still to fetch, in its order: not in the catalogue, or their file is gone */
export function songsToFetch(detail, catalog, hasFile) {
  const songs = Array.isArray(detail?.songs) ? detail.songs : [];
  return songs.filter((s) => isCid(s.cid) && !(catalog.songs[s.cid] && hasFile(catalog.songs[s.cid].file))).map((s) => s.cid);
}

/**
 * One song fetched, into the catalogue: one fetched again (its file was gone) keeps the time it was first added.
 * song: { name, album, artists, seconds, file, bytes }
 */
export function addSong(catalog, cid, song, now = new Date()) {
  const before = catalog.songs[cid];
  catalog.songs[cid] = {
    name: clean(song.name),
    album: song.album,
    artists: cleanList(song.artists),
    seconds: Math.round(song.seconds * 100) / 100,
    file: song.file,
    bytes: song.bytes,
    game: "arknights",
    added: before?.added ?? now.toISOString(),
  };
  return catalog;
}

/**
 * An album as its detail lists it now, into the catalogue: its name and its songs in the detail's order, only those
 * the catalogue has (a song that failed to fetch is left out until a later run gets it); songs it listed before that
 * the detail no longer does stay, after the others.
 */
export function keepAlbum(catalog, detail) {
  const id = detail.cid;
  const listed = (Array.isArray(detail.songs) ? detail.songs : []).map((s) => s.cid).filter((cid) => catalog.songs[cid]);
  const old = catalog.albums.find((a) => a.id === id);
  const songs = [...new Set([...listed, ...(old?.songs ?? []).filter((cid) => catalog.songs[cid])])];
  if (old) {
    old.name = clean(detail.name) || old.name;
    old.songs = songs;
  } else if (songs.length) {
    catalog.albums.push({ id, name: clean(detail.name), order: catalog.albums.length, songs });
  }
  return catalog;
}

/**
 * The albums in the site's order (its list is newest first), with the names it gives them now; those it no longer
 * lists after them, in the order they had. order is then each one's place, from 0.
 */
export function orderAlbums(catalog, siteAlbums) {
  const place = new Map();
  const names = new Map();
  siteAlbums.forEach((a, i) => {
    if (!place.has(a.cid)) place.set(a.cid, i);
    names.set(a.cid, clean(a.name));
  });
  const rank = (a) => (place.has(a.id) ? place.get(a.id) : siteAlbums.length + a.order);
  catalog.albums.sort((x, y) => rank(x) - rank(y));
  catalog.albums.forEach((a, i) => {
    a.order = i;
    if (names.get(a.id)) a.name = names.get(a.id);
  });
  return catalog;
}

/** Albums, songs and their bytes in the catalogue */
export function totals(catalog) {
  const songs = Object.values(catalog.songs);
  return { albums: catalog.albums.length, songs: songs.length, bytes: songs.reduce((n, s) => n + (s.bytes || 0), 0) };
}
