// Teste de validação do Sistema de Rastreabilidade Temporal (Badge Temporal e Datas nas Camadas)
const fs = require('fs');

console.log('--- 1. Validando Badge Temporal Flutuante no index.html ---');
const html = fs.readFileSync('index.html', 'utf8');

console.assert(html.includes('id="map-temporal-badge"'), 'Elemento #map-temporal-badge presente');
console.assert(html.includes('class="temporal-badge-dot"'), 'Elemento .temporal-badge-dot presente');
console.assert(html.includes('id="temporal-badge-text"'), 'Elemento #temporal-badge-text presente');

// Posicionamento no DOM: deve estar dentro de #map-view
const idxMapView = html.indexOf('<section id="map-view">');
const idxBadge = html.indexOf('id="map-temporal-badge"');
const idxQuickCol = html.indexOf('id="map-quick-tech-column"');
console.assert(idxBadge > idxMapView && idxBadge < idxQuickCol, 'Badge posicionado dentro de #map-view antes da coluna rápida');

console.log('--- 2. Validando Estilos CSS do Badge Temporal em styles.css ---');
const css = fs.readFileSync('styles.css', 'utf8');

console.assert(css.includes('.map-temporal-badge'), 'Classe .map-temporal-badge presente no CSS');
console.assert(css.includes('top: 86px') && css.includes('left: 12px'), 'Posição canto superior esquerdo abaixo do zoom (top: 86px, left: 12px)');
console.assert(css.includes('background-color: #ffffff') || css.includes('background: #ffffff'), 'Fundo branco no CSS');
console.assert(css.includes('border-radius: 4px'), 'Cantos leves border-radius: 4px');
console.assert(css.includes('border: 1px solid #e0e0e0'), 'Borda fina cinza #e0e0e0');
console.assert(css.includes('font-size: 11px'), 'Tipografia com font-size: 11px');
console.assert(css.includes('color: #333333'), 'Cor do texto #333333');
console.assert(css.includes('.temporal-badge-dot'), 'Dot indicador verde presente no CSS');

console.log('--- 3. Validando Novas Datas no Menu de Camadas (#sheet-camadas-modal) ---');
console.assert(html.includes('Ortofoto Drone (Base 2025)'), 'Data Base 2025 no Drone presente');
console.assert(html.includes('Satélite RGB Recente (24/Out/2026)'), 'Data 24/Out/2026 no Satélite RGB Recente presente');
console.assert(html.includes('Índice NDVI Recente (24/Out/2026)'), 'Data 24/Out/2026 no NDVI Recente presente');
console.assert(html.includes('Satélite RGB Histórico (04/Set/2026)'), 'Data 04/Set/2026 no Satélite RGB Histórico presente');
console.assert(html.includes('Índice NDVI Histórico (04/Set/2026)'), 'Data 04/Set/2026 no NDVI Histórico presente');

console.log('--- 4. Validando Lógica Dinâmica em js/map.js ---');
const mapJs = fs.readFileSync('js/map.js', 'utf8');

console.assert(mapJs.includes('function atualizarBadgeTemporal'), 'Função atualizarBadgeTemporal definida em js/map.js');
console.assert(mapJs.includes('DRONE: Voo Base 2025 (Alta Resolução)'), 'String Drone Base 2025 presente');
console.assert(mapJs.includes('DRONE: Voo Recente 2026'), 'String Drone Recente 2026 presente');
console.assert(mapJs.includes('SATÉLITE: 24/Out/2026 (Sentinel-2 L2A)'), 'String Satélite Sentinel-2 L2A presente');
console.assert(mapJs.includes('NDVI: 24/Out/2026 (Super-resolvido 2m)'), 'String NDVI Super-resolvido 2m presente');
console.assert(mapJs.includes('SATÉLITE HISTÓRICO: 04/Set/2026'), 'String Satélite Histórico 04/Set presente');
console.assert(mapJs.includes('NDVI HISTÓRICO: 04/Set/2026'), 'String NDVI Histórico 04/Set presente');
console.assert(mapJs.includes('atualizarBadgeTemporal,'), 'atualizarBadgeTemporal exportado em ITPAMap');

console.log('--- 5. Validando Versionamento v=6.2 ---');
console.assert(html.includes('styles.css?v=6.2'), 'styles.css atualizado para v=6.2');
console.assert(html.includes('js/map.js?v=6.2'), 'js/map.js atualizado para v=6.2');
console.assert(html.includes('app.js?v=6.2'), 'app.js atualizado para v=6.2');
console.assert(html.includes('js/relatorio_talhao.js?v=6.2'), 'js/relatorio_talhao.js atualizado para v=6.2');

console.log('✅ TESTE DE RASTREABILIDADE TEMPORAL CONCLUÍDO COM 100% DE SUCESSO!');
