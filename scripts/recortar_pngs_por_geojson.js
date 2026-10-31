const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Tabela CRC32 padrão IEEE 802.3
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

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Algoritmo Ray-Casting para testar se (lng, lat) está dentro do anel do polígono
 */
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

/**
 * Recorta uma imagem PNG RGBA exatamente pelo contorno perimetral do GeoJSON
 */
function recortarPngPorGeometria(inputPath, destPaths, bounds, ringCoords) {
  console.log(`\n======================================================`);
  console.log(`Processando corte vetorial de: ${inputPath}`);

  if (!fs.existsSync(inputPath)) {
    console.error(`Arquivo não encontrado: ${inputPath}`);
    return;
  }

  const buf = fs.readFileSync(inputPath);
  let offset = 8;
  let ihdr = null;
  const idats = [];

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.slice(offset + 4, offset + 8).toString('ascii');
    const data = buf.slice(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data.readUInt8(8),
        colorType: data.readUInt8(9)
      };
    } else if (type === 'IDAT') {
      idats.push(data);
    }
    offset += 8 + len + 4;
  }

  const width = ihdr.width;
  const height = ihdr.height;
  const bpp = 4; // RGBA 8-bit
  const stride = width * bpp;
  const inflated = zlib.inflateSync(Buffer.concat(idats));

  // Desfaz os filtros de scanline do PNG
  const pixels = Buffer.alloc(height * stride);
  let inflPos = 0;

  for (let y = 0; y < height; y++) {
    const filterType = inflated[inflPos++];
    const rowOffset = y * stride;
    const prevRowOffset = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const filt = inflated[inflPos++];
      const left = x >= bpp ? pixels[rowOffset + x - bpp] : 0;
      const up = y > 0 ? pixels[prevRowOffset + x] : 0;
      const upleft = (y > 0 && x >= bpp) ? pixels[prevRowOffset + x - bpp] : 0;

      let val = filt;
      if (filterType === 1) {
        val = (filt + left) & 0xff;
      } else if (filterType === 2) {
        val = (filt + up) & 0xff;
      } else if (filterType === 3) {
        val = (filt + Math.floor((left + up) / 2)) & 0xff;
      } else if (filterType === 4) {
        val = (filt + paethPredictor(left, up, upleft)) & 0xff;
      }
      pixels[rowOffset + x] = val;
    }
  }

  const minLat = bounds[0][0];
  const minLng = bounds[0][1];
  const maxLat = bounds[1][0];
  const maxLng = bounds[1][1];

  let totalPixels = width * height;
  let pixelsCortados = 0;
  let pixelsMantidos = 0;

  for (let y = 0; y < height; y++) {
    // Topo é maxLat, base é minLat
    const lat = maxLat - ((y + 0.5) / height) * (maxLat - minLat);
    const rowOffset = y * stride;

    for (let x = 0; x < width; x++) {
      // Esquerda é minLng, direita é maxLng
      const lng = minLng + ((x + 0.5) / width) * (maxLng - minLng);
      const pxOffset = rowOffset + x * bpp;

      const dentro = pontoNoPoligono(lng, lat, ringCoords);

      if (!dentro) {
        // Pixel RIGOROSAMENTE FORA do polígono da fazenda: Canal Alfa = 0 (Totalmente Transparente)
        pixels[pxOffset] = 0;
        pixels[pxOffset + 1] = 0;
        pixels[pxOffset + 2] = 0;
        pixels[pxOffset + 3] = 0;
        pixelsCortados++;
      } else {
        pixelsMantidos++;
      }
    }
  }

  console.log(`Dimensões: ${width}x${height} (${totalPixels} px). Mantidos dentro da fazenda: ${pixelsMantidos} (${((pixelsMantidos/totalPixels)*100).toFixed(1)}%). Recortados como transparentes: ${pixelsCortados} (${((pixelsCortados/totalPixels)*100).toFixed(1)}%).`);

  // Reconstrói as scanlines do PNG com filterType 0 (None)
  const filteredOutput = Buffer.alloc(height * (1 + stride));
  let outPos = 0;
  for (let y = 0; y < height; y++) {
    filteredOutput[outPos++] = 0; // Filter 0: None
    pixels.copy(filteredOutput, outPos, y * stride, (y + 1) * stride);
    outPos += stride;
  }

  const compressedData = zlib.deflateSync(filteredOutput, { level: 9 });

  // Monta arquivo PNG de alta qualidade
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8-bit
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);

  const ihdrChunk = createChunk('IHDR', ihdrData);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  const finalPng = Buffer.concat([pngHeader, ihdrChunk, idatChunk, iendChunk]);

  for (const dest of destPaths) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, finalPng);
    console.log(`✓ Gravado com sucesso em: ${dest} (${finalPng.length} bytes)`);
  }
}

// Execução do pipeline
const bounds = JSON.parse(fs.readFileSync('DATA/bounds.json', 'utf8'));
const nelitoGeo = JSON.parse(fs.readFileSync('DATA/nelito.geojson', 'utf8'));
const guanaiGeo = JSON.parse(fs.readFileSync('DATA/guanai.geojson', 'utf8'));

const nelitoCoords = nelitoGeo.features[0].geometry.coordinates[0];
const guanaiCoords = guanaiGeo.features[0].geometry.coordinates[0];

const listaNelito = [
  'nelito_rgb_10m.png',
  'nelito_ndvi_2m.png',
  'nelito_rgb_anterior.png',
  'nelito_ndvi_anterior.png'
];

const listaGuanai = [
  'guanai_rgb_10m.png',
  'guanai_ndvi_2m.png',
  'guanai_rgb_anterior.png',
  'guanai_ndvi_anterior.png'
];

for (const nome of listaNelito) {
  const input = `DATA/${nome}`;
  const targets = [
    `DATA/${nome}`,
    `assets/satelite/${nome}`,
    `assets/rasters/${nome}`
  ];
  recortarPngPorGeometria(input, targets, bounds.nelito, nelitoCoords);
}

for (const nome of listaGuanai) {
  const input = `DATA/${nome}`;
  const targets = [
    `DATA/${nome}`,
    `assets/satelite/${nome}`,
    `assets/rasters/${nome}`
  ];
  recortarPngPorGeometria(input, targets, bounds.guanai, guanaiCoords);
}

console.log('\n======================================================');
console.log('✓ Pipeline de recorte vetorial concluído com sucesso em todas as imagens!');
