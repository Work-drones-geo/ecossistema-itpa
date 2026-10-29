const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Algoritmo CRC32 para chunks PNG
function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    table[i] = c >>> 0;
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xFF];
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'binary');
  const crcBuf = Buffer.alloc(4);
  const toCrc = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(toCrc), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPng(width, height, pixelFn) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    raw[pos++] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      raw[pos++] = r;
      raw[pos++] = g;
      raw[pos++] = b;
      raw[pos++] = a;
    }
  }
  const compressed = zlib.deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// Ray-casting algorithm para testar se ponto está dentro do polígono
function pointInPolygon(point, polygon) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Paleta RdYlGn oficial de 8 classes de biomassa (GEE / ITPA)
function getNdviColor(ndvi) {
  // ndvi varia de ~0.2 a 0.85
  if (ndvi < 0.25) return [215, 48, 39, 230];    // Vermelho (solo)
  if (ndvi < 0.35) return [244, 109, 67, 235];   // Laranja
  if (ndvi < 0.45) return [253, 174, 97, 240];   // Âmbar
  if (ndvi < 0.55) return [254, 224, 139, 245];  // Amarelo
  if (ndvi < 0.65) return [217, 239, 139, 245];  // Verde claro
  if (ndvi < 0.72) return [166, 217, 106, 250];  // Verde médio
  if (ndvi < 0.80) return [102, 189, 99, 250];   // Verde floresta
  return [26, 152, 80, 255];                     // Verde denso Mata Atlântica
}

function processarPropriedade(chave) {
  console.log(`\nGerando rasters PNG iniciais para: ${chave.toUpperCase()}`);
  const geojsonPath = path.join('DATA', `${chave}.geojson`);
  const boundsPath = path.join('DATA', `${chave}_bounds.json`);

  if (!fs.existsSync(geojsonPath) || !fs.existsSync(boundsPath)) {
    console.error(`Arquivos não encontrados para ${chave}`);
    return;
  }

  const geoData = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  const boundsData = JSON.parse(fs.readFileSync(boundsPath, 'utf8'));

  const coords = geoData.features[0].geometry.coordinates[0];
  const minLng = boundsData.bbox[0];
  const minLat = boundsData.bbox[1];
  const maxLng = boundsData.bbox[2];
  const maxLat = boundsData.bbox[3];

  const W = 384;
  const H = 384;

  // 1. Gerar RGB 10m Recente
  const pngRgbRecente = createPng(W, H, (x, y) => {
    const lng = minLng + (x / W) * (maxLng - minLng);
    const lat = maxLat - (y / H) * (maxLat - minLat); // Invertido no eixo Y
    const inside = pointInPolygon([lng, lat], coords);
    if (!inside) return [0, 0, 0, 0];

    // Simulação espectral natural Sentinel-2 RGB
    const noise = (Math.sin(x * 0.12) + Math.cos(y * 0.14) + Math.sin((x + y) * 0.08)) * 12;
    const r = Math.min(255, Math.max(0, Math.round(52 + noise * 0.7)));
    const g = Math.min(255, Math.max(0, Math.round(96 + noise)));
    const b = Math.min(255, Math.max(0, Math.round(48 + noise * 0.6)));
    return [r, g, b, 240];
  });
  fs.writeFileSync(path.join('DATA', `${chave}_rgb_10m.png`), pngRgbRecente);
  console.log(`✓ Salvo: DATA/${chave}_rgb_10m.png (${pngRgbRecente.length} bytes)`);

  // 2. Gerar NDVI 2m Recente
  const pngNdviRecente = createPng(W, H, (x, y) => {
    const lng = minLng + (x / W) * (maxLng - minLng);
    const lat = maxLat - (y / H) * (maxLat - minLat);
    const inside = pointInPolygon([lng, lat], coords);
    if (!inside) return [0, 0, 0, 0];

    const distCentro = 1.0 - Math.min(1.0, Math.hypot((x / W) - 0.5, (y / H) - 0.5) * 1.6);
    const ndviVal = 0.40 + distCentro * 0.38 + Math.sin(x * 0.08 + y * 0.08) * 0.06;
    return getNdviColor(ndviVal);
  });
  fs.writeFileSync(path.join('DATA', `${chave}_ndvi_2m.png`), pngNdviRecente);
  console.log(`✓ Salvo: DATA/${chave}_ndvi_2m.png (${pngNdviRecente.length} bytes)`);

  // 3. Gerar RGB Anterior (para Comparador Swipe)
  const pngRgbAnterior = createPng(W, H, (x, y) => {
    const lng = minLng + (x / W) * (maxLng - minLng);
    const lat = maxLat - (y / H) * (maxLat - minLat);
    const inside = pointInPolygon([lng, lat], coords);
    if (!inside) return [0, 0, 0, 0];

    const noise = (Math.sin(x * 0.12) + Math.cos(y * 0.14) + Math.sin((x + y) * 0.08)) * 12;
    const r = Math.min(255, Math.max(0, Math.round(62 + noise * 0.8)));
    const g = Math.min(255, Math.max(0, Math.round(92 + noise * 0.9)));
    const b = Math.min(255, Math.max(0, Math.round(44 + noise * 0.5)));
    return [r, g, b, 240];
  });
  fs.writeFileSync(path.join('DATA', `${chave}_rgb_anterior.png`), pngRgbAnterior);
  console.log(`✓ Salvo: DATA/${chave}_rgb_anterior.png (${pngRgbAnterior.length} bytes)`);

  // 4. Gerar NDVI Anterior (para Comparador Swipe)
  const pngNdviAnterior = createPng(W, H, (x, y) => {
    const lng = minLng + (x / W) * (maxLng - minLng);
    const lat = maxLat - (y / H) * (maxLat - minLat);
    const inside = pointInPolygon([lng, lat], coords);
    if (!inside) return [0, 0, 0, 0];

    const distCentro = 1.0 - Math.min(1.0, Math.hypot((x / W) - 0.5, (y / H) - 0.5) * 1.6);
    const ndviVal = 0.34 + distCentro * 0.35 + Math.sin(x * 0.07 + y * 0.09) * 0.05;
    return getNdviColor(ndviVal);
  });
  fs.writeFileSync(path.join('DATA', `${chave}_ndvi_anterior.png`), pngNdviAnterior);
  console.log(`✓ Salvo: DATA/${chave}_ndvi_anterior.png (${pngNdviAnterior.length} bytes)`);
}

['nelito', 'guanai'].forEach(processarPropriedade);
console.log('\nTodos os rasters em PNG foram gerados e preparados em DATA/ com sucesso!');
