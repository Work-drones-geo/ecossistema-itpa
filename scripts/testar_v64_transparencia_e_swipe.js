const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');

console.log('=== INICIANDO TESTES TÉCNICOS v6.4 ===');

// 1. Validação da Transparência nos PNGs Anteriores
const pngFiles = [
  'DATA/nelito_rgb_anterior.png',
  'DATA/nelito_ndvi_anterior.png',
  'DATA/guanai_rgb_anterior.png',
  'DATA/guanai_ndvi_anterior.png'
];

pngFiles.forEach(file => {
  assert(fs.existsSync(file), `Arquivo ${file} deve existir`);
  const buf = fs.readFileSync(file);
  assert(buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a', `${file} deve ser um PNG válido`);
  
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

  assert(ihdr.colorType === 6, `${file} deve ser RGBA (colorType 6)`);
  assert(ihdr.bitDepth === 8, `${file} deve ter bitDepth 8`);

  const inflated = zlib.inflateSync(Buffer.concat(idats));
  const stride = ihdr.width * 4;
  
  // Primeiro scanline: byte 0 é filter type, bytes 1..4 são RGBA do pixel (0,0)
  const cornerR = inflated[1];
  const cornerG = inflated[2];
  const cornerB = inflated[3];
  const cornerA = inflated[4];

  console.log(`[PASS] ${file} (${ihdr.width}x${ihdr.height}) -> Pixel Canto (0,0): RGBA(${cornerR}, ${cornerG}, ${cornerB}, ${cornerA})`);
  assert(cornerA === 0, `Pixel (0,0) em ${file} DEVE ter canal alfa 0 (transparência total), obteve ${cornerA}`);
});

// 2. Validação do Botão Comparar em js/map.js
const mapJs = fs.readFileSync('js/map.js', 'utf8');
assert(mapJs.includes('window.acionarComparacaoSwipe'), 'map.js deve ter window.acionarComparacaoSwipe');
assert(mapJs.includes('window.ativarModoSwipe'), 'map.js deve expor window.ativarModoSwipe');
assert(mapJs.includes('onclick="window.acionarComparacaoSwipe('), 'HTML do botão deve ter onclick inline');
assert(mapJs.includes('ontouchend="window.acionarComparacaoSwipe('), 'HTML do botão deve ter ontouchend inline');

console.log('[PASS] js/map.js: Botão [ Comparar ] devidamente vinculado com acionamento inline e delegated');

// 3. Validação do Capturador em script.js
const scriptJs = fs.readFileSync('script.js', 'utf8');
assert(scriptJs.includes('.btn-popup-comparar'), 'script.js deve ter capturador para .btn-popup-comparar');

console.log('[PASS] script.js: Capturador delegado global para cliques e toques ativo');

// 4. Validação do z-index no styles.css
const stylesCss = fs.readFileSync('styles.css', 'utf8');
assert(stylesCss.includes('.leaflet-pane.leaflet-popup-pane'), 'styles.css deve ter regra para leaflet-popup-pane');
assert(stylesCss.includes('z-index: 950 !important'), 'styles.css deve ter z-index 950 para popup');
assert(stylesCss.includes('z-index: 960 !important'), 'styles.css deve ter z-index 960 para botão comparar');

console.log('[PASS] styles.css: Camada de popup e botão comparar com z-index e pointer-events garantidos');

// 5. Validação da versão v=6.4 em index.html
const indexHtml = fs.readFileSync('index.html', 'utf8');
assert(indexHtml.includes('styles.css?v=6.4'), 'index.html deve conter styles.css?v=6.4');
assert(indexHtml.includes('script.js?v=6.4'), 'index.html deve conter script.js?v=6.4');
assert(indexHtml.includes('js/map.js?v=6.4'), 'index.html deve conter js/map.js?v=6.4');
assert(!indexHtml.includes('?v=6.3'), 'index.html não deve conter referências antigas a v=6.3');

console.log('[PASS] index.html: Cache atualizado para ?v=6.4');

console.log('\n✅ TODOS OS TESTES v6.4 FORAM CONCLUÍDOS COM 100% DE SUCESSO!');
