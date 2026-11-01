const fs = require('fs');

function lerTiffDescomprimido8Bit(filePath) {
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

  const width = tags[256].val;
  const height = tags[257].val;
  const spp = tags[277] ? tags[277].val : 1;
  const rowsPerStrip = tags[278].val;
  const stripCount = tags[273].count;
  const stripOffsetsVal = tags[273].val;
  const offsets = [];
  if (stripCount === 1) offsets.push(stripOffsetsVal);
  else {
    for (let i = 0; i < stripCount; i++) offsets.push(readU32(stripOffsetsVal + i * 4));
  }

  const scale = [readDouble(tags[33550].val), readDouble(tags[33550].val + 8)];
  const tiepoint = [readDouble(tags[33922].val + 24), readDouble(tags[33922].val + 32)];

  const matrix = [];
  let row = 0;
  for (let s = 0; s < stripCount; s++) {
    const stripStart = offsets[s];
    const rowsInStrip = Math.min(rowsPerStrip, height - row);
    for (let r = 0; r < rowsInStrip; r++) {
      const rowArr = [];
      for (let c = 0; c < width; c++) {
        const pxOffset = stripStart + (r * width + c) * spp;
        const channels = [];
        for (let ch = 0; ch < spp; ch++) {
          channels.push(buf.readUInt8(pxOffset + ch));
        }
        rowArr.push(channels);
      }
      matrix.push(rowArr);
      row++;
    }
  }

  return { width, height, spp, scale, tiepoint, matrix };
}

function pontoNoPoligono(lng, lat, coords) {
  let dentro = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i][0], yi = coords[i][1];
    const xj = coords[j][0], yj = coords[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) dentro = !dentro;
  }
  return dentro;
}

const nelitoGeo = JSON.parse(fs.readFileSync('DATA/nelito.geojson', 'utf8'));
const guanaiGeo = JSON.parse(fs.readFileSync('DATA/guanai.geojson', 'utf8'));
const nelitoCoords = nelitoGeo.features[0].geometry.coordinates[0];
const guanaiCoords = guanaiGeo.features[0].geometry.coordinates[0];

function estimarNdviDeCor(r, g, b) {
  // Rampa oficial:
  // [0, 69, 0] => ~0.80 - 0.85
  // [15, 84, 10] => ~0.72 - 0.79
  // [33, 97, 17] => ~0.65 - 0.71
  // [48, 110, 28] => ~0.58 - 0.64
  // [64, 125, 35] => ~0.52 - 0.57
  // [79, 138, 46] => ~0.46 - 0.51
  // [97, 151, 53] => ~0.40 - 0.45
  // [112, 163, 64] => ~0.34 - 0.39
  // [128, 179, 71] => ~0.28 - 0.33
  // [145, 192, 81] => ~0.22 - 0.27
  // [163, 204, 89] => ~0.16 - 0.21
  // [176, 194, 97] => ~0.10 - 0.15
  // [189, 184, 107] => ~0.05 - 0.09
  // [204, 199, 130] => ~0.00 - 0.04
  if (r === 0 && g === 69 && b === 0) return 0.82;
  if (r <= 20 && g <= 88) return 0.75;
  if (r <= 40 && g <= 100) return 0.68;
  if (r <= 55 && g <= 115) return 0.61;
  if (r <= 70 && g <= 128) return 0.54;
  if (r <= 85 && g <= 142) return 0.48;
  if (r <= 100 && g <= 155) return 0.42;
  if (r <= 118 && g <= 168) return 0.36;
  if (r <= 135 && g <= 182) return 0.30;
  if (r <= 150 && g <= 195) return 0.24;
  if (r <= 168 && g <= 206) return 0.18;
  if (r <= 180 && g <= 198) return 0.12;
  return 0.06;
}

function calcularEstatisticasNdvi(filePath, coords) {
  const tiff = lerTiffDescomprimido8Bit(filePath);
  let totalNdvi = 0;
  let count = 0;
  for (let y = 0; y < tiff.height; y++) {
    const lat = tiff.tiepoint[1] - (y + 0.5) * tiff.scale[1];
    for (let x = 0; x < tiff.width; x++) {
      const lng = tiff.tiepoint[0] + (x + 0.5) * tiff.scale[0];
      if (pontoNoPoligono(lng, lat, coords)) {
        const px = tiff.matrix[y][x];
        const val = estimarNdviDeCor(px[0], px[1], px[2]);
        totalNdvi += val;
        count++;
      }
    }
  }
  return count > 0 ? (totalNdvi / count) : 0;
}

console.log('--- Fazenda Nelito ---');
const n_jul = calcularEstatisticasNdvi('C:/Users/bsode/AppData/Local/Temp/processing_TpzDtK/b64dbdb74b484dc7b3a9c3dbefddee91/OUTPUT.tif', nelitoCoords);
const n_ago = calcularEstatisticasNdvi('assets/satelite/nelito_ndvi_20260823.tif', nelitoCoords);
console.log('Nelito 11/Jul:', n_jul.toFixed(3));
console.log('Nelito 23/Ago:', n_ago.toFixed(3));
console.log('Nelito 04/Set (Base): 0.582');
console.log('Nelito 24/Out (Recente): 0.678');

console.log('\n--- Fazenda Guanaí ---');
const g_jul = calcularEstatisticasNdvi('C:/Users/bsode/AppData/Local/Temp/processing_TpzDtK/057a7e5f86c24e4ca7aa3bd46eb8b23c/OUTPUT.tif', guanaiCoords);
const g_ago = calcularEstatisticasNdvi('assets/satelite/guanai_ndvi_20260823.tif', guanaiCoords);
console.log('Guanaí 11/Jul:', g_jul.toFixed(3));
console.log('Guanaí 23/Ago:', g_ago.toFixed(3));
console.log('Guanaí 04/Set (Base): 0.612');
console.log('Guanaí 24/Out (Recente): 0.704');
