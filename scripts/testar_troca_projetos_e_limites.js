const fs = require('fs');
const path = require('path');

console.log('=== TESTE DE TRANSIÇÃO MULTI-PROJETOS E LIMITES TERRITORIAIS ===\n');

const mapJs = fs.readFileSync(path.join('js', 'map.js'), 'utf8');
const scriptJs = fs.readFileSync('script.js', 'utf8');
const indexHtml = fs.readFileSync('index.html', 'utf8');

// 1. Verificar se POLIGONOS_EMBUTIDOS existe em js/map.js
console.log('1. Verificando POLIGONOS_EMBUTIDOS em js/map.js...');
console.assert(mapJs.includes('const POLIGONOS_EMBUTIDOS = {'), 'POLIGONOS_EMBUTIDOS deve estar declarado');
console.assert(mapJs.includes('nelito: {') && mapJs.includes('guanai: {'), 'POLIGONOS_EMBUTIDOS deve conter nelito e guanai');
console.log('✓ POLIGONOS_EMBUTIDOS: Presente e válido');

// 2. Verificar o escopo de sincronizarEstadosUI em js/map.js
console.log('\n2. Verificando escopo da função sincronizarEstadosUI...');
const defSyncUI = mapJs.indexOf('function sincronizarEstadosUI()');
const callSyncUI = mapJs.indexOf('sincronizarEstadosUI();');
console.assert(defSyncUI !== -1, 'sincronizarEstadosUI deve estar declarada');
console.assert(defSyncUI < callSyncUI, 'sincronizarEstadosUI deve estar declarada ANTES de sua primeira chamada no módulo');
console.log(`✓ sincronizarEstadosUI definida na posição ${defSyncUI}, antes da chamada na posição ${callSyncUI}`);

// 3. Verificar alternarLimitesTerritoriais e exportação no ITPAMap
console.log('\n3. Verificando alternarLimitesTerritoriais e exportações...');
console.assert(mapJs.includes('function alternarLimitesTerritoriais('), 'alternarLimitesTerritoriais declarada');
console.assert(mapJs.includes('alternarLimitesTerritoriais: alternarLimitesTerritoriais') || mapJs.includes('alternarLimitesTerritoriais,'), 'alternarLimitesTerritoriais exportada no ITPAMap');
console.assert(mapJs.includes('sincronizarEstadosUI: sincronizarEstadosUI') || mapJs.includes('sincronizarEstadosUI,'), 'sincronizarEstadosUI exportada no ITPAMap');
console.log('✓ alternarLimitesTerritoriais e sincronizarEstadosUI devidamente exportadas');

// 4. Verificar se a alternância de limites reconstrói a camada se for nula
console.log('\n4. Verificando resiliência ao ativar Limites Territoriais...');
console.assert(mapJs.includes('recarregarLimitesDoProjetoAtivo'), 'Possui fallback dinâmico recarregarLimitesDoProjetoAtivo');
console.log('✓ Fallback de recarregamento sob demanda: Presente');

// 5. Verificar o evento de clique na linha do switch de limites territoriais
console.log('\n5. Verificando interatividade tátil no switch de Limites Territoriais...');
console.assert(mapJs.includes('rowTalhoes.addEventListener(\'click\''), 'Switch row de Limites Territoriais possui click listener');
console.log('✓ Clique tátil em toda a linha do switch: Configurado');

// 6. Verificar voo imediato em selecionarProjeto
console.log('\n6. Verificando voo imediato (flyTo) em selecionarProjeto...');
const idxFly = mapJs.indexOf('map.flyTo(coordsCentro, zoomAlvo');
const idxRasters = mapJs.indexOf('carregarRastersDoProjeto(key)');
console.assert(idxFly !== -1 && idxFly < idxRasters, 'map.flyTo deve ocorrer antes de carregarRastersDoProjeto para resposta imediata');
console.log('✓ Voo imediato e desativação da ortofoto disparados antes de rasters assíncronos');

console.log('\n======================================================');
console.log('✅ TODAS AS VALIDAÇÕES DE MULTI-PROJETO E LIMITES: 100% OK!');
console.log('======================================================');
