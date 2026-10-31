/**
 * ECOSSISTEMA ITPA - Controle Global de Auditoria de Crédito e UI
 * Garante reatividade infalível ao alternar propriedades rurais (Nelito, Guanaí, ESEC Guanabara)
 * e mantém o painel de auditoria recolhido (collapsed) por padrão, abrindo somente quando solicitado.
 */

// Dados oficiais exatos de cada imóvel rural / projeto
const ITPA_DADOS_PROJETOS = {
  esec: {
    key: "esec",
    nome: "ESEC Guanabara",
    car: "Regime Público (CNUC / ICMBio)",
    tipo: "Unidade de Conservação Federal",
    municipio: "Guapimirim / APA - RJ",
    area: "3.200,00 ha",
    area_num: 3200.0,
    prodes: "0,00 ha (0.0%)",
    status: "CONFORME - Ausência de Sobreposição PRODES/DETER",
    elegibilidade: "ELEGÍVEL (Regime Público ICMBio)",
    coords: [-22.685, -43.045]
  },
  nelito: {
    key: "nelito",
    nome: "Fazenda Nelito",
    car: "RJ-3302908-AE983FB03BAE42A9B32833247D8CCD4D",
    tipo: "Imóvel Rural Privado",
    municipio: "Miguel Pereira - RJ",
    area: "246,116 ha",
    area_num: 246.116,
    prodes: "0,00 ha (0.0%)",
    status: "CONFORME - Ausência de Sobreposição PRODES/DETER",
    elegibilidade: "ELEGÍVEL (Resolução CMN nº 5.303/2026)",
    coords: [-22.544446, -43.546451]
  },
  guanai: {
    key: "guanai",
    nome: "Fazenda Guanaí",
    car: "RJ-3302908-D52C6812F1464345885FE14360B005CE",
    tipo: "Imóvel Rural Privado",
    municipio: "Miguel Pereira - RJ",
    area: "615,808 ha",
    area_num: 615.808,
    prodes: "0,00 ha (0.0%)",
    status: "CONFORME - Ausência de Sobreposição PRODES/DETER",
    elegibilidade: "ELEGÍVEL (Resolução CMN nº 5.303/2026)",
    coords: [-22.551347, -43.551385]
  }
};
window.ITPA_DADOS_PROJETOS = ITPA_DADOS_PROJETOS;

// Metadados oficiais das camadas raster (RGB 10m e NDVI 2m) e bounds.json por propriedade
const ITPA_PROJETOS_RASTERS = {
  nelito: {
    chave: "nelito",
    nome: "Fazenda Nelito",
    boundsJson: "assets/satelite/bounds_expandido.json",
    boundsJsonFallback: "assets/rasters/nelito_bounds.json",
    boundsFallback: [
      [-22.556060671, -43.553371968],
      [-22.532831488, -43.539530935]
    ],
    rgb10m: "assets/satelite/nelito_rgb_10m.png",
    ndvi2m: "assets/satelite/nelito_ndvi_2m.png",
    fallbackRgb10m: "assets/rasters/nelito_rgb_10m.png",
    fallbackNdvi2m: "assets/rasters/nelito_ndvi_2m.png",
    rgbAnterior: "assets/rasters/nelito_rgb_anterior.png",
    ndviAnterior: "assets/rasters/nelito_ndvi_anterior.png"
  },
  guanai: {
    chave: "guanai",
    nome: "Fazenda Guanaí",
    boundsJson: "assets/satelite/bounds_expandido.json",
    boundsJsonFallback: "assets/rasters/guanai_bounds.json",
    boundsFallback: [
      [-22.561182140, -43.558557229],
      [-22.541512148, -43.544213807]
    ],
    rgb10m: "assets/satelite/guanai_rgb_10m.png",
    ndvi2m: "assets/satelite/guanai_ndvi_2m.png",
    fallbackRgb10m: "assets/rasters/guanai_rgb_10m.png",
    fallbackNdvi2m: "assets/rasters/guanai_ndvi_2m.png",
    rgbAnterior: "assets/rasters/guanai_rgb_anterior.png",
    ndviAnterior: "assets/rasters/guanai_ndvi_anterior.png"
  },
  esec: {
    chave: "esec",
    nome: "ESEC Guanabara",
    boundsJson: "assets/satelite/bounds_expandido.json",
    boundsJsonFallback: "assets/rasters/esec_bounds.json",
    boundsFallback: [
      [-22.737766, -43.022287],
      [-22.691124, -42.949613]
    ],
    rgb10m: "assets/satelite/aoi_rgb_recente_2m.png",
    ndvi2m: "assets/satelite/aoi_ndvi_recente_2m.png",
    fallbackRgb10m: "assets/rasters/esec_rgb_2m.png",
    fallbackNdvi2m: "assets/rasters/esec_ndvi_2m.png",
    rgbAnterior: "assets/satelite/aoi_rgb_anterior_2m.png",
    ndviAnterior: "assets/satelite/aoi_ndvi_anterior_2m.png"
  }
};
window.ITPA_PROJETOS_RASTERS = ITPA_PROJETOS_RASTERS;

