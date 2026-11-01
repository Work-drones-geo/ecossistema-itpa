const fs = require('fs');

function inspectData(filePath) {
  const buf = fs.readFileSync(filePath);
  const isLE = buf.readUInt16LE(0) === 0x4949;
  const readU16 = (o) => isLE ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
  const readU32 = (o) => isLE ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
  const readDouble = (o) => isLE ? buf.readDoubleLE(o) : buf.readDoubleBE(o);

  const ifdOffset = readU32(4);
  const numEntries = readU16(ifdOffset);
  const tags = {};
  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    const tag = readU16(entryOffset);
    const count = readU32(entryOffset + 4);
    const val = readU32(entryOffset + 8);
    tags[tag] = { count, val };
  }

  const w = tags[256].val;
  const h = tags[257].val;
  const spp = tags[277] ? tags[277].val : 1;
  const rowsPerStrip = tags[278].val;
  const stripCount = tags[273].count;
  const stripOffsetsVal = tags[273].val;
  const offsets = [];
  if (stripCount === 1) offsets.push(stripOffsetsVal);
  else {
    for (let i = 0; i < stripCount; i++) offsets.push(readU32(stripOffsetsVal + i * 4));
  }

  // ModelPixelScaleTag (33550) & ModelTiepointTag (33922)
  let scale = null, tiepoint = null;
  if (tags[33550]) {
    const o = tags[33550].val;
    scale = [readDouble(o), readDouble(o+8), readDouble(o+16)];
  }
  if (tags[33922]) {
    const o = tags[33922].val;
    tiepoint = [
      readDouble(o), readDouble(o+8), readDouble(o+16),
      readDouble(o+24), readDouble(o+32), readDouble(o+40)
    ];
  }

  console.log(`\n=== ${filePath} ===`);
  console.log(`Size: ${w}x${h}, SPP: ${spp}, RowsPerStrip: ${rowsPerStrip}`);
  console.log('PixelScale:', scale);
  console.log('Tiepoint:', tiepoint);

  // Amostra de pixels no centro
  const midY = Math.floor(h / 2);
  const midX = Math.floor(w / 2);
  const stripIdx = Math.floor(midY / rowsPerStrip);
  const rowInStrip = midY % rowsPerStrip;
  const startOffset = offsets[stripIdx] + (rowInStrip * w + midX) * spp;
  
  const samplePixels = [];
  for (let i = -2; i <= 2; i++) {
    const pOffset = startOffset + i * spp;
    const px = [];
    for (let c = 0; c < spp; c++) {
      px.push(buf.readUInt8(pOffset + c));
    }
    samplePixels.push(px);
  }
  console.log('Center sample pixels (RGBA):', samplePixels);

  // Amostra nos cantos (0,0)
  const corner00 = offsets[0];
  const px00 = [];
  for (let c = 0; c < spp; c++) px00.push(buf.readUInt8(corner00 + c));
  console.log('Corner (0,0) pixel:', px00);
}

inspectData('assets/satelite/nelito_rgb_20260823.tif');
inspectData('assets/satelite/nelito_ndvi_20260823.tif');
inspectData('assets/satelite/guanai_rgb_20260823.tif');
inspectData('assets/satelite/guanai_ndvi_20260823.tif');
