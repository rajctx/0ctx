#!/usr/bin/env node
/**
 * Generate placeholder PNG icons for Tauri from the SVG source.
 * 
 * Requires no external deps — writes minimal valid PNG files.
 * For production, replace with properly rendered PNGs from the SVG.
 * 
 * Usage: node generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = (() => {
  // Minimal PNG generation without canvas dependency
  // Creates a simple solid-color PNG with "0" text approximation
  return {
    createCanvas: null // Will use raw PNG generation below
  };
})();

// Minimal PNG encoder — creates a solid icon placeholder
function createMinimalPng(size) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); // Length
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(size, 8);  // Width
  ihdr.writeUInt32BE(size, 12); // Height
  ihdr.writeUInt8(8, 16);  // Bit depth
  ihdr.writeUInt8(2, 17);  // Color type (RGB)
  ihdr.writeUInt8(0, 18);  // Compression
  ihdr.writeUInt8(0, 19);  // Filter
  ihdr.writeUInt8(0, 20);  // Interlace
  
  // Calculate CRC for IHDR
  const ihdrCrc = crc32(ihdr.subarray(4, 21));
  ihdr.writeInt32BE(ihdrCrc, 21);
  
  // Generate image data — dark circle with "0"
  const raw = Buffer.alloc(size * (size * 3 + 1)); // +1 for filter byte per row
  const cx = size / 2, cy = size / 2, r = size * 0.47;
  
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0; // No filter
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 3;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= r) {
        // Inside circle — dark blue #1a1a2e
        raw[px] = 0x1a;
        raw[px + 1] = 0x1a;
        raw[px + 2] = 0x2e;
      } else if (dist <= r + size * 0.03) {
        // Border — light gray #e2e8f0
        raw[px] = 0xe2;
        raw[px + 1] = 0xe8;
        raw[px + 2] = 0xf0;
      } else {
        // Transparent (white for RGB)
        raw[px] = 0xff;
        raw[px + 1] = 0xff;
        raw[px + 2] = 0xff;
      }
    }
  }
  
  // Compress with zlib (deflate)
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(raw);
  
  // IDAT chunk
  const idatLen = Buffer.alloc(4);
  idatLen.writeUInt32BE(compressed.length);
  const idatType = Buffer.from('IDAT');
  const idatCrcData = Buffer.concat([idatType, compressed]);
  const idatCrc = Buffer.alloc(4);
  idatCrc.writeInt32BE(crc32(idatCrcData));
  
  // IEND chunk
  const iend = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 0xAE, 0x42, 0x60, 0x82]);
  
  return Buffer.concat([signature, ihdr, idatLen, idatCrcData, idatCrc, iend]);
}

// CRC-32 lookup table
const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) | 0;
}

// Generate icons
const sizes = [32, 128, 256];
const dir = __dirname;

for (const size of sizes) {
  const png = createMinimalPng(size);
  const name = size === 256 ? '128x128@2x.png' : `${size}x${size}.png`;
  fs.writeFileSync(path.join(dir, name), png);
  console.log(`Generated ${name} (${png.length} bytes)`);
}

// Also create icon.png (128x128) as the default
fs.copyFileSync(
  path.join(dir, '128x128.png'),
  path.join(dir, 'icon.png')
);
console.log('Copied 128x128.png → icon.png');

console.log('\nNote: For .ico and .icns, use a proper image tool or online converter.');
console.log('These PNG placeholders are sufficient for development.');