let _isAuditoriaSyncing = false;

/**
 * Atualiza silenciosamente os campos de texto da auditoria no DOM (sem abrir o card)
 * @param {string} projetoKey - 'esec', 'nelito' ou 'guanai'
 */
window.atualizarDadosAuditoria = function(projetoKey) {
  if (!projetoKey || typeof projetoKey !== 'string') {
    const sel = document.getElementById('select-projeto');
    projetoKey = (sel && sel.value) ? sel.value : (window.PROJETO_ATIVO_ID || 'esec');
  }

  const key = projetoKey.toLowerCase().trim();
  const p = ITPA_DADOS_PROJETOS[key] ||
            (window.PROJETOS && window.PROJETOS[key]) ||
            ITPA_DADOS_PROJETOS.esec;

  // Atualiza os dados em todos os seletores pertinentes no DOM
  const setTexto = (seletorLista, valor) => {
    seletorLista.forEach(sel => {
      const elementos = document.querySelectorAll(sel);
      elementos.forEach(el => {
        el.innerText = valor;
        el.classList.remove('placeholder');
      });
    });
  };

  setTexto(['#audit-nome-propriedade', '#audit-property-name', '.audit-property-name'], p.nome);
  setTexto(['#audit-car', '#audit-car-code', '.audit-car-code', '[data-field="car"]'], p.car);
  setTexto(['#audit-tipo', '#audit-property-type', '#audit-tipo-imovel', '[data-field="tipo"]'], p.tipo);
  setTexto(['#audit-municipio', '.audit-municipio', '[data-field="municipio"]'], p.municipio);
  setTexto(['#audit-area', '#audit-total-area', '#audit-area-total', '[data-field="area"]'], p.area);
  setTexto(['#audit-prodes', '#audit-prodes-overlap', '[data-field="prodes"]'], p.prodes || '0,00 ha (0.0%)');
  const statusFormatado = key === 'esec' ? 'CONFORME CNUC/ICMBio' : 'CONFORME CMN nº 5.303/2026';
  setTexto(['#audit-status', '#audit-status-badge', '.audit-status-badge', '[data-field="status-texto"]'], statusFormatado);
  setTexto(['#audit-elegibilidade', '#audit-eligibility-status', '[data-field="status"]'], p.elegibilidade || 'ELEGÍVEL');

  // Atualiza subtítulo do cabeçalho do card
  const headerSub = document.getElementById('audit-card-header-sub') || document.querySelector('.audit-card-subtitle');
  if (headerSub) {
    headerSub.innerText = `${p.nome} • ${key === 'esec' ? 'CNUC/ICMBio' : 'CMN 5.303/2026'}`;
  }

  // Sincroniza o seletor no formulário de novas ocorrências
  const selOcorrencia = document.getElementById('ocorrencia-talhao');
  if (selOcorrencia) {
    const mapaNomes = {
      esec: 'ESEC Guanabara',
      nelito: 'Fazenda Nelito',
      guanai: 'Fazenda Guanaí'
    };
    if (mapaNomes[key]) selOcorrencia.value = mapaNomes[key];
  }
};

/**
 * Função mestra para troca de projeto/fazenda ativa disparada pelos botões ou pelo select.
 * NÃO abre a auditoria territorial automaticamente (mantém o mapa livre e visível).
 * @param {string} projetoKey - 'esec', 'nelito' ou 'guanai'
 */
