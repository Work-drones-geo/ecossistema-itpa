const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

console.log('Validação dos 4 PNGs gerados em DATA/...\n');

const arquivos = [
  'DATA/nelito_rgb_20260823.png',
  'DATA/nelito_ndvi_20260823.png',
  'DATA/guanai_rgb_20260823.png',
  'DATA/guanai_ndvi_20260823.png'
];

let allOk = true;

arquivos.forEach(file => {
  if (!fs.existsSync(file)) {
    console.error(`ERRO: Arquivo ${file} não existe!`);
    allOk = false;
    return;
  }

  const buf = fs.readFileSync(file);
  const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) {
    console.error(`ERRO: ${file} não possui assinatura PNG válida!`);
    allOk = false;
    return;
  }

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf.readUInt8(24);
  const colorType = buf.readUInt8(25);

  console.log(`✓ ${file}`);
  console.log(`  Tamanho no disco: ${buf.length} bytes`);
  console.log(`  Dimensões: ${width}x${height} | Profundidade: ${bitDepth}-bit | Tipo Cor: ${colorType} (RGBA)`);

  // Extrair IDAT chunks e descomprimir
  let offset = 8;
  const idatParts = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.slice(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') {
      idatParts.push(buf.slice(offset + 8, offset + 8 + len));
    }
    offset += 8 + len + 4;
  }

  const decompressed = zlib.inflateSync(Buffer.concat(idatParts));
  const stride = width * 4;
  let transparentCount = 0;
  let opaqueCount = 0;

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + stride) + 1;
    for (let x = 0; x < width; x++) {
      const a = decompressed[rowStart + x * 4 + 3];
      if (a === 0) transparentCount++;
      else if (a === 255) opaqueCount++;
    }
  }

  console.log(`  Pixels Opostos: ${opaqueCount} opacos (255) / ${transparentCount} transparentes (0)`);
  if (opaqueCount === 0 || transparentCount === 0) {
    console.error(`  AVISO: Contagem de transparência suspeita em ${file}`);
    allOk = false;
  }
});

if (allOk) {
  console.log('\nTODOS OS 4 PNGS FORAM VALIDADOS COM SUCESSO!');
} else {
  console.error('\nHOUVE FALHAS NA VALIDAÇÃO!');
  process.exit(1);
}
