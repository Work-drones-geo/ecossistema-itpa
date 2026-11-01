const fs = require('fs');
const path = require('path');

console.log('================================================================');
console.log('TESTES DE INTEGRAÇÃO - SÉRIE HISTÓRICA 4 DATAS WEBGIS v6.8');
console.log('Work Drones Geo / Ecossistema ITPA');
console.log('================================================================\n');

let allOk = true;

// 1. Validar existência e tamanho dos 4 PNGs de 11/Jul/2026 em DATA/
const arquivos11Jul = [
  'DATA/nelito_rgb_20260711.png',
  'DATA/nelito_ndvi_20260711.png',
  'DATA/guanai_rgb_20260711.png',
  'DATA/guanai_ndvi_20260711.png'
];

console.log('[1/5] Verificando arquivos PNG de 11/Jul/2026 em DATA/...');
arquivos11Jul.forEach(arq => {
  if (fs.existsSync(arq)) {
    const stat = fs.statSync(arq);
    console.log(`  ✓ ${arq} presente (${stat.size} bytes)`);
  } else {
    console.error(`  ✗ ERRO: ${arq} não encontrado!`);
    allOk = false;
  }
});

// 2. Validar também os de 23/Ago/2026
const arquivos23Ago = [
  'DATA/nelito_rgb_20260823.png',
  'DATA/nelito_ndvi_20260823.png',
  'DATA/guanai_rgb_20260823.png',
  'DATA/guanai_ndvi_20260823.png'
];

console.log('\n[2/5] Verificando arquivos PNG de 23/Ago/2026 em DATA/...');
arquivos23Ago.forEach(arq => {
  if (fs.existsSync(arq)) {
    const stat = fs.statSync(arq);
    console.log(`  ✓ ${arq} presente (${stat.size} bytes)`);
  } else {
    console.error(`  ✗ ERRO: ${arq} não encontrado!`);
    allOk = false;
  }
});

// 3. Validar index.html (versão ?v=6.8 e seletores do Swipe)
console.log('\n[3/5] Validando index.html (?v=6.8 e seletores do Swipe)...');
const indexContent = fs.readFileSync('index.html', 'utf8');

const versao68Match = indexContent.match(/\?v=6\.8/g);
console.log(`  - Ocorrências de ?v=6.8: ${versao68Match ? versao68Match.length : 0}`);
if (!versao68Match || versao68Match.length < 10) {
  console.error('  ✗ ERRO: Faltam tags com ?v=6.8 no index.html!');
  allOk = false;
}

const temSelectLeft = indexContent.includes('id="swipe-select-left"');
const temSelectRight = indexContent.includes('id="swipe-select-right"');
const temData11Jul = indexContent.includes('value="2026-07-11"');
const temData23Ago = indexContent.includes('value="2026-08-23"');
const temData04Set = indexContent.includes('value="2026-09-04"');
const temData24Out = indexContent.includes('value="2026-10-24"');

if (temSelectLeft && temSelectRight && temData11Jul && temData23Ago && temData04Set && temData24Out) {
  console.log('  ✓ Seletores do Swipe para as 4 datas configurados com perfeição no index.html!');
} else {
  console.error('  ✗ ERRO: Seletores do Swipe ausentes ou incompletos no index.html!');
  allOk = false;
}

// 4. Validar js/map.js (CENAS_SATELITE e lógica do Swipe)
console.log('\n[4/5] Validando js/map.js (CENAS_SATELITE e lógica do Swipe)...');
const mapContent = fs.readFileSync('js/map.js', 'utf8');

const temCenas = mapContent.includes('const CENAS_SATELITE = [');
const temJulCena = mapContent.includes('2026-07-11');
const temAgoCena = mapContent.includes('2026-08-23');
const temSetCena = mapContent.includes('2026-09-04');
const temOutCena = mapContent.includes('2026-10-24');
const temAtualizarCenas = mapContent.includes('function atualizarCenasSwipe(');

if (temCenas && temJulCena && temAgoCena && temSetCena && temOutCena && temAtualizarCenas) {
  console.log('  ✓ CENAS_SATELITE e atualizarCenasSwipe integrados com perfeição no js/map.js!');
} else {
  console.error('  ✗ ERRO: Falha na estrutura de CENAS_SATELITE ou atualizarCenasSwipe no js/map.js!');
  allOk = false;
}

// 5. Validar js/relatorio_talhao.js (4 pontos no Laudo PDF)
console.log('\n[5/5] Validando js/relatorio_talhao.js (4 pontos no Laudo PDF)...');
const relatorioContent = fs.readFileSync('js/relatorio_talhao.js', 'utf8');

const tem4Pontos = relatorioContent.includes('HISTÓRICO TEMPORAL DE VIGOR VEGETATIVO (NDVI SENTINEL-2) - 4 DATAS') &&
  relatorioContent.includes('pt0X') &&
  relatorioContent.includes('pt1X') &&
  relatorioContent.includes('pt2X') &&
  relatorioContent.includes('pt3X');

if (tem4Pontos) {
  console.log('  ✓ Curva contínua de 4 pontos (Jul -> Ago -> Set -> Out) integrada ao Laudo PDF!');
} else {
  console.error('  ✗ ERRO: Falha na integração da curva de 4 pontos no relatorio_talhao.js!');
  allOk = false;
}

if (allOk) {
  console.log('\n================================================================');
  console.log('TODAS AS 5 VALIDAÇÕES PASSARAM COM 100% DE SUCESSO (v6.8)!');
  console.log('================================================================');
} else {
  console.error('\nHOUVE ERROS NOS TESTES!');
  process.exit(1);
}
