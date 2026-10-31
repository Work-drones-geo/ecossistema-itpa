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

function processarArquivoPng(inputPath, destPaths) {
  console.log(`\n========================================`);
  console.log(`Processando: ${inputPath}`);
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

  // Matriz de pixels desfiltrada
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

  // 1. Identificação direta de cores de fundo/borda:
  // - Píxeis brancos das bordas [255, 255, 255]
  // - Píxeis pretos de fundo [0, 0, 0]
  // - Píxeis cinzas de fundo [150..180, 150..180, 150..180]
  let countTransp = 0;
  let countBranco = 0;
  let countPreto = 0;
  let countCinza = 0;

  // Função auxiliar para checar se uma cor é fundo
  function isCorDeFundo(r, g, b) {
    // Branco das bordas
    if (r >= 235 && g >= 235 && b >= 235) return 'branco';
    // Preto de fundo
    if (r <= 12 && g <= 12 && b <= 12) return 'preto';
    // Cinza de borda neutro
    if (Math.abs(r - g) <= 4 && Math.abs(g - b) <= 4 && r >= 145 && r <= 185) return 'cinza';
    return null;
  }

  // Passada 1: Conversão direta de qualquer pixel branco, preto ou cinza neutro
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const tipo = isCorDeFundo(r, g, b);
    if (tipo) {
      if (tipo === 'branco') countBranco++;
      else if (tipo === 'preto') countPreto++;
      else if (tipo === 'cinza') countCinza++;
      pixels[i + 3] = 0; // Torna 100% transparente
      countTransp++;
    }
  }

  // Passada 2: Flood-fill a partir dos 4 cantos e bordas externas da imagem
  // Garante que qualquer resíduo de borda cinza/escura conectado às margens externas seja limpo
  const visitados = new Uint8Array(width * height);
  const fila = [];

  function addPixelFila(px, py) {
    if (px < 0 || px >= width || py < 0 || py >= height) return;
    const idx = py * width + px;
    if (visitados[idx]) return;
    visitados[idx] = 1;
    fila.push(px, py);
  }

  // Adiciona todo o perímetro externo na fila
  for (let x = 0; x < width; x++) {
    addPixelFila(x, 0);
    addPixelFila(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    addPixelFila(0, y);
    addPixelFila(width - 1, y);
  }

  let head = 0;
  let countFlood = 0;

  while (head < fila.length) {
    const px = fila[head++];
    const py = fila[head++];
    const pIdx = (py * width + px) * 4;
    const r = pixels[pIdx];
    const g = pixels[pIdx + 1];
    const b = pixels[pIdx + 2];
    const a = pixels[pIdx + 3];

    // Se já é transparente ou é cor de borda (quase preto, quase branco, ou cinza)
    const diffRG = Math.abs(r - g);
    const diffGB = Math.abs(g - b);
    const ehBordaConectada = (a === 0) ||
                             (r <= 30 && g <= 30 && b <= 30) ||
                             (r >= 220 && g >= 220 && b >= 220) ||
                             (diffRG <= 10 && diffGB <= 10 && (r < 60 || (r > 130 && r < 195)));

    if (ehBordaConectada) {
      if (pixels[pIdx + 3] !== 0) {
        pixels[pIdx + 3] = 0;
        countFlood++;
        countTransp++;
      }
      addPixelFila(px + 1, py);
      addPixelFila(px - 1, py);
      addPixelFila(px, py + 1);
      addPixelFila(px, py - 1);
    }
  }

  console.log(`Píxeis convertidos: Brancos=${countBranco}, Pretos=${countPreto}, Cinzas=${countCinza}, FloodFill=${countFlood}`);
  console.log(`Total transparente: ${countTransp} de ${width * height} (${((countTransp / (width * height)) * 100).toFixed(1)}%)`);

  // Reconstrói a imagem PNG com Filter 0 (None)
  const unfilteredWithFilterByte = Buffer.alloc(height * (stride + 1));
  let outPos = 0;
  for (let y = 0; y < height; y++) {
    unfilteredWithFilterByte[outPos++] = 0; // Filter None
    pixels.copy(unfilteredWithFilterByte, outPos, y * stride, (y + 1) * stride);
    outPos += stride;
  }

  const deflated = zlib.deflateSync(unfilteredWithFilterByte, { level: 9 });

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth 8
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);

  const pngChunks = [
    Buffer.from('89504e470d0a1a0a', 'hex'),
    createChunk('IHDR', ihdrData),
    createChunk('IDAT', deflated),
    createChunk('IEND', Buffer.alloc(0))
  ];

  const finalPng = Buffer.concat(pngChunks);

  // Grava em todos os caminhos de destino solicitados
  destPaths.forEach(dest => {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dest, finalPng);
    console.log(` -> Gravado em: ${dest} (${finalPng.length} bytes)`);
  });
}

// Lista dos 4 arquivos PNG solicitados pelo usuário
const arquivos = [
  {
    nome: 'nelito_rgb_anterior.png',
    input: 'DATA/nelito_rgb_anterior.png',
    destinos: [
      'DATA/nelito_rgb_anterior.png',
      'assets/satelite/nelito_rgb_anterior.png',
      'assets/rasters/nelito_rgb_anterior.png'
    ]
  },
  {
    nome: 'nelito_ndvi_anterior.png',
    input: 'DATA/nelito_ndvi_anterior.png',
    destinos: [
      'DATA/nelito_ndvi_anterior.png',
      'assets/satelite/nelito_ndvi_anterior.png',
      'assets/rasters/nelito_ndvi_anterior.png'
    ]
  },
  {
    nome: 'guanai_rgb_anterior.png',
    input: 'DATA/guanai_rgb_anterior.png',
    destinos: [
      'DATA/guanai_rgb_anterior.png',
      'assets/satelite/guanai_rgb_anterior.png',
      'assets/rasters/guanai_rgb_anterior.png'
    ]
  },
  {
    nome: 'guanai_ndvi_anterior.png',
    input: 'DATA/guanai_ndvi_anterior.png',
    destinos: [
      'DATA/guanai_ndvi_anterior.png',
      'assets/satelite/guanai_ndvi_anterior.png',
      'assets/rasters/guanai_ndvi_anterior.png'
    ]
  }
];

arquivos.forEach(item => {
  if (fs.existsSync(item.input)) {
    processarArquivoPng(item.input, item.destinos);
  } else {
    console.error(`Arquivo não encontrado: ${item.input}`);
  }
});

console.log('\n=== CONVERSÃO CONCLUÍDA COM SUCESSO! ===');
