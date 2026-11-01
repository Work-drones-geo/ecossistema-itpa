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

function testarCamada(filePath, coords) {
  const tiff = lerTiffDescomprimido8Bit(filePath);
  let totalInside = 0;
  let totalOutside = 0;
  let insideTransparent = 0;
  let outsideOpaque = 0;

  for (let y = 0; y < tiff.height; y++) {
    const lat = tiff.tiepoint[1] - (y + 0.5) * tiff.scale[1];
    for (let x = 0; x < tiff.width; x++) {
      const lng = tiff.tiepoint[0] + (x + 0.5) * tiff.scale[0];
      const dentro = pontoNoPoligono(lng, lat, coords);
      const px = tiff.matrix[y][x];
      const alpha = px[3];

      if (dentro) {
        totalInside++;
        if (alpha === 0) insideTransparent++;
      } else {
        totalOutside++;
        if (alpha > 0) outsideOpaque++;
      }
    }
  }

  console.log(`\nArquivo: ${filePath}`);
  console.log(`Total pixels: ${tiff.width * tiff.height} (${tiff.width}x${tiff.height})`);
  console.log(`Dentro do polígono: ${totalInside} (com alfa=0: ${insideTransparent})`);
  console.log(`Fora do polígono: ${totalOutside} (com alfa>0 residual: ${outsideOpaque})`);
}

testarCamada('assets/satelite/nelito_rgb_20260823.tif', nelitoCoords);
testarCamada('assets/satelite/nelito_ndvi_20260823.tif', nelitoCoords);
testarCamada('assets/satelite/guanai_rgb_20260823.tif', guanaiCoords);
testarCamada('assets/satelite/guanai_ndvi_20260823.tif', guanaiCoords);
