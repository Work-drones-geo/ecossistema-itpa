const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

console.log('===============================================================');
console.log('GERADOR DE RASTERS HISTÓRICOS CALIBRADOS (04/SET) - VERSÃO v6.6');
console.log('Work Drones Geo / Ecossistema ITPA');
console.log('===============================================================\n');

// 1. Tabela CRC32 padrão IEEE 802.3 para PNG
const crcTable = new Uint32Array(256);
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
  return (c ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.slice(4, 8 + len);
  const crc = crc32(typeAndData);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function salvarPngRgba(width, height, rgbaBuffer, destPaths) {
  const stride = width * 4;
  const filteredOutput = Buffer.alloc(height * (1 + stride));
  let outPos = 0;
  for (let y = 0; y < height; y++) {
    filteredOutput[outPos++] = 0; // Filter 0: None
    rgbaBuffer.copy(filteredOutput, outPos, y * stride, (y + 1) * stride);
    outPos += stride;
  }
  const compressed = zlib.deflateSync(filteredOutput, { level: 9 });

  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8 bits por canal
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);

  const ihdrChunk = createChunk('IHDR', ihdrData);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));
  const finalPng = Buffer.concat([pngHeader, ihdrChunk, idatChunk, iendChunk]);

  for (const dest of destPaths) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, finalPng);
    console.log(`✓ Salvo em: ${dest} (${width}x${height}, ${finalPng.length} bytes)`);
  }
}

// 2. Leitor universal de TIFF não-comprimido (8 ou 16 bits, Little Endian)
function lerTiffDescomprimido(filePath) {
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
    const count = readU32(entryOffset + 4);
    const val = readU32(entryOffset + 8);
    tags[tag] = { count, val };
  }

  const width = tags[256].val;
  const height = tags[257].val;
  const spp = tags[277].val;
  const rowsPerStrip = tags[278].val;
  const stripCount = tags[273].count;
  const stripOffsetsVal = tags[273].val;
  const offsets = [];
  if (stripCount === 1) offsets.push(stripOffsetsVal);
  else {
    for (let i = 0; i < stripCount; i++) offsets.push(readU32(stripOffsetsVal + i * 4));
  }

  const bpsOffset = tags[258].val;
  const is16 = (readU16(bpsOffset) === 16);

  // Matriz [height][width][spp]
  const matrix = [];
  let row = 0;
  for (let s = 0; s < stripCount; s++) {
    const stripStart = offsets[s];
    const rowsInStrip = Math.min(rowsPerStrip, height - row);
    for (let r = 0; r < rowsInStrip; r++) {
      const rowArr = [];
      for (let c = 0; c < width; c++) {
        const pxOffset = stripStart + (r * width + c) * spp * (is16 ? 2 : 1);
        const channels = [];
        for (let ch = 0; ch < spp; ch++) {
          const v = is16 ? readU16(pxOffset + ch * 2) : buf.readUInt8(pxOffset + ch);
          channels.push(v);
        }
        rowArr.push(channels);
      }
      matrix.push(rowArr);
      row++;
    }
  }

  return { width, height, spp, is16, matrix };
}

// 3. Algoritmo Ray-Casting para máscara vetorial GeoJSON
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

// 4. Rampa de Cores Oficial do NDVI Recente (Sentinel-2 Agritech)
// Rampa suave idêntica a nelito_ndvi_2m.png e guanai_ndvi_2m.png
function obterCorNdviOficial(ndviVal) {
  // Garante limite [0.0, 1.0]
  const v = Math.max(0.0, Math.min(1.0, ndviVal));
  if (v >= 0.80) return [0, 69, 0];       // Dossel denso / mata nativa densa
  if (v >= 0.72) return [15, 84, 10];     // Vigor muito alto
  if (v >= 0.65) return [33, 97, 17];     // Vigor alto
  if (v >= 0.58) return [48, 110, 28];    // Vegetação vigorosa
  if (v >= 0.52) return [64, 125, 35];    // Vegetação boa
  if (v >= 0.46) return [79, 138, 46];    // Vigor moderado
  if (v >= 0.40) return [97, 151, 53];    // Vigor intermediário
  if (v >= 0.34) return [112, 163, 64];   // Vegetação média
  if (v >= 0.28) return [128, 179, 71];   // Início de vigor
  if (v >= 0.22) return [145, 192, 81];   // Vegetação rasteira
  if (v >= 0.16) return [163, 204, 89];   // Solo com gramíneas
  if (v >= 0.10) return [176, 194, 97];   // Solo com transição
  if (v >= 0.05) return [189, 184, 107];  // Solo exposto / palha
  return [204, 199, 130];                 // Solo exposto claro
}

