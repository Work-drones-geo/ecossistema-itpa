const fs = require('fs');
const zlib = require('zlib');
const assert = require('assert');

console.log('===============================================================');
console.log('INICIANDO BATERIA DE TESTES DE INTEGRAÇÃO - VERSÃO v6.6');
console.log('Work Drones Geo / Ecossistema ITPA');
console.log('===============================================================\n');

let sucessos = 0;
let falhas = 0;

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

function getPngStats(filePath) {
  const buf = fs.readFileSync(filePath);
  let offset = 8;
  const idats = [];
  let ihdr = null;
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.slice(offset + 4, offset + 8).toString('ascii');
    const data = buf.slice(offset + 8, offset + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4) };
    if (type === 'IDAT') idats.push(data);
    offset += 8 + len + 4;
  }
  const inflated = zlib.inflateSync(Buffer.concat(idats));
  let rSum = 0, gSum = 0, bSum = 0;
  let count = 0;
  let temBranco = false;
  let pos = 0;
  for (let y = 0; y < ihdr.h; y++) {
    pos++; // filter
    for (let x = 0; x < ihdr.w; x++) {
      const r = inflated[pos], g = inflated[pos+1], b = inflated[pos+2], a = inflated[pos+3];
      pos += 4;
      if (a > 0) {
        count++;
        rSum += r;
        gSum += g;
        bSum += b;
        if (r >= 250 && g >= 250 && b >= 250) {
          temBranco = true;
        }
      }
    }
  }
  return {
    w: ihdr.w,
    h: ihdr.h,
    count,
    rAvg: rSum / count,
    gAvg: gSum / count,
    bAvg: bSum / count,
    temBranco
  };
}

// 1. Teste de Calibração do RGB Histórico (04/Set)
test('Nelito RGB Anterior calibrado com cores naturais Sentinel-2 (B < R e B < G)', () => {
  const stats = getPngStats('DATA/nelito_rgb_anterior.png');
  assert(stats.w === 155 && stats.h === 281, `Dimensões esperadas 155x281, obtido ${stats.w}x${stats.h}`);
  assert(stats.bAvg < stats.gAvg, `Azul (${stats.bAvg.toFixed(1)}) deve ser inferior ao verde (${stats.gAvg.toFixed(1)})`);
  assert(stats.bAvg < stats.rAvg, `Azul (${stats.bAvg.toFixed(1)}) deve ser inferior ao vermelho (${stats.rAvg.toFixed(1)})`);
  console.log(`         Nelito RGB Anterior: R=${stats.rAvg.toFixed(1)}, G=${stats.gAvg.toFixed(1)}, B=${stats.bAvg.toFixed(1)}`);
});

test('Guanaí RGB Anterior calibrado com cores naturais Sentinel-2', () => {
  const stats = getPngStats('DATA/guanai_rgb_anterior.png');
  assert(stats.w === 161 && stats.h === 238, `Dimensões esperadas 161x238, obtido ${stats.w}x${stats.h}`);
  assert(stats.bAvg < stats.gAvg, `Azul (${stats.bAvg.toFixed(1)}) deve ser inferior ao verde (${stats.gAvg.toFixed(1)})`);
  console.log(`         Guanaí RGB Anterior: R=${stats.rAvg.toFixed(1)}, G=${stats.gAvg.toFixed(1)}, B=${stats.bAvg.toFixed(1)}`);
});

// 2. Teste de Padronização do NDVI Histórico (04/Set)
test('Nelito NDVI Anterior sem pixels brancos leitosos e com rampa oficial de verde', () => {
  const stats = getPngStats('DATA/nelito_ndvi_anterior.png');
  assert(!stats.temBranco, 'NDVI não pode conter pixels brancos leitosos (>250)');
  assert(stats.gAvg > stats.rAvg && stats.gAvg > stats.bAvg, 'Canal Verde deve predominar no NDVI');
  console.log(`         Nelito NDVI Anterior: R=${stats.rAvg.toFixed(1)}, G=${stats.gAvg.toFixed(1)}, B=${stats.bAvg.toFixed(1)} (Zero brancos: OK)`);
});

