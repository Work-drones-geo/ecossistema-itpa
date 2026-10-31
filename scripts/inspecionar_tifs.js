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

  // BitsPerSample (tag 258)
  const bpsOffset = tags[258].val;
  const bitsPerSample = [];
  for (let s = 0; s < tags[277].val; s++) {
    bitsPerSample.push(readU16(bpsOffset + s * 2));
  }
  console.log('BitsPerSample:', bitsPerSample);

  // StripOffsets (tag 273)
  const stripCount = tags[273].count;
  const stripOffset = tags[273].val;
  console.log('StripCount:', stripCount, 'StripOffset:', stripOffset);

  // Lendo amostra de valores de cada canal
  const w = tags[256].val;
  const h = tags[257].val;
  const spp = tags[277].val;
  
  // Vamos ler os offsets reais das strips
  let offsets = [];
  if (stripCount === 1) {
    offsets.push(stripOffset);
  } else {
    for (let i = 0; i < stripCount; i++) {
      offsets.push(readU32(stripOffset + i * 4));
    }
  }
  console.log('Primeiras 3 strip offsets:', offsets.slice(0, 3));
  
  // Vamos ler os primeiros pixels da primeira strip
  const dataStart = offsets[0];
  console.log('Data starts at byte:', dataStart);
  const pixelSamples = [];
  for (let p = 0; p < 5; p++) {
    const px = [];
    for (let c = 0; c < spp; c++) {
      px.push(readU16(dataStart + (p * spp + c) * 2));
    }
    pixelSamples.push(px);
  }
  console.log('First 5 pixels (all channels):', pixelSamples);
}

inspectFullTiff('assets/satelite/nelito_rgb_anterior.tif');
inspectFullTiff('assets/satelite/guanai_rgb_anterior.tif');
inspectFullTiff('assets/satelite/nelito_ndvi_anterior.tif');
inspectFullTiff('assets/satelite/guanai_ndvi_anterior.tif');
