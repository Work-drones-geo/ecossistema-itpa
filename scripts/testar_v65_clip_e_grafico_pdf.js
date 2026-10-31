const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');

console.log('===============================================================');
console.log('INICIANDO BATERIA DE TESTES DE INTEGRAÇÃO - VERSÃO v6.5');
console.log('===============================================================\n');

let falhas = 0;
let sucessos = 0;

function test(descricao, fn) {
  try {
    fn();
    console.log(`[PASSOU] ${descricao}`);
    sucessos++;
  } catch (e) {
    console.error(`[FALHOU] ${descricao}`);
    console.error(`         Erro: ${e.message}`);
    falhas++;
  }
}

// 1. Validação dos arquivos PNG recortados vetorialmente
const arquivosNelito = [
  'DATA/nelito_rgb_10m.png',
  'DATA/nelito_ndvi_2m.png',
  'DATA/nelito_rgb_anterior.png',
  'DATA/nelito_ndvi_anterior.png',
  'assets/satelite/nelito_rgb_10m.png',
  'assets/satelite/nelito_ndvi_2m.png',
  'assets/satelite/nelito_rgb_anterior.png',
  'assets/satelite/nelito_ndvi_anterior.png'
];

const arquivosGuanai = [
  'DATA/guanai_rgb_10m.png',
  'DATA/guanai_ndvi_2m.png',
  'DATA/guanai_rgb_anterior.png',
  'DATA/guanai_ndvi_anterior.png',
  'assets/satelite/guanai_rgb_10m.png',
  'assets/satelite/guanai_ndvi_2m.png',
  'assets/satelite/guanai_rgb_anterior.png',
  'assets/satelite/guanai_ndvi_anterior.png'
];

test('Existência de todos os PNGs recortados de Nelito e Guanaí', () => {
  [...arquivosNelito, ...arquivosGuanai].forEach(f => {
    assert(fs.existsSync(f), `Arquivo não encontrado: ${f}`);
  });
});

function inspecionarPngAlfa(caminho) {
  const buf = fs.readFileSync(caminho);
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
        height: data.readUInt32BE(4)
      };
    } else if (type === 'IDAT') {
      idats.push(data);
    }
    offset += 8 + len + 4;
  }
  const inflated = zlib.inflateSync(Buffer.concat(idats));
  const w = ihdr.width;
  const h = ihdr.height;
  const stride = w * 4;
  let inflPos = 0;
  let pixelsOpacos = 0;
  let pixelsTransparentes = 0;

  for (let y = 0; y < h; y++) {
    inflPos++; // filter byte
    for (let x = 0; x < w; x++) {
      const a = inflated[inflPos + 3];
      if (a === 0) pixelsTransparentes++;
      else if (a > 200) pixelsOpacos++;
      inflPos += 4;
    }
  }
  return { w, h, pixelsOpacos, pixelsTransparentes };
}

test('Verificação de transparência alfamétrica nos PNGs de Nelito e Guanaí', () => {
  const infoNelito = inspecionarPngAlfa('DATA/nelito_rgb_anterior.png');
  assert(infoNelito.pixelsTransparentes > 100000, 'Nelito anterior deve possuir pixels recortados com alfa = 0');
  assert(infoNelito.pixelsOpacos > 100000, 'Nelito anterior deve possuir pixels preservados dentro da fazenda');

  const infoGuanai = inspecionarPngAlfa('DATA/guanai_rgb_anterior.png');
  assert(infoGuanai.pixelsTransparentes > 100000, 'Guanai anterior deve possuir pixels recortados com alfa = 0');
  assert(infoGuanai.pixelsOpacos > 100000, 'Guanai anterior deve possuir pixels preservados dentro da fazenda');

  console.log(`         Nelito RGB Anterior: ${infoNelito.pixelsOpacos} px internos / ${infoNelito.pixelsTransparentes} px transparentes`);
  console.log(`         Guanaí RGB Anterior: ${infoGuanai.pixelsOpacos} px internos / ${infoGuanai.pixelsTransparentes} px transparentes`);
});

// 2. Validação do código em js/map.js
const mapCode = fs.readFileSync('js/map.js', 'utf8');

test('js/map.js contém clipPolygon vetorial em CONFIG_RASTERS_PROJETOS', () => {
  assert(mapCode.includes('clipPolygon: \'polygon('), 'Deve conter clipPolygon definido');
  assert(mapCode.includes('aplicarMascaraVetorial'), 'Deve conter função de aplicação da máscara vetorial');
  assert(mapCode.includes('has-open-popup'), 'Deve gerenciar classe has-open-popup no mapa');
});

test('js/map.js padronizou botões do popup sem emojis e com gatilho direto', () => {
  assert(mapCode.includes('Comparar Passagens (Swipe)'), 'Texto técnico sem emojis');
  assert(mapCode.includes('window.acionarComparacaoSwipe'), 'Gatilho direto para swipe');
  assert(!mapCode.includes('↔️ Comparar Passagens Temporais'), 'Emoji removido com sucesso');
});

// 3. Validação do Gráfico Temporal de NDVI no Laudo PDF
const relatorioCode = fs.readFileSync('js/relatorio_talhao.js', 'utf8');

test('js/relatorio_talhao.js contém a seção do Gráfico de NDVI no Laudo PDF', () => {
  assert(relatorioCode.includes('4. HISTORICO TEMPORAL DE VIGOR VEGETATIVO (NDVI SENTINEL-2)'), 'Título da seção do gráfico presente');
  assert(relatorioCode.includes('04/Set/2026 (Passagem Base)'), 'Data base de 04/Set presente');
  assert(relatorioCode.includes('24/Out/2026 (Passagem Recente)'), 'Data recente de 24/Out presente');
  assert(relatorioCode.includes('Evolucao do Vigor: +'), 'Badge com indicador de tendência e ganho percentual');
  assert(relatorioCode.includes('doc.line(pt1X, pt1Y, pt2X, pt2Y)'), 'Linha contínua vetorial conectando os pontos');
  assert(relatorioCode.includes('doc.circle(pt1X, pt1Y'), 'Pontos destacados com círculos');
});

// 4. Validação do CSS em styles.css
const stylesCode = fs.readFileSync('styles.css', 'utf8');

test('styles.css removeu emoji de balança e compactou botão recolhido da auditoria', () => {
  assert(!stylesCode.includes("content: '⚖️ ';"), "Emoji da balança não deve existir no ::before");
  assert(stylesCode.includes('.audit-bottom-sheet.collapsed'), 'Estilo collapsed presente');
  assert(stylesCode.includes('.has-open-popup .leaflet-map-pane'), 'Elevação de z-index do popup presente');
});

// 5. Validação de versão de cache em index.html
const indexHtml = fs.readFileSync('index.html', 'utf8');

test('index.html atualizado para ?v=6.5', () => {
  assert(indexHtml.includes('styles.css?v=6.5'), 'CSS na versão v6.5');
  assert(indexHtml.includes('js/map.js?v=6.5'), 'map.js na versão v6.5');
  assert(indexHtml.includes('js/relatorio_talhao.js?v=6.5'), 'relatorio_talhao.js na versão v6.5');
  assert(indexHtml.includes('js/auditoria.js?v=6.5'), 'auditoria.js na versão v6.5');
  assert(!indexHtml.includes('?v=6.4'), 'Nenhum script na versão antiga 6.4');
});

console.log('\n===============================================================');
console.log(`RESULTADO FINAL: ${sucessos} testes aprovados, ${falhas} falhas.`);
console.log('===============================================================');

if (falhas > 0) process.exit(1);
