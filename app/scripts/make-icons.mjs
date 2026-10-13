// Generate the PWA icons from the same shape as the favicon.
//
// A manifest with an empty `icons` array is not installable: Chrome wants at
// least a 192 and a 512, iOS wants an apple-touch-icon, and Android wants a
// maskable one or it will letterbox the art inside a white circle. The app had
// none of those, so "install to home screen" simply did not appear.
//
// Rasterised here rather than pulled from a design tool, because the shape is
// two rectangles and a rotation — small enough to compute exactly, which keeps
// the icons reproducible from the repository with no binary assets checked in
// and no image dependency to install.
//
// PNG is written by hand: signature, IHDR, IDAT (zlib-deflated scanlines),
// IEND. Node ships zlib and a CRC is four lines, so a library would be more
// code to audit than the format itself.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0x08, 0x09, 0x0a]; // near-black, matching the app background
const FG = [0x46, 0xe0, 0xa8]; // mint

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  // 10..12 = compression, filter, interlace — all zero

  // One filter byte per scanline (0 = None), then RGB triples.
  const raw = Buffer.alloc(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgb(x, y);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The icon: a mint diamond centred on the app's background.
 *
 * `padding` is the fraction of the canvas kept clear around the glyph. A
 * maskable icon is cropped to a circle by the launcher, so its art has to sit
 * inside roughly the middle 80% or the corners get shaved off.
 */
function icon(size, padding) {
  const c = size / 2;
  // Half-diagonal of the diamond, inside the safe area.
  const reach = c * (1 - padding);

  return (x, y) => {
    // A diamond is |dx| + |dy| <= reach — the rotated square, exactly.
    const dx = Math.abs(x + 0.5 - c);
    const dy = Math.abs(y + 0.5 - c);
    return dx + dy <= reach ? FG : BG;
  };
}

const OUT = new URL('../public/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const files = [
  ['icon-192.png', 192, 0.32],
  ['icon-512.png', 512, 0.32],
  // More padding: the launcher's circular mask eats the corners.
  ['icon-maskable-512.png', 512, 0.42],
  // iOS ignores the manifest and uses this one.
  ['apple-touch-icon.png', 180, 0.32],
];

for (const [name, size, padding] of files) {
  const buf = png(size, size, icon(size, padding));
  writeFileSync(new URL(name, OUT), buf);
  console.log(`${name.padEnd(26)} ${size}x${size}  ${buf.length} bytes`);
}
