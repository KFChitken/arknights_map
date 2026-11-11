// Make the app's icons from one square SVG (512x512, drawn to the edges):
//   public/icon-192.png, public/icon-512.png   the manifest's icons, opaque
//   public/icon-maskable-512.png               the picture at 80%, its edges continued outwards as in a mirror,
//                                              so what matters sits inside the middle circle Android may crop to
//   src/app/apple-icon.png                     180x180 for the iPhone home screen, opaque (iOS rounds the corners)
// The browser tab keeps src/app/icon.svg and favicon.ico: a map is too small to read at 16 or 32 pixels.
//
// usage: node scripts/make-icons.mjs <icon.svg>        (needs sharp, which Next.js installs)
import fs from "node:fs";
import sharp from "sharp";

const source = process.argv[2];
if (!source) throw new Error("usage: node scripts/make-icons.mjs <icon.svg>");
// what editors add, which no browser needs
const svg = Buffer.from(fs.readFileSync(source, "utf8").replace(/<metadata>[\s\S]*?<\/metadata>/g, ""));
const SAFE = 0.8;

const png = (size) => sharp(svg, { density: (72 * size) / 512 }).resize(size, size).flatten({ background: "#1b1d22" }).png({ compressionLevel: 9 });

const inner = Math.round(512 * SAFE);
const pad = (512 - inner) / 2;
const shrunk = await png(inner).toBuffer();

await png(192).toFile("public/icon-192.png");
await png(512).toFile("public/icon-512.png");
await sharp(shrunk)
  .extend({ top: Math.floor(pad), bottom: Math.ceil(pad), left: Math.floor(pad), right: Math.ceil(pad), extendWith: "mirror" })
  .png({ compressionLevel: 9 })
  .toFile("public/icon-maskable-512.png");
await png(180).toFile("src/app/apple-icon.png");
console.log("icons written from", source);
