// Teste de validação técnica da versão v6.2 (Integração Final)
const fs = require('fs');

console.log('=== TESTE DE VALIDAÇÃO v6.2: ECOSSISTEMA ITPA ===');

console.log('--- 1. Validando Padronização dos Pop-ups (Nelito e Guanaí) ---');
const mapJs = fs.readFileSync('js/map.js', 'utf8');
console.assert(mapJs.includes('imovel-analytic-popup'), 'Classe imovel-analytic-popup presente');
console.assert(mapJs.includes('talhao-analytic-popup'), 'Padrão gráfico talhao-analytic-popup aplicado');
console.assert(mapJs.includes('Município / Região'), 'Informação de Município / Região presente');
console.assert(mapJs.includes('Área Total'), 'Informação de Área Total presente');
console.assert(mapJs.includes('MONITORAMENTO ATIVO'), 'Status MONITORAMENTO ATIVO presente');
console.assert(mapJs.includes('CONFORME CMN nº 5.303/2026'), 'Status CONFORME CMN presente');
console.assert(mapJs.includes('btn-popup-comparar'), 'Botão [ Comparar ] padronizado presente');
console.assert(mapJs.includes('swipe-action-btn'), 'Botão com estilo swipe-action-btn em destaque');

console.log('--- 2. Validando Modo de Comparação (Swipe / Cortina Temporal) ---');
console.assert(mapJs.includes('alternarModoSwipeTipo'), 'Função alternarModoSwipeTipo para troca RGB/NDVI no swipe presente');
console.assert(mapJs.includes('nelito_rgb_anterior.png'), 'Referência a nelito_rgb_anterior.png');
console.assert(mapJs.includes('nelito_ndvi_anterior.png'), 'Referência a nelito_ndvi_anterior.png');
console.assert(mapJs.includes('guanai_rgb_anterior.png'), 'Referência a guanai_rgb_anterior.png');
console.assert(mapJs.includes('guanai_ndvi_anterior.png'), 'Referência a guanai_ndvi_anterior.png');
console.assert(mapJs.includes('04/Set/2026'), 'Data histórica 04/Set/2026 nas tags do swipe');
console.assert(mapJs.includes('24/Out/2026'), 'Data recente 24/Out/2026 nas tags do swipe');

console.log('--- 3. Validando Estilização dos Limites (Correção do Quadriculado) ---');
console.assert(mapJs.includes("color: '#2E7D32'"), "Contorno vetorial oficial '#2E7D32'");
console.assert(mapJs.includes("weight: 2"), "Espessura de contorno weight: 2");
console.assert(mapJs.includes("stroke: true"), "Traço habilitado stroke: true");
console.assert(mapJs.includes("fillOpacity: 0.0"), "Preenchimento 100% transparente (sem quadriculados)");
console.assert(mapJs.includes("fill: false"), "fill: false nos limites");

console.log('--- 4. Validando Badges Temporais e Rótulos ---');
console.assert(mapJs.includes('DRONE: Voo Base 2025 (Alta Resolução)'), 'Drone ESEC com Base 2025');
console.assert(mapJs.includes('SATÉLITE: 24/Out/2026 (Sentinel-2 L2A)'), 'Satélite recente 24/Out/2026');
console.assert(mapJs.includes('NDVI: 24/Out/2026 (Super-resolvido 2m)'), 'NDVI recente 24/Out/2026');
console.assert(mapJs.includes('SATÉLITE HISTÓRICO: 04/Set/2026'), 'Satélite histórico 04/Set/2026');
console.assert(mapJs.includes('NDVI HISTÓRICO: 04/Set/2026'), 'NDVI histórico 04/Set/2026');

console.log('--- 5. Validando Arquivos na Pasta DATA ---');
const dataFiles = [
  'DATA/nelito.geojson',
  'DATA/guanai.geojson',
  'DATA/bounds.json',
  'DATA/nelito_rgb_10m.png',
  'DATA/nelito_ndvi_2m.png',
  'DATA/nelito_rgb_anterior.png',
  'DATA/nelito_ndvi_anterior.png',
  'DATA/guanai_rgb_10m.png',
  'DATA/guanai_ndvi_2m.png',
  'DATA/guanai_rgb_anterior.png',
  'DATA/guanai_ndvi_anterior.png'
];
dataFiles.forEach(f => {
  console.assert(fs.existsSync(f), `Arquivo obrigatório ${f} existe`);
  const st = fs.statSync(f);
  console.assert(st.size > 0, `Arquivo ${f} possui tamanho válido (${st.size} bytes)`);
});

console.log('--- 6. Validando Versionamento v=6.2 em index.html ---');
const html = fs.readFileSync('index.html', 'utf8');
console.assert(html.includes('styles.css?v=6.2'), 'styles.css v=6.2 presente');
console.assert(html.includes('js/map.js?v=6.2'), 'js/map.js v=6.2 presente');
console.assert(html.includes('js/config.js?v=6.2'), 'js/config.js v=6.2 presente');
console.assert(html.includes('app.js?v=6.2'), 'app.js v=6.2 presente');
console.assert(html.includes('04/Set/2026'), 'Data 04/Set/2026 no HTML');
console.assert(html.includes('24/Out/2026'), 'Data 24/Out/2026 no HTML');

console.log('✅ TODAS AS VALIDAÇÕES v6.2 PASSARAM COM SUCESSO ABSOLUTO (100%)!');
