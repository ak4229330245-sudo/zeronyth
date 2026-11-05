// Generate the PWA icons (icon-192.png, icon-512.png) — a gold diamond
// shield glyph on the app background — with a hand-rolled PNG encoder
// (no image dependencies). Run once: `node tools/gen-icons.mjs`.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
      raw[p++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [13, 17, 23, 255]; // #0d1117
const GOLD = [210, 153, 34, 255]; // #d29922
const GOLD_HI = [240, 185, 60, 255];

// Diamond (rotated square) centred at (0.5, 0.52), radius 0.30, with a
// lighter facet above the horizontal midline.
function pixel(u, v) {
  const d = Math.abs(u - 0.5) + Math.abs(v - 0.52);
  if (d < 0.30) return v < 0.52 ? GOLD_HI : GOLD;
  if (d < 0.335) return [140, 100, 20, 255];
  return BG;
}

for (const size of [192, 512]) {
  const file = new URL(`../icon-${size}.png`, import.meta.url);
  writeFileSync(file, png(size, pixel));
  console.log('wrote', file.pathname);
}
