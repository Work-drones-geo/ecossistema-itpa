const fs = require('fs');
const zlib = require('zlib');

// Lê PNG recente de Nelito
const pngBuf = fs.readFileSync('DATA/nelito_rgb_10m.png');
let offset = 8;
const idats = [];
let ihdr = null;
while (offset < pngBuf.length) {
  const len = pngBuf.readUInt32BE(offset);
  const type = pngBuf.slice(offset + 4, offset + 8).toString('ascii');
  const data = pngBuf.slice(offset + 8, offset + 8 + len);
  if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4) };
  if (type === 'IDAT') idats.push(data);
  offset += 8 + len + 4;
}
const pngInf = zlib.inflateSync(Buffer.concat(idats));

console.log('PNG recente:', ihdr);

// Compara com o TIFF nelito_rgb_anterior.tif
const tiffBuf = fs.readFileSync('assets/satelite/nelito_rgb_anterior.tif');
const isLE = tiffBuf.readUInt16LE(0) === 0x4949;
const readU16 = (o) => isLE ? tiffBuf.readUInt16LE(o) : tiffBuf.readUInt16BE(o);
const readU32 = (o) => isLE ? tiffBuf.readUInt32LE(o) : tiffBuf.readUInt32BE(o);
const ifdOffset = readU32(4);
const numEntries = readU16(ifdOffset);
const tags = {};
for (let i = 0; i < numEntries; i++) {
  const entryOffset = ifdOffset + 2 + i * 12;
  const tag = readU16(entryOffset);
  const type = readU16(entryOffset + 2);
  const count = readU32(entryOffset + 4);
  const val = readU32(entryOffset + 8);
  tags[tag] = { type, count, val };
}
const tw = tags[256].val;
const th = tags[257].val;
const stripCount = tags[273].count;
const stripOffsetsVal = tags[273].val;
const offsets = [];
for (let i = 0; i < stripCount; i++) offsets.push(readU32(stripOffsetsVal + i * 4));
const rowsPerStrip = tags[278].val;

console.log('TIFF anterior:', { tw, th, rowsPerStrip });

// Pega uma amostra de 5 pixels no centro do talhão (ex: y=140, x=70..75)
const centroY = 140;
console.log('--- Comparação no centro (y=140) ---');
for (let x = 70; x < 75; x++) {
  // PNG recente
  const pngPos = centroY * (ihdr.w * 4 + 1) + 1 + x * 4;
  const pngR = pngInf[pngPos], pngG = pngInf[pngPos+1], pngB = pngInf[pngPos+2], pngA = pngInf[pngPos+3];
  
  // TIFF anterior
  const stripIdx = Math.floor(centroY / rowsPerStrip);
  const rowInStrip = centroY % rowsPerStrip;
  const tiffPos = offsets[stripIdx] + (rowInStrip * tw + x) * 4 * 2;
  const tiffCh0 = readU16(tiffPos);
  const tiffCh1 = readU16(tiffPos + 2);
  const tiffCh2 = readU16(tiffPos + 4);
  const tiffCh3 = readU16(tiffPos + 6);
  
  console.log('x=' + x + ': PNG Recente RGBA=[' + pngR + ',' + pngG + ',' + pngB + ',' + pngA + '] | TIFF Anterior 16bit=[' + tiffCh0 + ',' + tiffCh1 + ',' + tiffCh2 + ',' + tiffCh3 + ']');
}
