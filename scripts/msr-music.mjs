// What scripts/fetch-msr-music.mjs decides apart from the fetching itself, kept here so it can be tested
// (src/lib/msrMusic.test.ts): which albums of the Monster Siren Records site are taken, which of their songs are
// still to fetch, and the catalogue it leaves, music/catalog.json, which the site reads:
//
//   {
//     v: 1,
//     updated: "<ISO time of the run that wrote it>",
//     albums: [{ id: "<album cid>", name, order: 0, songs: ["<song cid>", …],         the site's order, newest first
//                cover: "<16 hex>.jpg" }],
//     songs: { "<song cid>": { name, album: "<album cid>", artists: [...], seconds: 158.27,
//                              file: "<16 hex>.m4a", bytes, game: "arknights", added: "<ISO time>",
//                              lite: "<16 hex>.m4a", liteBytes } }
//   }
//
// lite is the song's smaller copy (省流量, 48 kbps AAC-LC) that scripts/make-lite-music.mjs makes of its file, also in
// music/files/; a song without one yet has neither. A song fetched again (its file was gone) loses it until the
// next run makes it again. cover is the album's cover (300×300 JPEG) that scripts/fetch-msr-covers.mjs makes of the
// site's, also in music/files/; an album without one yet has none.
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

/**
 * Albums, songs and their bytes in the catalogue; lite: how many have a smaller copy, liteBytes: theirs; covers: how
 * many albums have their cover
 */
export function totals(catalog) {
  const songs = Object.values(catalog.songs);
  const lite = songs.filter((s) => s.lite);
  return {
    albums: catalog.albums.length,
    songs: songs.length,
    bytes: songs.reduce((n, s) => n + (s.bytes || 0), 0),
    lite: lite.length,
    liteBytes: lite.reduce((n, s) => n + (s.liteBytes || 0), 0),
    covers: catalog.albums.filter((a) => a.cover).length,
  };
}

// ---- 省流量: each song's smaller copy (scripts/make-lite-music.mjs) ----

/** The songs to make a smaller copy of, in the catalogue's order: their file is there, and they have no copy, or it is gone */
export function songsToLighten(catalog, hasFile) {
  const order = catalog.albums.flatMap((a) => a.songs);
  const all = [...new Set([...order, ...Object.keys(catalog.songs)])];
  return all.filter((cid) => {
    const s = catalog.songs[cid];
    return s && hasFile(s.file) && !(s.lite && hasFile(s.lite));
  });
}

/** A song's smaller copy, into the catalogue: lite: { file, bytes } */
export function addLite(catalog, cid, lite) {
  const s = catalog.songs[cid];
  if (!s) throw new Error(`no song ${cid} in the catalogue`);
  s.lite = lite.file;
  s.liteBytes = lite.bytes;
  return catalog;
}

/**
 * Whether an .m4a's moov box comes before its mdat, so a browser can start playing before the rest has come (its
 * bytes, or as many of the first as hold its top-level boxes' headers)
 */
export function moovFirst(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 0; at + 8 <= bytes.length; ) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (type === "moov") return true;
    if (type === "mdat") return false;
    if (size === 1) {
      if (at + 16 > bytes.length) return false;
      size = Number(view.getBigUint64(at + 8));
    }
    if (size < 8) return false;
    at += size;
  }
  return false;
}

/**
 * Why an encoded copy will not do, from what ffprobe says of it (-show_entries stream=codec_type,codec_name,
 * profile,channels:format=duration -of json), for a song of `seconds`; null: it will
 */
export function liteProblem(probe, seconds) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const audio = streams.filter((s) => s.codec_type === "audio");
  if (audio.length !== 1 || streams.length !== 1) return `${streams.length} streams, ${audio.length} of them audio`;
  const a = audio[0];
  if (a.codec_name !== "aac" || a.profile !== "LC") return `${a.codec_name} ${a.profile}, not AAC-LC`;
  if (Number(a.channels) !== 2) return `${a.channels} channels`;
  const d = Number(probe?.format?.duration);
  if (!(Math.abs(d - seconds) <= 1)) return `${d} s long, the song ${seconds} s`;
  return null;
}

// ---- each album's cover (scripts/fetch-msr-covers.mjs) ----

/** A cover as the covers script stores it: 300×300 JPEG, named by the first 16 hex digits of its content's sha256 */
export const COVER_SIZE = 300;
export const isCoverName = (name) => typeof name === "string" && /^[0-9a-f]{16}\.jpg$/.test(name);

/** The site's own hosts, the only ones a cover is downloaded from */
const SITE_HOSTS = /(^|\.)(hycdn\.cn|hypergryph\.com)$/;

/** The albums to get the cover of, in the catalogue's order: they have none, or its file is gone */
export function albumsToCover(catalog, hasFile) {
  return catalog.albums.filter((a) => isCid(a.id) && !(isCoverName(a.cover) && hasFile(a.cover))).map((a) => a.id);
}

/** An album's cover link as the site gives it (in its list of albums, or the album's detail): https on its own hosts, or null */
export function coverSource(entry) {
  try {
    const url = new URL(entry?.coverUrl ?? "");
    return url.protocol === "https:" && SITE_HOSTS.test(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

/** An album's cover, into the catalogue (the fetch keeps it as it is: scripts/fetch-msr-music.mjs) */
export function addCover(catalog, id, file) {
  const a = catalog.albums.find((x) => x.id === id);
  if (!a) throw new Error(`no album ${id} in the catalogue`);
  a.cover = file;
  return catalog;
}

/**
 * What sort of picture bytes are, by how they start: the one ffmpeg demuxer the covers script lets read them, so a file
 * of another kind (a playlist, say, that would have ffmpeg open other files) is never opened as one; null: none of those
 */
export function pictureKind(bytes) {
  const at = (from, ...want) => want.every((b, i) => bytes[from + i] === b);
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg_pipe";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png_pipe";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp_pipe";
  return null;
}

/** Why a made cover will not do, from what ffprobe says of it (-show_entries stream=codec_type,codec_name,width,height -of json); null: it will */
export function coverProblem(probe) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  if (streams.length !== 1 || streams[0].codec_type !== "video") return `${streams.length} streams, not one picture`;
  const p = streams[0];
  if (p.codec_name !== "mjpeg") return `${p.codec_name}, not JPEG`;
  if (Number(p.width) !== COVER_SIZE || Number(p.height) !== COVER_SIZE) return `${p.width}×${p.height}, not ${COVER_SIZE}×${COVER_SIZE}`;
  return null;
}
