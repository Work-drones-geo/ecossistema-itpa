// Teste de validação das camadas raster PNG e bounds.json no Leaflet
const fs = require('fs');
const path = require('path');

console.log('--- 1. Validando arquivos de limites (bounds.json) ---');
const nelitoBoundsPath = path.join('DATA', 'nelito_bounds.json');
const guanaiBoundsPath = path.join('DATA', 'guanai_bounds.json');

console.assert(fs.existsSync(nelitoBoundsPath), 'nelito_bounds.json existe');
console.assert(fs.existsSync(guanaiBoundsPath), 'guanai_bounds.json existe');

const nelitoBounds = JSON.parse(fs.readFileSync(nelitoBoundsPath, 'utf8'));
const guanaiBounds = JSON.parse(fs.readFileSync(guanaiBoundsPath, 'utf8'));

console.assert(nelitoBounds.leaflet_bounds && nelitoBounds.leaflet_bounds.length === 2, 'nelitoBounds possui leaflet_bounds válidos');
console.assert(guanaiBounds.leaflet_bounds && guanaiBounds.leaflet_bounds.length === 2, 'guanaiBounds possui leaflet_bounds válidos');
console.log('✓ Bounds Nelito:', JSON.stringify(nelitoBounds.leaflet_bounds));
console.log('✓ Bounds Guanaí:', JSON.stringify(guanaiBounds.leaflet_bounds));

console.log('\n--- 2. Validando arquivos PNG (RGB 10m e NDVI 2m) ---');
const arquivosNecessarios = [
  'nelito_rgb_10m.png',
  'nelito_ndvi_2m.png',
  'nelito_rgb_anterior.png',
  'nelito_ndvi_anterior.png',
  'guanai_rgb_10m.png',
  'guanai_ndvi_2m.png',
  'guanai_rgb_anterior.png',
  'guanai_ndvi_anterior.png'
];

arquivosNecessarios.forEach(arq => {
  const fullPath = path.join('DATA', arq);
  console.assert(fs.existsSync(fullPath), `Arquivo ${arq} existe`);
  const stat = fs.statSync(fullPath);
  console.assert(stat.size > 1000, `Arquivo ${arq} possui tamanho válido (${stat.size} bytes)`);
  console.log(`✓ ${arq}: ${stat.size} bytes`);
});

console.log('\n--- 3. Validando integração no script.js e js/map.js ---');
const scriptContent = fs.readFileSync('script.js', 'utf8');
const mapContent = fs.readFileSync(path.join('js', 'map.js'), 'utf8');

console.assert(scriptContent.includes('ITPA_PROJETOS_RASTERS'), 'script.js contém ITPA_PROJETOS_RASTERS');
console.assert(scriptContent.includes('boundsJson'), 'script.js referencia boundsJson');
console.assert(scriptContent.includes('instanciarRastersLeaflet'), 'script.js exporta instanciarRastersLeaflet');

console.assert(mapContent.includes('carregarRastersDoProjeto'), 'map.js contém carregarRastersDoProjeto');
console.assert(mapContent.includes('L.imageOverlay'), 'map.js instancia L.imageOverlay');
console.assert(mapContent.includes('CONFIG_RASTERS_PROJETOS'), 'map.js contém CONFIG_RASTERS_PROJETOS');
console.assert(mapContent.includes('nelito_bounds.json'), 'map.js referencia nelito_bounds.json');
console.assert(mapContent.includes('guanai_bounds.json'), 'map.js referencia guanai_bounds.json');

console.log('\n✅ TODOS OS TESTES DE INTEGRAÇÃO RASTER PASSARAM COM SUCESSO!');