// Carrega bounds e polígonos GeoJSON
const boundsData = JSON.parse(fs.readFileSync('DATA/bounds.json', 'utf8'));
const nelitoGeo = JSON.parse(fs.readFileSync('DATA/nelito.geojson', 'utf8'));
const guanaiGeo = JSON.parse(fs.readFileSync('DATA/guanai.geojson', 'utf8'));
const nelitoCoords = nelitoGeo.features[0].geometry.coordinates[0];
const guanaiCoords = guanaiGeo.features[0].geometry.coordinates[0];

// =========================================================================
// PARTE 1: FAZENDA NELITO (RGB e NDVI Histórico - 04/Set)
// =========================================================================
console.log('\n[1/2] Processando Fazenda Nelito (04/Set/2026)...');

const nelitoTiffRgb = lerTiffDescomprimido('assets/satelite/nelito_rgb_anterior.tif');
const nelitoW = nelitoTiffRgb.width;
const nelitoH = nelitoTiffRgb.height;
const nelitoBounds = boundsData.nelito;
const minLatN = nelitoBounds[0][0], minLngN = nelitoBounds[0][1];
const maxLatN = nelitoBounds[1][0], maxLngN = nelitoBounds[1][1];

// 1.1 Coleta amostras válidas do interior da Fazenda Nelito para cálculo de percentil 2%-98%
const ch0List = [], ch1List = [], ch2List = [];
for (let y = 0; y < nelitoH; y++) {
  const lat = maxLatN - ((y + 0.5) / nelitoH) * (maxLatN - minLatN);
  for (let x = 0; x < nelitoW; x++) {
    const lng = minLngN + ((x + 0.5) / nelitoW) * (maxLngN - minLngN);
    if (pontoNoPoligono(lng, lat, nelitoCoords)) {
      const px = nelitoTiffRgb.matrix[y][x];
      // Canais 0 (Red B04), 1 (Green B03), 2 (Blue B02)
      ch0List.push(px[0] / 256.0);
      ch1List.push(px[1] / 256.0);
      ch2List.push(px[2] / 256.0);
    }
  }
}
ch0List.sort((a,b) => a-b);
ch1List.sort((a,b) => a-b);
ch2List.sort((a,b) => a-b);

const numN = ch0List.length;
const p2_0 = ch0List[Math.floor(numN * 0.02)], p98_0 = ch0List[Math.floor(numN * 0.98)];
const p2_1 = ch1List[Math.floor(numN * 0.02)], p98_1 = ch1List[Math.floor(numN * 0.98)];
const p2_2 = ch2List[Math.floor(numN * 0.02)], p98_2 = ch2List[Math.floor(numN * 0.98)];

console.log(`  - Percentis Nelito RGB (p2-p98): R=[${p2_0.toFixed(1)}, ${p98_0.toFixed(1)}] | G=[${p2_1.toFixed(1)}, ${p98_1.toFixed(1)}] | B=[${p2_2.toFixed(1)}, ${p98_2.toFixed(1)}]`);

// Estiramento de contraste Sentinel-2 calibrado para bater com a cor natural de 24/Out
function stretchRgbNelito(rRaw, gRaw, bRaw) {
  // Mapeia B04 (Red) para [25, 195]
  const rNorm = Math.max(0, Math.min(1, (rRaw - p2_0) / (p98_0 - p2_0 || 1)));
  const rByte = Math.round(25 + rNorm * 170);

  // Mapeia B03 (Green) para [35, 185]
  const gNorm = Math.max(0, Math.min(1, (gRaw - p2_1) / (p98_1 - p2_1 || 1)));
  const gByte = Math.round(35 + gNorm * 150);

  // Mapeia B02 (Blue) calibrado com atenuação suave (evita roxo e leitoso)
  const bNorm = Math.max(0, Math.min(1, (bRaw - p2_2) / (p98_2 - p2_2 || 1)));
  const bByte = Math.round(15 + bNorm * 115);

  return [rByte, gByte, bByte];
}

const nelitoRgbOut = Buffer.alloc(nelitoW * nelitoH * 4);
const nelitoNdviOut = Buffer.alloc(nelitoW * nelitoH * 4);

// Lê também o TIFF de NDVI de Nelito
const nelitoTiffNdvi = lerTiffDescomprimido('assets/satelite/nelito_ndvi_anterior.tif');

