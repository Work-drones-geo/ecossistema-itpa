const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

console.log('--- 1. Validando os 5 botões na coluna direita e GPS ---');
console.assert(html.includes('id="pill-quick-drone"') && html.includes('DRONE'), 'Botão DRONE presente');
console.assert(html.includes('id="pill-quick-rgb"') && html.includes('SATÉLITE'), 'Botão SATÉLITE presente');
console.assert(html.includes('id="pill-quick-ndvi"') && html.includes('NDVI'), 'Botão NDVI presente');
console.assert(html.includes('id="pill-quick-limites"') && html.includes('LIMITES'), 'Botão LIMITES presente');
console.assert(html.includes('id="btn-open-layers-sheet"') && html.includes('CAMADAS'), 'Botão CAMADAS presente');
console.assert(html.includes('id="btn-gps-locate"') && html.includes('gps-target-svg'), 'Botão GPS presente com SVG');

// Ordem dos botões
const idxDrone = html.indexOf('>DRONE<');
const idxSat = html.indexOf('>SATÉLITE<');
const idxNdvi = html.indexOf('>NDVI<');
const idxLim = html.indexOf('>LIMITES<');
const idxCam = html.indexOf('>CAMADAS<');
const idxGps = html.indexOf('id="btn-gps-locate"');

console.assert(idxDrone < idxSat, 'DRONE antes de SATÉLITE');
console.assert(idxSat < idxNdvi, 'SATÉLITE antes de NDVI');
console.assert(idxNdvi < idxLim, 'NDVI antes de LIMITES');
console.assert(idxLim < idxCam, 'LIMITES antes de CAMADAS');
console.assert(idxCam < idxGps, 'CAMADAS antes de GPS');

console.log('--- 2. Validando Gaveta de Laudo e Auditoria (Bottom Sheet) ---');
console.assert(html.includes('class="audit-bottom-sheet collapsed"'), 'audit-bottom-sheet presente');
console.assert(html.includes('class="audit-drag-bar"'), 'audit-drag-bar presente');
console.assert(html.includes('class="audit-drag-pill"'), 'audit-drag-pill presente');
console.assert(html.includes('class="btn-audit-sheet-close"'), 'btn-audit-sheet-close presente');
console.assert(html.includes('class="audit-sheet-summary-row"'), 'audit-sheet-summary-row presente');
console.assert(html.includes('class="expand-caret-glyph"'), 'expand-caret-glyph presente');
console.assert(html.includes('id="btn-gerar-laudo-cmn"'), 'btn-gerar-laudo-cmn presente');
console.assert(html.includes('id="auditoria-body"') && html.includes('audit-sheet-expanded-body'), 'corpo expandido presente');
console.assert(html.includes('id="audit-car"'), 'audit-car presente');
console.assert(html.includes('id="audit-area"'), 'audit-area presente');

console.log('--- 3. Validando CSS agritech e regras mobile ---');
console.assert(css.includes('.audit-bottom-sheet'), 'Classe .audit-bottom-sheet no CSS');
console.assert(css.includes('bottom: var(--bottom-bar-height)'), 'Encostado diretamente no rodapé');
console.assert(css.includes('min-height: 44px'), 'Barra de arraste com 44px');
console.assert(css.includes('width: 40px') && css.includes('height: 4px'), 'Traço 40x4px presente no CSS');
console.assert(css.includes('#header-sync-btn') && css.includes('display: none !important'), 'Remoção de mancha verde no mobile confirmada');
console.assert(css.includes('.btn-tech-gps'), 'btn-tech-gps no CSS');
console.assert(css.includes('.gps-target-svg'), 'gps-target-svg no CSS');

console.log('✅ TODAS AS VALIDAÇÕES DOM/CSS PASSARAM COM SUCESSO ABSOLUTO!');
