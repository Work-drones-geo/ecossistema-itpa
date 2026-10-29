/**
 * ECOSSISTEMA ITPA - Controle Global de Auditoria de Crédito e UI
 */

// Função global para expandir/recolher o painel manualmente
window.toggleAuditoria = function() {
  const body = document.getElementById('auditoria-body');
  const btn = document.getElementById('btn-toggle-audit');
  if (!body) return;
  if (body.style.display === 'none') {
    body.style.display = 'block';
    if (btn) btn.innerText = '−';
  } else {
    body.style.display = 'none';
    if (btn) btn.innerText = '+';
  }
};

// Função global para atualizar os dados e FORÇAR a abertura do painel
window.atualizarAuditoria = function(projetoKey) {
  const body = document.getElementById('auditoria-body');
  const btn = document.getElementById('btn-toggle-audit');
  if (body) {
    body.style.display = 'block'; // Força visualização aberta
    if (btn) btn.innerText = '−';
  }

  const dados = {
    esec: {
      car: "Regime Público (CNUC / ICMBio)",
      tipo: "Unidade de Conservação Federal",
      municipio: "Guapimirim / APA - RJ",
      area: "3.200,00 ha"
    },
    nelito: {
      car: "RJ-3302908-AE983FB03BAE42A9B32833247D8CCD4D",
      tipo: "Imóvel Rural Privado",
      municipio: "Miguel Pereira - RJ",
      area: "246,116 ha"
    },
    guanai: {
      car: "RJ-3302908-D52C6812F1464345885FE14360B005CE",
      tipo: "Imóvel Rural Privado",
      municipio: "Miguel Pereira - RJ",
      area: "615,808 ha"
    }
  };

  const p = dados[projetoKey];
  if (p) {
    if (document.getElementById('audit-car')) document.getElementById('audit-car').innerText = p.car;
    if (document.getElementById('audit-tipo')) document.getElementById('audit-tipo').innerText = p.tipo;
    if (document.getElementById('audit-municipio')) document.getElementById('audit-municipio').innerText = p.municipio;
    if (document.getElementById('audit-area')) document.getElementById('audit-area').innerText = p.area;
  }
};

// Inicialização automática ao carregar o DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    const select = document.getElementById('select-projeto');
    if (select && select.value) {
      window.atualizarAuditoria(select.value);
    }
  });
} else {
  const select = document.getElementById('select-projeto');
  if (select && select.value) {
    window.atualizarAuditoria(select.value);
  }
}
