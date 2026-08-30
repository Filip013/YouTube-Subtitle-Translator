/**
 * Generates PNG icons (16x16, 48x48, 128x128) using pure Node.js (zlib + raw PNG builder).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(size) {
  const width = size;
  const height = size;
  
  // RGBA buffer (height rows, each row has 1 filter byte (0) + width * 4 bytes)
  const rawData = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;

  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      // Normalized coordinates [0, 1]
      const nx = x / width;
      const ny = y / height;
      const dx = nx - 0.5;
      const dy = ny - 0.5;
      const distCenter = Math.sqrt(dx * dx + dy * dy);

      // Rounded rectangle badge background
      const cornerRadius = 0.22;
      const isInsideCard = Math.abs(dx) <= 0.45 && Math.abs(dy) <= 0.45;

      let r = 15, g = 23, b = 42, a = 0; // Default transparent

      if (distCenter <= 0.48) {
        // Vibrant gradient: Cyan (#38bdf8) to Violet (#818cf8)
        const t = (nx + ny) / 2;
        r = Math.round(56 * (1 - t) + 129 * t);
        g = Math.round(189 * (1 - t) + 140 * t);
        b = Math.round(248 * (1 - t) + 248 * t);
        a = 255;

        // Subtitle badge rectangle in center
        if (Math.abs(dx) <= 0.32 && dy >= -0.15 && dy <= 0.25) {
          // White subtitle bar / speech area
          r = 255;
          g = 255;
          b = 255;
          a = 255;

          // Inner subtitle text lines
          if (size >= 32) {
            const inLine1 = dy >= -0.08 && dy <= -0.02 && Math.abs(dx) <= 0.24;
            const inLine2 = dy >= 0.06 && dy <= 0.12 && Math.abs(dx) <= 0.18;
            if (inLine1 || inLine2) {
              r = 30;
              g = 41;
              b = 59;
            }
          }
        }

        // Sparkle / Star in top right
        const starDx = nx - 0.68;
        const starDy = ny - 0.30;
        const starDist = Math.abs(starDx) + Math.abs(starDy);
        if (starDist <= 0.12) {
          r = 255;
          g = 255;
          b = 255;
          a = 255;
        }
      }

      rawData[offset++] = r;
      rawData[offset++] = g;
      rawData[offset++] = b;
      rawData[offset++] = a;
    }
  }

  const compressedData = zlib.deflateSync(rawData);

  // PNG Header
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = createChunk('IHDR', ihdr);

  // IDAT chunk
  const idatChunk = createChunk('IDAT', compressedData);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);

  const crc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
  chunk.writeUInt32BE(crc >>> 0, 8 + len);
  return chunk;
}

// Standard CRC32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return c ^ 0xffffffff;
}

const iconsDir = path.join(__dirname);
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const png = createPNG(size);
  const filePath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated: ${filePath} (${png.length} bytes)`);
});
