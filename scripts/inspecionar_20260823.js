const fs = require('fs');

function inspectFullTiff(filePath) {
  const buf = fs.readFileSync(filePath);
  const isLE = buf.readUInt16LE(0) === 0x4949;
  const readU16 = (o) => isLE ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
  const readU32 = (o) => isLE ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
  
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
  console.log('\n--- ' + filePath + ' ---');
  console.log('Size:', buf.length, 'bytes');
  for (const [k, v] of Object.entries(tags)) {
    console.log('Tag ' + k + ': type=' + v.type + ', count=' + v.count + ', val=' + v.val);
  }

  const w = tags[256].val;
  const h = tags[257].val;
  const spp = tags[277] ? tags[277].val : 1;
  const compression = tags[259] ? tags[259].val : 1;
  console.log(`Dimensions: ${w}x${h}, Channels: ${spp}, Compression: ${compression}`);

  // BitsPerSample (tag 258)
  if (tags[258]) {
    const bpsOffset = tags[258].val;
    const bitsPerSample = [];
    if (spp === 1) {
      bitsPerSample.push(tags[258].val);
    } else {
      for (let s = 0; s < spp; s++) {
        bitsPerSample.push(readU16(bpsOffset + s * 2));
      }
    }
    console.log('BitsPerSample:', bitsPerSample);
  }

  // StripOffsets (tag 273)
  const stripCount = tags[273].count;
  const stripOffset = tags[273].val;
  console.log('StripCount:', stripCount, 'StripOffset:', stripOffset);
}

inspectFullTiff('assets/satelite/nelito_rgb_20260823.tif');
inspectFullTiff('assets/satelite/nelito_ndvi_20260823.tif');
inspectFullTiff('assets/satelite/guanai_rgb_20260823.tif');
inspectFullTiff('assets/satelite/guanai_ndvi_20260823.tif');
