/**
 * Teste de Validação Automatizada v6.3:
 * - Padronização dos Pop-ups com Botão Comparar
 * - Interatividade e Detecção de Cliques em Polígonos
 * - Botão de Auditoria Mobile Compacto no estado recolhido e Modal Grande quando expandido
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- INICIANDO TESTES DE VALIDAÇÃO v6.3 ---');

// 1. Checagem dos arquivos GeoJSON de Nelito e Guanaí
const nelitoGeoJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../DATA/nelito.geojson'), 'utf8'));
const guanaiGeoJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../DATA/guanai.geojson'), 'utf8'));

assert(nelitoGeoJson.features && nelitoGeoJson.features.length > 0, 'Nelito GeoJSON deve ter features');
assert(guanaiGeoJson.features && guanaiGeoJson.features.length > 0, 'Guanaí GeoJSON deve ter features');

const nelitoCoords = nelitoGeoJson.features[0].geometry.coordinates[0];
const guanaiCoords = guanaiGeoJson.features[0].geometry.coordinates[0];

console.log(`[PASS] Nelito GeoJSON válido com ${nelitoCoords.length} vértices`);
console.log(`[PASS] Guanaí GeoJSON válido com ${guanaiCoords.length} vértices`);

// 2. Teste do algoritmo Ray-Casting de Ponto no Polígono
function verificarPontoNoPoligono(lat, lng, coordinates) {
  if (!coordinates || !coordinates.length) return false;
  const ring = Array.isArray(coordinates[0][0]) ? coordinates[0] : coordinates;
  let dentro = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersect) dentro = !dentro;
  }
  return dentro;
}

// Centro de Nelito: [-22.544446, -43.546451]
const nelitoCentro = { lat: -22.544446, lng: -43.546451 };
assert(verificarPontoNoPoligono(nelitoCentro.lat, nelitoCentro.lng, nelitoCoords), 'Centro de Nelito deve estar dentro do polígono');

// Centro de Guanaí: [-22.551347, -43.551385]
const guanaiCentro = { lat: -22.551347, lng: -43.551385 };
assert(verificarPontoNoPoligono(guanaiCentro.lat, guanaiCentro.lng, guanaiCoords), 'Centro de Guanaí deve estar dentro do polígono');

// Ponto na Guanabara (longe de Nelito/Guanaí): [-22.705, -43.030]
assert(!verificarPontoNoPoligono(-22.705, -43.030, nelitoCoords), 'ESEC Guanabara deve estar fora de Nelito');
assert(!verificarPontoNoPoligono(-22.705, -43.030, guanaiCoords), 'ESEC Guanabara deve estar fora de Guanaí');
console.log('[PASS] Algoritmo Ray-Casting de detecção de clique no interior validado');

// 3. Checagem de js/map.js
const mapJs = fs.readFileSync(path.join(__dirname, '../js/map.js'), 'utf8');

assert(mapJs.includes('function gerarHtmlPopupPadronizado'), 'map.js deve ter a função gerarHtmlPopupPadronizado');
assert(mapJs.includes('btn-popup-comparar'), 'map.js deve conter o botão btn-popup-comparar');
assert(mapJs.includes('fillOpacity: 0.001'), 'map.js deve usar fillOpacity: 0.001 para captura de cliques');
assert(mapJs.includes('verificarPontoNoPoligono'), 'map.js deve ter a função verificarPontoNoPoligono');
assert(mapJs.includes('map.on(\'click\''), 'map.js deve ter listener complementar de clique');

console.log('[PASS] js/map.js contém estrutura padronizada de pop-up e manipuladores de clique');

// 4. Checagem de styles.css
const stylesCss = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');

assert(stylesCss.includes('.audit-bottom-sheet.collapsed'), 'styles.css deve ter regras para .collapsed');
assert(stylesCss.includes('height: 38px !important'), 'styles.css deve definir botão compacto com 38px');
assert(stylesCss.includes('.audit-bottom-sheet:not(.collapsed)'), 'styles.css deve ter regras para modal expandido');
assert(stylesCss.includes('.btn-audit-sheet-close'), 'styles.css deve ter botão de fechar modal');
assert(stylesCss.includes('path.leaflet-interactive'), 'styles.css deve conter regras para capturar eventos de path');
assert(stylesCss.includes('pointer-events: all !important'), 'styles.css deve garantir pointer-events: all');
assert(stylesCss.includes('.btn-popup-action.btn-popup-comparar'), 'styles.css deve estilizar botão comparar');

console.log('[PASS] styles.css contém estilo compacto mobile e janela expandida modal');

// 5. Checagem de index.html
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

assert(indexHtml.includes('styles.css?v=6.3'), 'index.html deve referenciar styles.css?v=6.3');
assert(indexHtml.includes('script.js?v=6.3'), 'index.html deve referenciar script.js?v=6.3');
assert(indexHtml.includes('js/map.js?v=6.3'), 'index.html deve referenciar js/map.js?v=6.3');

console.log('[PASS] index.html com versionamento de cache atualizado para v6.3');

console.log('--- TODOS OS TESTES PASSARAM COM SUCESSO! ---');
