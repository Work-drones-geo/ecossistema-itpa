const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

console.log('================================================================');
console.log('CONVERSOR DE CAMADAS 23/AGO/2026 PARA PNGS TRANSPARENTES (8-BIT)');
console.log('Work Drones Geo / Ecossistema ITPA');
console.log('================================================================\n');

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

function gerarBufferPngRgba(width, height, rgbaBuffer) {
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
  ihdrData.writeUInt8(6, 9); // ColorType 6 = RGBA
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);

  const ihdrChunk = createChunk('IHDR', ihdrData);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([pngHeader, ihdrChunk, idatChunk, iendChunk]);
}

// 2. Leitor universal de TIFF descomprimido 8 bits com georreferenciamento
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

// 3. Algoritmo Ray-Casting para máscara perimetral GeoJSON
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

// Carregar limites vetoriais
const nelitoGeo = JSON.parse(fs.readFileSync('DATA/nelito.geojson', 'utf8'));
const guanaiGeo = JSON.parse(fs.readFileSync('DATA/guanai.geojson', 'utf8'));
const nelitoCoords = nelitoGeo.features[0].geometry.coordinates[0];
const guanaiCoords = guanaiGeo.features[0].geometry.coordinates[0];

// Definição das 4 camadas solicitadas
const camadasParaConverter = [
  {
    nome: 'nelito_rgb_20260823',
    origem: 'assets/satelite/nelito_rgb_20260823.tif',
    destino: 'DATA/nelito_rgb_20260823.png',
    coords: nelitoCoords,
    tipo: 'RGB'
  },
  {
    nome: 'nelito_ndvi_20260823',
    origem: 'assets/satelite/nelito_ndvi_20260823.tif',
    destino: 'DATA/nelito_ndvi_20260823.png',
    coords: nelitoCoords,
    tipo: 'NDVI'
  },
  {
    nome: 'guanai_rgb_20260823',
    origem: 'assets/satelite/guanai_rgb_20260823.tif',
    destino: 'DATA/guanai_rgb_20260823.png',
    coords: guanaiCoords,
    tipo: 'RGB'
  },
  {
    nome: 'guanai_ndvi_20260823',
    origem: 'assets/satelite/guanai_ndvi_20260823.tif',
    destino: 'DATA/guanai_ndvi_20260823.png',
    coords: guanaiCoords,
    tipo: 'NDVI'
  }
];

const resultados = [];

camadasParaConverter.forEach((camada, index) => {
  console.log(`\n[${index + 1}/4] Processando camada: ${camada.nome}...`);
  console.log(`  Origem: ${path.resolve(camada.origem)}`);
  
  if (!fs.existsSync(camada.origem)) {
    throw new Error(`Arquivo não encontrado: ${camada.origem}`);
  }

  const tiff = lerTiffDescomprimido8Bit(camada.origem);
  const { width, height } = tiff;
  const rgbaBuffer = Buffer.alloc(width * height * 4);

  let pixelsDentro = 0;
  let pixelsFora = 0;

  for (let y = 0; y < height; y++) {
    const lat = tiff.tiepoint[1] - (y + 0.5) * tiff.scale[1];
    const rowOffset = y * width * 4;

    for (let x = 0; x < width; x++) {
      const lng = tiff.tiepoint[0] + (x + 0.5) * tiff.scale[0];
      const pxOffset = rowOffset + x * 4;
      const dentro = pontoNoPoligono(lng, lat, camada.coords);

      if (!dentro) {
        // Transparência total e estrita no exterior do polígono
        rgbaBuffer[pxOffset] = 0;
        rgbaBuffer[pxOffset + 1] = 0;
        rgbaBuffer[pxOffset + 2] = 0;
        rgbaBuffer[pxOffset + 3] = 0; // Alfa = 0
        pixelsFora++;
      } else {
        // Dentro do polígono: preserva canais de cor e fixa opacidade total (255)
        const pxRaw = tiff.matrix[y][x];
        rgbaBuffer[pxOffset] = pxRaw[0];
        rgbaBuffer[pxOffset + 1] = pxRaw[1];
        rgbaBuffer[pxOffset + 2] = pxRaw[2];
        rgbaBuffer[pxOffset + 3] = 255; // Alfa = 255
        pixelsDentro++;
      }
    }
  }

  // Gera o PNG de 8 bits por canal
  const pngBuffer = gerarBufferPngRgba(width, height, rgbaBuffer);

  // Grava na pasta DATA/
  fs.mkdirSync(path.dirname(camada.destino), { recursive: true });
  fs.writeFileSync(camada.destino, pngBuffer);

  // Também grava réplica sincronizada em assets/satelite/ e assets/rasters/ para compatibilidade
  const replica1 = path.join('assets/satelite', path.basename(camada.destino));
  const replica2 = path.join('assets/rasters', path.basename(camada.destino));
  fs.writeFileSync(replica1, pngBuffer);
  fs.mkdirSync('assets/rasters', { recursive: true });
  fs.writeFileSync(replica2, pngBuffer);

  console.log(`  ✓ Gerado: ${path.resolve(camada.destino)}`);
  console.log(`  Dimensões: ${width}x${height} | Tamanho: ${pngBuffer.length} bytes`);
  console.log(`  Pixels dentro: ${pixelsDentro} (Alfa=255) | Pixels fora: ${pixelsFora} (Alfa=0)`);

  resultados.push({
    arquivoEncontrado: path.resolve(camada.origem),
    arquivoGerado: path.resolve(camada.destino),
    dimensoes: `${width}x${height}`,
    tamanhoBytes: pngBuffer.length,
    pixelsDentro,
    pixelsFora
  });
});

console.log('\n================================================================');
console.log('RESUMO DA CONVERSÃO DAS 4 CAMADAS DE 23/AGO/2026:');
console.log('================================================================');
resultados.forEach((r, idx) => {
  console.log(`\n[Camada ${idx + 1}]`);
  console.log(`Origem  : ${r.arquivoEncontrado}`);
  console.log(`Destino : ${r.arquivoGerado}`);
  console.log(`Specs   : ${r.dimensoes} pixels, 8-bits RGBA, ${r.tamanhoBytes} bytes`);
  console.log(`Mascara : ${r.pixelsDentro} px internos (opacos) / ${r.pixelsFora} px externos (100% transparentes)`);
});
console.log('\nProcesso finalizado com 100% de sucesso!');