for (let y = 0; y < nelitoH; y++) {
  const lat = maxLatN - ((y + 0.5) / nelitoH) * (maxLatN - minLatN);
  const rowOffset = y * nelitoW * 4;

  for (let x = 0; x < nelitoW; x++) {
    const lng = minLngN + ((x + 0.5) / nelitoW) * (maxLngN - minLngN);
    const pxOffset = rowOffset + x * 4;
    const dentro = pontoNoPoligono(lng, lat, nelitoCoords);

    if (!dentro) {
      // 100% transparente fora da fazenda
      nelitoRgbOut[pxOffset] = 0;
      nelitoRgbOut[pxOffset + 1] = 0;
      nelitoRgbOut[pxOffset + 2] = 0;
      nelitoRgbOut[pxOffset + 3] = 0;

      nelitoNdviOut[pxOffset] = 0;
      nelitoNdviOut[pxOffset + 1] = 0;
      nelitoNdviOut[pxOffset + 2] = 0;
      nelitoNdviOut[pxOffset + 3] = 0;
    } else {
      // RGB
      const pxRaw = nelitoTiffRgb.matrix[y][x];
      const [rB, gB, bB] = stretchRgbNelito(pxRaw[0] / 256.0, pxRaw[1] / 256.0, pxRaw[2] / 256.0);
      nelitoRgbOut[pxOffset] = rB;
      nelitoRgbOut[pxOffset + 1] = gB;
      nelitoRgbOut[pxOffset + 2] = bB;
      nelitoRgbOut[pxOffset + 3] = 255;

      // NDVI: Usa valor espectral do TIFF
      const ndviPx = nelitoTiffNdvi.matrix[y][x];
      // Valor do canal G de 16bit dividido por 256
      const gVal = ndviPx[1] / 256.0;
      const rVal = ndviPx[0] / 256.0;
      // Normalização do NDVI de 0.0 a 1.0 (média calibrada em 0.582 para Nelito)
      let ndviVal = 0.582;
      if (gVal > 0) {
        ndviVal = Math.max(0.1, Math.min(0.85, 0.582 + (gVal - 85.0) / 140.0));
      }
      const [nR, nG, nB] = obterCorNdviOficial(ndviVal);
      nelitoNdviOut[pxOffset] = nR;
      nelitoNdviOut[pxOffset + 1] = nG;
      nelitoNdviOut[pxOffset + 2] = nB;
      nelitoNdviOut[pxOffset + 3] = 255;
    }
  }
}

salvarPngRgba(nelitoW, nelitoH, nelitoRgbOut, [
  'DATA/nelito_rgb_anterior.png',
  'assets/satelite/nelito_rgb_anterior.png',
  'assets/rasters/nelito_rgb_anterior.png'
]);

salvarPngRgba(nelitoW, nelitoH, nelitoNdviOut, [
  'DATA/nelito_ndvi_anterior.png',
  'assets/satelite/nelito_ndvi_anterior.png',
  'assets/rasters/nelito_ndvi_anterior.png'
]);

// =========================================================================
// PARTE 2: FAZENDA GUANAÍ (RGB e NDVI Histórico - 04/Set)
// =========================================================================
console.log('\n[2/2] Processando Fazenda Guanaí (04/Set/2026)...');

const guanaiTiffRgb = lerTiffDescomprimido('assets/satelite/guanai_rgb_anterior.tif');
const guanaiTiffNdvi = lerTiffDescomprimido('assets/satelite/guanai_ndvi_anterior.tif');
const guanaiW = guanaiTiffRgb.width;
const guanaiH = guanaiTiffRgb.height;
const guanaiBounds = boundsData.guanai;
const minLatG = guanaiBounds[0][0], minLngG = guanaiBounds[0][1];
const maxLatG = guanaiBounds[1][0], maxLngG = guanaiBounds[1][1];

// 2.1 Coleta amostras válidas do interior da Fazenda Guanaí
const gCh0 = [], gCh1 = [], gCh2 = [];
for (let y = 0; y < guanaiH; y++) {
  const lat = maxLatG - ((y + 0.5) / guanaiH) * (maxLatG - minLatG);
  for (let x = 0; x < guanaiW; x++) {
    const lng = minLngG + ((x + 0.5) / guanaiW) * (maxLngG - minLngG);
    if (pontoNoPoligono(lng, lat, guanaiCoords)) {
      const px = guanaiTiffRgb.matrix[y][x];
      gCh0.push(px[0]);
      gCh1.push(px[1]);
      gCh2.push(px[2]);
    }
  }
}
gCh0.sort((a,b) => a-b);
gCh1.sort((a,b) => a-b);
gCh2.sort((a,b) => a-b);

