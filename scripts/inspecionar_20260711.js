const fs = require('fs');

const arquivos = [
  { nome: 'Nelito RGB 11/Jul', path: 'C:/Users/bsode/AppData/Local/Temp/processing_TpzDtK/351244ec40cd4357be4256752ba68aa4/OUTPUT.tif' },
  { nome: 'Nelito NDVI 11/Jul', path: 'C:/Users/bsode/AppData/Local/Temp/processing_TpzDtK/b64dbdb74b484dc7b3a9c3dbefddee91/OUTPUT.tif' },
  { nome: 'Guanaí RGB 11/Jul', path: 'C:/Users/bsode/AppData/Local/Temp/processing_TpzDtK/92634a2a3bf644f1b70c3af5e2309dcb/OUTPUT.tif' },
  { nome: 'Guanaí NDVI 11/Jul', path: 'C:/Users/bsode/AppData/Local/Temp/processing_TpzDtK/057a7e5f86c24e4ca7aa3bd46eb8b23c/OUTPUT.tif' }
];

arquivos.forEach(item => {
  const buf = fs.readFileSync(item.path);
  const isLE = buf.readUInt16LE(0) === 0x4949;
  const readU16 = (o) => isLE ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
  const readU32 = (o) => isLE ? buf.readUInt32LE(o) : buf.readUInt32BE(o);

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
  const compression = tags[259] ? tags[259].val : 1;

  // BitsPerSample
  let bps = [];
  if (tags[258]) {
    const bpsOffset = tags[258].val;
    if (spp === 1) bps.push(tags[258].val);
    else {
      for (let s = 0; s < spp; s++) bps.push(readU16(bpsOffset + s * 2));
    }
  }

  console.log(`\n=== ${item.nome} ===`);
  console.log(`Dimensões: ${w}x${h}, Canais (SPP): ${spp}, BitsPerSample: [${bps.join(',')}], Compressão: ${compression}`);
  
  // Pegar primeiros pixels de dados
  const stripCount = tags[273].count;
  const stripOffsetsVal = tags[273].val;
  const offsets = [];
  if (stripCount === 1) offsets.push(stripOffsetsVal);
  else {
    for (let i = 0; i < stripCount; i++) offsets.push(readU32(stripOffsetsVal + i * 4));
  }
  
  // Ler 5 pixels do centro
  const rowsPerStrip = tags[278].val;
  const midY = Math.floor(h / 2);
  const midX = Math.floor(w / 2);
  const stripIdx = Math.floor(midY / rowsPerStrip);
  const rowInStrip = midY % rowsPerStrip;
  const is16 = bps[0] === 16;
  const bytesPerSample = is16 ? 2 : 1;
  const startOffset = offsets[stripIdx] + (rowInStrip * w + midX) * spp * bytesPerSample;
  
  const samplePixels = [];
  for (let p = 0; p < 3; p++) {
    const px = [];
    for (let c = 0; c < spp; c++) {
      const v = is16 ? readU16(startOffset + (p * spp + c) * 2) : buf.readUInt8(startOffset + p * spp + c);
      px.push(v);
    }
    samplePixels.push(px);
  }
  console.log('Pixels de amostra no centro:', samplePixels);
});
