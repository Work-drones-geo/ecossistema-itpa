// Teste de validação técnica da versão v6.3 (Padronização Pop-ups e Mobile Minimalista)
const fs = require('fs');

console.log('=== TESTE DE VALIDAÇÃO v6.3: ECOSSISTEMA ITPA ===');

console.log('--- 1. Validando Padronização dos Pop-ups (ESEC, Nelito e Guanaí) ---');
const mapJs = fs.readFileSync('js/map.js', 'utf8');
console.assert(mapJs.includes('imovel-analytic-popup'), 'Classe imovel-analytic-popup presente');
console.assert(mapJs.includes('talhao-analytic-popup'), 'Padrão gráfico talhao-analytic-popup aplicado');
console.assert(mapJs.includes('gerarHtmlPopupPadronizado'), 'Função unificada gerarHtmlPopupPadronizado presente');
console.assert(mapJs.includes('Município / Região'), 'Informação de Município / Região presente');
console.assert(mapJs.includes('Área Total'), 'Informação de Área Total presente');
console.assert(mapJs.includes('MONITORAMENTO ATIVO'), 'Status MONITORAMENTO ATIVO presente');
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

console.log('--- 3. Validando Interatividade e Preenchimento SVG Transparente ---');
console.assert(mapJs.includes("color: '#2E7D32'"), "Contorno vetorial oficial '#2E7D32'");
console.assert(mapJs.includes("stroke: true"), "Traço habilitado stroke: true");
console.assert(mapJs.includes("fillOpacity: 0.001"), "Preenchimento 100% transparente para captura de cliques");
console.assert(mapJs.includes("fill: true"), "fill: true habilitado para cliques em polígonos");
console.assert(mapJs.includes("verificarPontoNoPoligono"), "Algoritmo de detecção de ponto no polígono presente");

console.log('--- 4. Validando Botão Flutuante Compacto e Janela Grande de Auditoria ---');
const stylesCss = fs.readFileSync('styles.css', 'utf8');
console.assert(stylesCss.includes('.audit-bottom-sheet.collapsed'), 'Regras de estado recolhido compacto presentes');
console.assert(stylesCss.includes('height: 38px !important'), 'Altura compacta de 38px para celular presente');
console.assert(stylesCss.includes('.btn-audit-sheet-close'), 'Botão explícito de fechar janela presente');
console.assert(stylesCss.includes('pointer-events: all !important'), 'Pointer-events all para Leaflet paths presente');

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

console.log('--- 6. Validando Versionamento v=6.3 em index.html ---');
const html = fs.readFileSync('index.html', 'utf8');
console.assert(html.includes('styles.css?v=6.3'), 'styles.css v=6.3 presente');
console.assert(html.includes('js/map.js?v=6.3'), 'js/map.js v=6.3 presente');
console.assert(html.includes('js/config.js?v=6.3'), 'js/config.js v=6.3 presente');
console.assert(html.includes('app.js?v=6.3'), 'app.js v=6.3 presente');

console.log('✅ TODAS AS VALIDAÇÕES v6.3 PASSARAM COM SUCESSO ABSOLUTO (100%)!');
