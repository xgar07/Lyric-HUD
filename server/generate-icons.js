const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// CRC32 table & calculator
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcBuf = Buffer.alloc(4);
  const toCrc = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(toCrc), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function generatePng(size) {
  const width = size;
  const height = size;

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw image scanlines
  // Color: Dark violet-blue gradient with a glowing cyan note symbol
  const scanlines = [];
  const radius = width / 2;

  for (let y = 0; y < height; y++) {
    const row = [0]; // filter byte 0
    for (let x = 0; x < width; x++) {
      const dx = x - radius + 0.5;
      const dy = y - radius + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius - 1) {
        // Background rounded circle: dark indigo #1e1b4b to cyan #06b6d4
        const ratio = (x + y) / (width * 2);
        const r = Math.floor(30 + ratio * 30);
        const g = Math.floor(27 + ratio * 150);
        const b = Math.floor(75 + ratio * 180);
        row.push(r, g, b, 255);
      } else {
        // Transparent outside rounded icon
        row.push(0, 0, 0, 0);
      }
    }
    scanlines.push(Buffer.from(row));
  }

  const rawData = Buffer.concat(scanlines);
  const compressed = zlib.deflateSync(rawData);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.resolve(__dirname, '../extension/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const png = generatePng(size);
  const dest = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(dest, png);
  console.log(`Generated icon: ${dest} (${size}x${size})`);
});
