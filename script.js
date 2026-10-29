/**
 * ECOSSISTEMA ITPA - Controle Global de Auditoria de Crédito e UI
 * Garante reatividade infalível ao clicar em 'Ver Auditoria Territorial'
 * e ao alternar propriedades rurais (Nelito, Guanaí, ESEC Guanabara).
 */

// Dados oficiais exatos de cada imóvel rural / projeto
const ITPA_DADOS_PROJETOS = {
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
    coords: [-22.540, -43.545]
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
    coords: [-22.552, -43.558]
  },
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
  }
};

/**
 * Abre e atualiza o painel de Auditoria de Crédito para o projeto especificado
 * @param {string} projetoKey - 'nelito', 'guanai' ou 'esec'
 */
window.abrirAuditoriaDoProjeto = function(projetoKey) {
  // 1. Resolução segura da chave do projeto
  if (!projetoKey || typeof projetoKey !== 'string') {
    const sel = document.getElementById('select-projeto');
    projetoKey = (sel && sel.value) ? sel.value : (window.PROJETO_ATIVO_ID || 'nelito');
  }

  // Normalização caso venha em maiúsculas
  const key = projetoKey.toLowerCase().trim();
  const p = ITPA_DADOS_PROJETOS[key] ||
            (window.PROJETOS && window.PROJETOS[key]) ||
            ITPA_DADOS_PROJETOS.nelito;

  console.log('[Auditoria] Abrindo diagnóstico territorial para:', p.nome, `(${key})`);

  // 2. Sincroniza seletor de projeto ativo no topo
  const selectEl = document.getElementById('select-projeto');
  if (selectEl && selectEl.value !== key) {
    selectEl.value = key;
  }
  window.PROJETO_ATIVO_ID = key;

  // 3. Atualiza os dados em todos os elementos de texto no DOM (suporte amplo a IDs e classes)
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
  setTexto(['#audit-status', '#audit-status-badge', '.audit-status-badge', '[data-field="status-texto"]'], p.status || 'CONFORME');
  setTexto(['#audit-elegibilidade', '#audit-eligibility-status', '[data-field="status"]'], p.elegibilidade || 'ELEGÍVEL');

  // Atualiza subtítulo do cabeçalho do card
  const headerSub = document.getElementById('audit-card-header-sub') || document.querySelector('.audit-card-subtitle');
  if (headerSub) {
    headerSub.innerText = `${p.nome} • CMN 5.303/2026`;
  }

  // 4. FORÇA A ABERTURA E VISIBILIDADE DO CARD LATERAL
  const cards = document.querySelectorAll('#card-auditoria, #card-auditoria-cmn, .card-auditoria, .map-audit-card');
  cards.forEach(card => {
    card.classList.remove('collapsed');
    card.style.display = 'block';
  });

  const bodies = document.querySelectorAll('#auditoria-body, #painel-auditoria, .card-body, .audit-card-body');
  bodies.forEach(body => {
    body.style.display = 'block';
  });

  const buttons = document.querySelectorAll('#btn-toggle-audit, #btn-toggle-audit-card, .btn-toggle-audit-card');
  buttons.forEach(btn => {
    btn.innerText = '−';
    const icon = btn.querySelector('.toggle-icon');
    if (icon) icon.innerText = '−';
  });

  // Ativa o pill rápido do mapa
  const pill = document.getElementById('pill-quick-auditoria');
  if (pill) pill.classList.add('active');

  // 5. Atualiza o estado da auditoria em js/auditoria.js se disponível
  if (window.ITPAAuditoria && typeof window.ITPAAuditoria.definirProjetoAtivo === 'function') {
    try {
      window.ITPAAuditoria.definirProjetoAtivo(key);
    } catch (e) {
      console.warn('[Auditoria] Falha silenciosa no módulo auditoria:', e);
    }
  }

  // 6. Toast informativo
  if (typeof window.showToast === 'function') {
    window.showToast(`⚖️ Auditoria: ${p.nome}`, 'success');
  }
};

// Aliases para retrocompatibilidade
window.atualizarAuditoria = window.abrirAuditoriaDoProjeto;

/**
 * Alterna manualmente a exibição do painel de auditoria (expandir / recolher)
 */
window.toggleAuditoria = function() {
  const cards = document.querySelectorAll('#card-auditoria, #card-auditoria-cmn, .card-auditoria, .map-audit-card');
  const bodies = document.querySelectorAll('#auditoria-body, #painel-auditoria, .card-body, .audit-card-body');
  const buttons = document.querySelectorAll('#btn-toggle-audit, #btn-toggle-audit-card, .btn-toggle-audit-card');

  // Verifica se está aberto
  let isOpen = false;
  cards.forEach(c => {
    if (!c.classList.contains('collapsed')) isOpen = true;
  });

  if (isOpen) {
    // Recolher
    cards.forEach(c => c.classList.add('collapsed'));
    bodies.forEach(b => b.style.display = 'none');
    buttons.forEach(btn => {
      btn.innerText = '+';
      const icon = btn.querySelector('.toggle-icon');
      if (icon) icon.innerText = '+';
    });
    const pill = document.getElementById('pill-quick-auditoria');
    if (pill) pill.classList.remove('active');
  } else {
    // Expandir
    cards.forEach(c => {
      c.classList.remove('collapsed');
      c.style.display = 'block';
    });
    bodies.forEach(b => b.style.display = 'block');
    buttons.forEach(btn => {
      btn.innerText = '−';
      const icon = btn.querySelector('.toggle-icon');
      if (icon) icon.innerText = '−';
    });
    const pill = document.getElementById('pill-quick-auditoria');
    if (pill) pill.classList.add('active');
  }
};

// Capturador global de cliques (Fase de Captura) para garantir que botões de auditoria nunca sejam bloqueados
document.addEventListener('click', function(e) {
  const btn = e.target && e.target.closest ? e.target.closest('.btn-abrir-auditoria-proj') : null;
  if (btn) {
    console.log('[Auditoria] Interceptado clique em .btn-abrir-auditoria-proj via Delegated Event Listener');
    e.preventDefault();
    e.stopPropagation();
    const projKey = btn.getAttribute('data-projeto') ||
                    (document.getElementById('select-projeto') ? document.getElementById('select-projeto').value : 'nelito');
    window.abrirAuditoriaDoProjeto(projKey);
  }
}, true); // useCapture = true para interceptar antes de qualquer biblioteca de mapa

// Inicialização automática do projeto selecionado
function initProjetoPadrao() {
  const select = document.getElementById('select-projeto');
  const keyInicial = select ? select.value : 'nelito';
  window.abrirAuditoriaDoProjeto(keyInicial);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProjetoPadrao);
} else {
  initProjetoPadrao();
}