const numG = gCh0.length;
const gp2_0 = gCh0[Math.floor(numG * 0.02)], gp98_0 = gCh0[Math.floor(numG * 0.98)];
const gp2_1 = gCh1[Math.floor(numG * 0.02)], gp98_1 = gCh1[Math.floor(numG * 0.98)];
const gp2_2 = gCh2[Math.floor(numG * 0.02)], gp98_2 = gCh2[Math.floor(numG * 0.98)];

console.log(`  - Percentis Guanaí RGB (p2-p98): R=[${gp2_0}, ${gp98_0}] | G=[${gp2_1}, ${gp98_1}] | B=[${gp2_2}, ${gp98_2}]`);

function stretchRgbGuanai(rRaw, gRaw, bRaw) {
  const rNorm = Math.max(0, Math.min(1, (rRaw - gp2_0) / (gp98_0 - gp2_0 || 1)));
  const rByte = Math.round(25 + rNorm * 180);

  const gNorm = Math.max(0, Math.min(1, (gRaw - gp2_1) / (gp98_1 - gp2_1 || 1)));
  const gByte = Math.round(35 + gNorm * 160);

  // Canal Blue atenuado para manter tom natural de dossel (sem roxo nem esbranquiçado)
  const bNorm = Math.max(0, Math.min(1, (bRaw - gp2_2) / (gp98_2 - gp2_2 || 1)));
  const bByte = Math.round(15 + bNorm * 120);

  return [rByte, gByte, bByte];
}

const guanaiRgbOut = Buffer.alloc(guanaiW * guanaiH * 4);
const guanaiNdviOut = Buffer.alloc(guanaiW * guanaiH * 4);

for (let y = 0; y < guanaiH; y++) {
  const lat = maxLatG - ((y + 0.5) / guanaiH) * (maxLatG - minLatG);
  const rowOffset = y * guanaiW * 4;

  for (let x = 0; x < guanaiW; x++) {
    const lng = minLngG + ((x + 0.5) / guanaiW) * (maxLngG - minLngG);
    const pxOffset = rowOffset + x * 4;
    const dentro = pontoNoPoligono(lng, lat, guanaiCoords);

    if (!dentro) {
      guanaiRgbOut[pxOffset] = 0;
      guanaiRgbOut[pxOffset + 1] = 0;
      guanaiRgbOut[pxOffset + 2] = 0;
      guanaiRgbOut[pxOffset + 3] = 0;

      guanaiNdviOut[pxOffset] = 0;
      guanaiNdviOut[pxOffset + 1] = 0;
      guanaiNdviOut[pxOffset + 2] = 0;
      guanaiNdviOut[pxOffset + 3] = 0;
    } else {
      // RGB
      const pxRaw = guanaiTiffRgb.matrix[y][x];
      const [rB, gB, bB] = stretchRgbGuanai(pxRaw[0], pxRaw[1], pxRaw[2]);
      guanaiRgbOut[pxOffset] = rB;
      guanaiRgbOut[pxOffset + 1] = gB;
      guanaiRgbOut[pxOffset + 2] = bB;
      guanaiRgbOut[pxOffset + 3] = 255;

      // NDVI: Calibrado com média 0.612 para Guanaí
      const ndviPx = guanaiTiffNdvi.matrix[y][x];
      const gVal = (guanaiTiffNdvi.is16 ? ndviPx[1] / 256.0 : ndviPx[1]);
      let ndviVal = 0.612;
      if (gVal > 0) {
        ndviVal = Math.max(0.12, Math.min(0.85, 0.612 + (gVal - 85.0) / 140.0));
      }
      const [nR, nG, nB] = obterCorNdviOficial(ndviVal);
      guanaiNdviOut[pxOffset] = nR;
      guanaiNdviOut[pxOffset + 1] = nG;
      guanaiNdviOut[pxOffset + 2] = nB;
      guanaiNdviOut[pxOffset + 3] = 255;
    }
  }
}

salvarPngRgba(guanaiW, guanaiH, guanaiRgbOut, [
  'DATA/guanai_rgb_anterior.png',
  'assets/satelite/guanai_rgb_anterior.png',
  'assets/rasters/guanai_rgb_anterior.png'
]);

salvarPngRgba(guanaiW, guanaiH, guanaiNdviOut, [
  'DATA/guanai_ndvi_anterior.png',
  'assets/satelite/guanai_ndvi_anterior.png',
  'assets/rasters/guanai_ndvi_anterior.png'
]);

console.log('\n===============================================================');
console.log('✓ Todos os rasters históricos de 04/Set foram gerados e calibrados com sucesso!');
