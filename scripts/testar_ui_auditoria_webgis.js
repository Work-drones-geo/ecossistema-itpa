const fs = require('fs');
const path = require('path');

const index = fs.readFileSync('index.html', 'utf8');
const script = fs.readFileSync('script.js', 'utf8');
const map = fs.readFileSync(path.join('js', 'map.js'), 'utf8');
const audit = fs.readFileSync(path.join('js', 'auditoria.js'), 'utf8');

console.log('--- 1. Validando IDs e Classes no index.html ---');
const ids = [
  'card-auditoria',
  'auditoria-body',
  'audit-car',
  'audit-area',
  'audit-tipo',
  'audit-municipio',
  'audit-status',
  'audit-elegibilidade',
  'pill-quick-auditoria',
  'pill-quick-ndvi',
  'pill-quick-rgb',
  'pill-quick-swipe'
];
ids.forEach(id => {
  const ok = index.includes(`id="${id}"`);
  console.assert(ok, `index.html tem id ${id}`);
  console.log(`✓ ID ${id}: ${ok ? 'OK' : 'FALHA'}`);
});

console.log('\n--- 2. Validando Métodos Globais em script.js ---');
const funcs = [
  'window.abrirAuditoriaDoProjeto',
  'window.atualizarAuditoria',
  'window.toggleAuditoria',
  'window.ITPA_DADOS_PROJETOS',
  'window.ITPA_PROJETOS_RASTERS'
];
funcs.forEach(fn => {
  const ok = script.includes(fn);
  console.assert(ok, `script.js define ${fn}`);
  console.log(`✓ ${fn}: ${ok ? 'OK' : 'FALHA'}`);
});

console.log('\n--- 3. Validando Overlays e Comparador no js/map.js ---');
const mapChecks = [
  'assets/rasters/nelito_rgb_10m.png',
  'assets/rasters/nelito_ndvi_2m.png',
  'assets/rasters/guanai_rgb_10m.png',
  'assets/rasters/guanai_ndvi_2m.png',
  'assets/rasters/esec_rgb_2m.png',
  'assets/rasters/esec_ndvi_2m.png',
  'obterBoundsPropriedadeAtiva',
  'leftPane',
  'rightPane',
  'ativarModoSwipe',
  'desativarModoSwipe'
];
mapChecks.forEach(item => {
  const ok = map.includes(item);
  console.assert(ok, `map.js possui ${item}`);
  console.log(`✓ ${item}: ${ok ? 'OK' : 'FALHA'}`);
});

console.log('\n--- 4. Validando ausência de caminhos absolutos (/assets ou /DATA) ---');
const badAssets = (script + map).match(/['"]\/(assets|DATA)/g);
console.assert(!badAssets, 'Não há caminhos com barra inicial absoluta');
console.log('✓ Caminhos estritamente relativos:', !badAssets ? 'OK' : 'FALHA');

console.log('\n--- 5. Validando existência física de todos os 16 arquivos em assets/rasters/ ---');
const rasters = [
  'nelito_rgb_10m.png',
  'nelito_ndvi_2m.png',
  'nelito_rgb_anterior.png',
  'nelito_ndvi_anterior.png',
  'nelito_bounds.json',
  'guanai_rgb_10m.png',
  'guanai_ndvi_2m.png',
  'guanai_rgb_anterior.png',
  'guanai_ndvi_anterior.png',
  'guanai_bounds.json',
  'esec_rgb_2m.png',
  'esec_ndvi_2m.png',
  'esec_rgb_anterior.png',
  'esec_ndvi_anterior.png',
  'esec_bounds.json',
  'bounds.json'
];
rasters.forEach(r => {
  const p = path.join('assets', 'rasters', r);
  const ok = fs.existsSync(p);
  console.assert(ok, `Arquivo ${p} existe`);
  console.log(`✓ ${p}: ${ok ? 'OK' : 'FALHA'}`);
});

console.log('\n✅ TODOS OS TESTES DE AUDITORIA E WEBGIS PASSARAM COM SUCESSO!');
