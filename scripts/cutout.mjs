// Cut a sticker-style character out of its white background and shrink it.
// usage: node cutout.mjs <in.png> <out.png> <size>
// Plain Node (zlib only): decodes 8-bit RGB/RGBA non-interlaced PNGs.
import fs from "node:fs";
import zlib from "node:zlib";

const [, , inPath, outPath, sizeArg] = process.argv;
const SIZE = Number(sizeArg || 256);

function decodePng(buf) {
  let p = 8;
  let w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit non-interlaced");
      ct = data[9];
    } else if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!ch) throw new Error("only RGB/RGBA");
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      out[o] = cur[x * ch];
      out[o + 1] = cur[x * ch + 1];
      out[o + 2] = cur[x * ch + 2];
      out[o + 3] = ch === 4 ? cur[x * ch + 3] : 255;
    }
    prev = cur;
  }
  return { w, h, px: out };
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const { w, h, px } = decodePng(fs.readFileSync(inPath));

// Background: light, colourless pixels reachable from the border (white, the
// sticker rim and the grey ground shadow). Inner whites are walled in by outlines.
const isBg = (i) => {
  const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mn >= 170 && mx - mn <= 30;
};
const bg = new Uint8Array(w * h);
const stack = [];
for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
while (stack.length) {
  const i = stack.pop();
  if (bg[i] || !isBg(i)) continue;
  bg[i] = 1;
  const x = i % w, y = (i / w) | 0;
  if (x > 0) stack.push(i - 1);
  if (x < w - 1) stack.push(i + 1);
  if (y > 0) stack.push(i - w);
  if (y < h - 1) stack.push(i + w);
}

// Alpha: 0 for background; soft edge for pixels touching it, by how white they are
const alpha = new Float32Array(w * h);
for (let i = 0; i < w * h; i++) {
  if (bg[i]) continue;
  const x = i % w, y = (i / w) | 0;
  const edge = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w]);
  if (!edge) {
    alpha[i] = 1;
    continue;
  }
  const mn = Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  alpha[i] = Math.max(0, Math.min(1, (255 - mn) / 110));
}

// Crop to the character, pad to a square with a small margin
let x0 = w, y0 = h, x1 = 0, y1 = 0;
for (let i = 0; i < w * h; i++) {
  if (alpha[i] <= 0) continue;
  const x = i % w, y = (i / w) | 0;
  if (x < x0) x0 = x;
  if (x > x1) x1 = x;
  if (y < y0) y0 = y;
  if (y > y1) y1 = y;
}
const side = Math.ceil(Math.max(x1 - x0 + 1, y1 - y0 + 1) * 1.02);
const ox = Math.round((x0 + x1 + 1) / 2 - side / 2);
// feet sit at the bottom of the square
const oy = y1 + 1 - side + Math.round(side * 0.01);

// Area-average resample (premultiplied) from the side×side window to SIZE×SIZE
const scale = side / SIZE;
const acc = new Float64Array(SIZE * SIZE * 4);
for (let ty = 0; ty < SIZE; ty++) {
  const sy0 = oy + ty * scale, sy1 = sy0 + scale;
  for (let tx = 0; tx < SIZE; tx++) {
    const sx0 = ox + tx * scale, sx1 = sx0 + scale;
    let r = 0, g = 0, b = 0, a = 0, area = 0;
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
      const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
      for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
        const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
        const wgt = wx * wy;
        area += wgt;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const i = sy * w + sx;
        const al = alpha[i] * wgt;
        r += px[i * 4] * al;
        g += px[i * 4 + 1] * al;
        b += px[i * 4 + 2] * al;
        a += al;
      }
    }
    const o = (ty * SIZE + tx) * 4;
    acc[o] = a ? r / a : 0;
    acc[o + 1] = a ? g / a : 0;
    acc[o + 2] = a ? b / a : 0;
    acc[o + 3] = area ? (a / area) * 255 : 0;
  }
}
const out = new Uint8Array(SIZE * SIZE * 4);
for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.max(0, Math.min(255, acc[i])));
fs.writeFileSync(outPath, encodePng(SIZE, SIZE, out));
console.log(`${outPath}: crop ${x1 - x0 + 1}x${y1 - y0 + 1} -> ${SIZE}px, ${fs.statSync(outPath).size} bytes`);