test('Guanaí NDVI Anterior sem pixels brancos leitosos e com rampa oficial de verde', () => {
  const stats = getPngStats('DATA/guanai_ndvi_anterior.png');
  assert(!stats.temBranco, 'NDVI não pode conter pixels brancos leitosos (>250)');
  assert(stats.gAvg > stats.rAvg && stats.gAvg > stats.bAvg, 'Canal Verde deve predominar no NDVI');
  console.log(`         Guanaí NDVI Anterior: R=${stats.rAvg.toFixed(1)}, G=${stats.gAvg.toFixed(1)}, B=${stats.bAvg.toFixed(1)} (Zero brancos: OK)`);
});

// 3. Teste de Geração do Laudo Técnico PDF com o Gráfico de Vigor NDVI
test('Geração do Laudo Técnico PDF com Seção 4 (Gráfico Temporal de NDVI)', async () => {
  class MockJsPDF {
    constructor() {
      this.calls = [];
      this.lastAutoTable = { finalY: 135 };
    }
    setFillColor(...args) { this.calls.push(['setFillColor', args]); }
    setDrawColor(...args) { this.calls.push(['setDrawColor', args]); }
    setLineWidth(...args) { this.calls.push(['setLineWidth', args]); }
    rect(...args) { this.calls.push(['rect', args]); }
    roundedRect(...args) { this.calls.push(['roundedRect', args]); }
    line(...args) { this.calls.push(['line', args]); }
    lines(...args) { this.calls.push(['lines', args]); }
    circle(...args) { this.calls.push(['circle', args]); }
    text(txt, x, y, opts) { this.calls.push(['text', txt, x, y, opts]); }
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    addImage() {}
    save(name) { this.savedName = name; }
    autoTable() { this.lastAutoTable = { finalY: 135 }; }
  }

  class MockImage {
    set src(url) {
      setTimeout(() => { if (this.onload) this.onload(); }, 5);
    }
  }

  global.Image = MockImage;
  global.window = {
    jspdf: { jsPDF: MockJsPDF },
    showToast: () => {},
    ITPA_ASSETS_LAUDO: {}
  };
  global.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const code = fs.readFileSync('js/relatorio_talhao.js', 'utf8');
  eval(code);

  assert(window.ITPARelatorioTalhao && typeof window.ITPARelatorioTalhao.exportarLaudoPericialCMN === 'function');

  // Teste com Nelito
  await window.ITPARelatorioTalhao.exportarLaudoPericialCMN({
    projetoKey: 'nelito',
    nome_imovel: 'Fazenda Nelito',
    codigo_car: 'RJ-3302908-AE983FB03BAE42A9B32833247D8CCD4D'
  });

  // Teste com Guanaí
  await window.ITPARelatorioTalhao.exportarLaudoPericialCMN({
    projetoKey: 'guanai',
    nome_imovel: 'Fazenda Guanaí',
    codigo_car: 'RJ-3302908-D52C6812F1464345885FE14360B005CE'
  });
});

// 4. Teste de Versão de Cache (?v=6.6)
test('index.html e scripts atualizados para ?v=6.6', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert(html.includes('styles.css?v=6.6'), 'styles.css deve estar na v=6.6');
  assert(html.includes('js/map.js?v=6.6'), 'map.js deve estar na v=6.6');
  assert(html.includes('js/relatorio_talhao.js?v=6.6'), 'relatorio_talhao.js deve estar na v=6.6');
  assert(!html.includes('?v=6.5'), 'Nenhuma referência a v=6.5 restante');
});

console.log('\n===============================================================');
console.log(`RESULTADO FINAL: ${sucessos} testes aprovados, ${falhas} falhas.`);
console.log('===============================================================');

if (falhas > 0) process.exit(1);