window.trocarProjeto = function(projetoKey) {
  if (!projetoKey || typeof projetoKey !== 'string') return;
  const key = projetoKey.toLowerCase().trim();
  const p = ITPA_DADOS_PROJETOS[key] || ITPA_DADOS_PROJETOS.esec;

  console.log(`[Ecossistema ITPA] Troca de propriedade selecionada: ${p.nome} (${key})`);

  // 1. Atualiza visualmente o botão/aba ativo no cabeçalho
  const projectButtons = document.querySelectorAll('.btn-project-tab');
  projectButtons.forEach(btn => {
    const btnKey = (btn.getAttribute('data-projeto') || '').toLowerCase().trim();
    btn.classList.toggle('active', btnKey === key);
  });

  // 2. Sincroniza o elemento <select>
  const selectEl = document.getElementById('select-projeto');
  if (selectEl && selectEl.value !== key) {
    selectEl.value = key;
  }
  window.PROJETO_ATIVO_ID = key;

  // 3. Atualiza os dados de diagnóstico da auditoria sem abrir o card
  window.atualizarDadosAuditoria(key);

  // 4. Se o usuário estiver em outra aba (Lista de Registros ou Ajustes), retorna para o mapa
  const mapTabBtn = document.querySelector('[data-tab="map-view"]');
  if (mapTabBtn && !mapTabBtn.classList.contains('active')) {
    mapTabBtn.click();
  }

  // 5. Fecha qualquer pop-up aberto no mapa
  if (window.ITPAMap && typeof window.ITPAMap.getMapInstance === 'function') {
    const m = window.ITPAMap.getMapInstance();
    if (m) m.closePopup();
  }

  // 6. Transmite a troca para o módulo WebGIS (carrega o polígono oficial e os rasters da fazenda)
  if (window.ITPAMap && typeof window.ITPAMap.selecionarProjeto === 'function') {
    window.ITPAMap.selecionarProjeto(key);
  }

  // 7. Notifica o módulo de auditoria territorial sem forçar abertura
  if (window.ITPAAuditoria && typeof window.ITPAAuditoria.definirProjetoAtivo === 'function') {
    try {
      window.ITPAAuditoria.definirProjetoAtivo(key);
    } catch (e) {
      console.warn('[Auditoria] Falha silenciosa em definirProjetoAtivo:', e);
    }
  }

  // 8. Toast discreto confirmando a fazenda ativa (apenas no desktop para manter mobile limpo)
  if (typeof window.showToast === 'function' && window.innerWidth >= 768) {
    window.showToast(`Propriedade Ativa: ${p.nome}`, 'info');
  }
};

/**
 * Abre e expande explicitamente o painel de Auditoria de Crédito para o projeto ativo
 * (Usado quando o usuário clica em 'Ver Auditoria Territorial' no popup do mapa)
 * @param {string} projetoKey - 'nelito', 'guanai' ou 'esec'
 */
window.abrirAuditoriaDoProjeto = function(projetoKey) {
  const key = (projetoKey || window.PROJETO_ATIVO_ID || 'esec').toLowerCase().trim();
  const p = ITPA_DADOS_PROJETOS[key] || ITPA_DADOS_PROJETOS.esec;

  // Atualiza os dados de texto do imóvel selecionado
  window.atualizarDadosAuditoria(key);

  // Expande e destaca o card/gaveta de auditoria
  window.toggleAuditoria(true);

  const cards = document.querySelectorAll('#card-auditoria, #card-auditoria-cmn, .card-auditoria, .map-audit-card');
  cards.forEach(card => {
    card.classList.remove('audit-card-highlight');
    void card.offsetWidth; // Força reflow para animação visual de pulso
    card.classList.add('audit-card-highlight');
  });

  // Fecha qualquer pop-up no mapa para dar visão desobstruída do painel lateral
  if (window.ITPAMap && typeof window.ITPAMap.getMapInstance === 'function') {
    const m = window.ITPAMap.getMapInstance();
    if (m) m.closePopup();
  }
};

// Aliases para retrocompatibilidade com scripts legados
window.atualizarAuditoria = window.atualizarDadosAuditoria;

/**
 * Alterna manualmente a exibição do painel de auditoria (expandir / recolher)
 * @param {boolean} [forcarEstado] true para expandir, false para recolher
 */
window.toggleAuditoria = function(forcarEstado) {
  const cards = document.querySelectorAll('#card-auditoria, #card-auditoria-cmn, .card-auditoria, .map-audit-card, .audit-bottom-sheet');
  const bodies = document.querySelectorAll('#auditoria-body, #painel-auditoria, .card-body, .audit-card-body, .audit-sheet-expanded-body');
  const buttons = document.querySelectorAll('#btn-toggle-audit, #btn-toggle-audit-card, .btn-toggle-audit-card, .btn-audit-sheet-close');
  const carets = document.querySelectorAll('.expand-caret-glyph');
  const closeGlyphs = document.querySelectorAll('.close-icon-glyph');

  let isCurrentlyOpen = false;
  cards.forEach(c => {
    if (!c.classList.contains('collapsed')) isCurrentlyOpen = true;
  });

  const shouldOpen = (typeof forcarEstado === 'boolean') ? forcarEstado : !isCurrentlyOpen;

  if (!shouldOpen) {
    // Recolher (Estado Compacto: Botão Flutuante Discreto)
    cards.forEach(c => {
      c.classList.add('collapsed');
      c.style.display = '';
    });
    bodies.forEach(b => {
      b.style.display = '';
    });
    carets.forEach(el => el.textContent = '▲');
    closeGlyphs.forEach(el => el.textContent = '✕');
    buttons.forEach(btn => {
      const icon = btn.querySelector('.toggle-icon');
      if (icon) icon.innerText = '+';
      const closeG = btn.querySelector('.close-icon-glyph');
      if (closeG) closeG.innerText = '✕';
    });
    const pill = document.getElementById('pill-quick-auditoria');
    if (pill) pill.classList.remove('active');
  } else {
    // Expandir (Janela Modal Grande solicitada pelo usuário)
    cards.forEach(c => {
      c.classList.remove('collapsed');
      c.style.display = '';
    });
    bodies.forEach(b => {
      b.style.display = '';
    });
    carets.forEach(el => el.textContent = '▼');
    closeGlyphs.forEach(el => el.textContent = '✕');
    buttons.forEach(btn => {
      const icon = btn.querySelector('.toggle-icon');
      if (icon) icon.innerText = '✕';
      const closeG = btn.querySelector('.close-icon-glyph');
      if (closeG) closeG.innerText = '✕';
    });
    const pill = document.getElementById('pill-quick-auditoria');
    if (pill) pill.classList.add('active');
  }
};

// Capturador global de cliques para o botão de auditoria dentro do popup do mapa
document.addEventListener('click', function(e) {
  const btn = e.target && e.target.closest ? e.target.closest('.btn-abrir-auditoria-proj') : null;
  if (btn) {
    console.log('[Auditoria] Interceptado clique em .btn-abrir-auditoria-proj via Delegated Event Listener');
    e.preventDefault();
    e.stopPropagation();
    const projKey = btn.getAttribute('data-projeto') || window.PROJETO_ATIVO_ID || 'esec';
    window.abrirAuditoriaDoProjeto(projKey);
    if (window.ITPAMap && window.ITPAMap.getMapInstance) {
      const m = window.ITPAMap.getMapInstance();
      if (m) m.closePopup();
    }
  }
}, true);

// Capturador global de cliques e toques para o botão de Comparação Temporal (Swipe)
['click', 'touchend'].forEach(evt => {
  document.addEventListener(evt, function(e) {
    const btn = e.target && e.target.closest ? e.target.closest('.btn-popup-comparar, .btn-talhao-swipe') : null;
    if (btn) {
      console.log(`[Swipe] Interceptado ${evt} em botão Comparar via Delegated Event Listener`);
      e.preventDefault();
      e.stopPropagation();
      const projKey = btn.getAttribute('data-projeto') || btn.getAttribute('data-foco') || btn.getAttribute('data-talhao') || window.PROJETO_ATIVO_ID || 'nelito';
      if (typeof window.acionarComparacaoSwipe === 'function') {
        window.acionarComparacaoSwipe(projKey);
      } else if (window.ITPAMap && typeof window.ITPAMap.ativarModoSwipe === 'function') {
        window.ITPAMap.ativarModoSwipe(projKey);
      }
    }
  }, true);
});

// Instanciação explícita das camadas raster no Leaflet via bounds.json
window.instanciarRastersLeaflet = async function(projetoKey, mapInstance) {
  const map = mapInstance || (window.ITPAMap && window.ITPAMap.getMapInstance ? window.ITPAMap.getMapInstance() : null);
  if (!map) return;
  if (window.ITPAMap && typeof window.ITPAMap.carregarRastersDoProjeto === 'function') {
    return await window.ITPAMap.carregarRastersDoProjeto(projetoKey);
  }
};

// Inicialização segura do projeto padrão (mantém a auditoria recolhida na carga)
function initProjetoPadrao() {
  const select = document.getElementById('select-projeto');
  const keyInicial = select ? select.value : 'esec';

  // Sincroniza dados textuais sem abrir o card de auditoria
  window.atualizarDadosAuditoria(keyInicial);

  // Garante que o card de auditoria inicie RECOLHIDO (collapsed)
  window.toggleAuditoria(false);

  // Sincroniza abas no topo
  const projectButtons = document.querySelectorAll('.btn-project-tab');
  projectButtons.forEach(btn => {
    const btnKey = (btn.getAttribute('data-projeto') || '').toLowerCase().trim();
    btn.classList.toggle('active', btnKey === keyInicial);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProjetoPadrao);
} else {
  initProjetoPadrao();
}
