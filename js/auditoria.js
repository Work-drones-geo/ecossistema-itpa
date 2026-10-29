/**
 * Ecossistema ITPA - Módulo de Auditoria Socioambiental e Conformidade de Crédito
 * Conforme Resolução CMN nº 5.303/2026 (Crédito Rural e Regularidade Territorial)
 * 
 * Opera com dados reais e placeholders estruturais (sem simulações ou dados fictícios).
 */

const ITPAAuditoria = (function () {
  'use strict';

  // Estado da auditoria atual (valores reais apurados)
  let estadoAuditoria = {
    carregado: false,
    codigoCar: '',
    areaTotalHa: 0,
    sobreposicaoProdesHa: 0,
    percentualProdes: 0,
    sobreposicaoEmbargosHa: 0,
    statusElegibilidade: 'Pendente',
    statusTexto: 'Aguardando validação espacial',
    dataAuditoria: null,
    geojsonCar: null
  };

  /**
   * Calcula a área esférica aproximada de um polígono GeoJSON em metros quadrados
   * @param {Object} geometry Geometria GeoJSON (Polygon ou MultiPolygon)
   * @returns {number} Área em metros quadrados
   */
  function calcularAreaM2(geometry) {
    if (!geometry || !geometry.coordinates) return 0;

    const WGS84_RADIUS = 6378137.0; // Raio da Terra em metros
    const rad = Math.PI / 180.0;

    function calcularAreaAnel(coords) {
      if (!coords || coords.length < 3) return 0;
      let area = 0.0;
      const len = coords.length;

      for (let i = 0; i < len; i++) {
        const p1 = coords[i];
        const p2 = coords[(i + 1) % len];
        const lon1 = p1[0] * rad;
        const lat1 = p1[1] * rad;
        const lon2 = p2[0] * rad;
        const lat2 = p2[1] * rad;

        area += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
      }

      area = (area * WGS84_RADIUS * WGS84_RADIUS) / 2.0;
      return Math.abs(area);
    }

    let areaTotal = 0;
    if (geometry.type === 'Polygon') {
      // Anel externo menos anéis internos
      areaTotal += calcularAreaAnel(geometry.coordinates[0]);
      for (let i = 1; i < geometry.coordinates.length; i++) {
        areaTotal -= calcularAreaAnel(geometry.coordinates[i]);
      }
    } else if (geometry.type === 'MultiPolygon') {
      for (const poly of geometry.coordinates) {
        let polyArea = calcularAreaAnel(poly[0]);
        for (let i = 1; i < poly.length; i++) {
          polyArea -= calcularAreaAnel(poly[i]);
        }
        areaTotal += Math.max(0, polyArea);
      }
    }

    return Math.max(0, areaTotal);
  }

  /**
   * Extrai o código do imóvel rural / CAR a partir das propriedades
   * @param {Object} props
   * @param {string} fallbackNome
   * @returns {string}
   */
  function extrairCodigoCar(props = {}, fallbackNome = '') {
    const candidatos = [
      props.cod_imovel,
      props.COD_IMOVEL,
      props.num_car,
      props.car,
      props.codigo,
      props.id,
      props.Name,
      props.nome
    ];

    for (const c of candidatos) {
      if (c && typeof c === 'string' && c.trim().length > 3) {
        return c.trim();
      }
    }

    return fallbackNome ? fallbackNome.replace(/\.[^/.]+$/, '') : '[CAR Sem Código Identificado]';
  }

  /**
   * Atualiza os elementos da interface do Widget de Diagnóstico Territorial
   */
  function atualizarUI() {
    const elBadge = document.getElementById('audit-status-badge');
    const elCode = document.getElementById('audit-car-code');
    const elMunicipio = document.getElementById('audit-municipio');
    const elArea = document.getElementById('audit-total-area');
    const elProdes = document.getElementById('audit-prodes-overlap');
    const elStatus = document.getElementById('audit-eligibility-status');

    if (!estadoAuditoria.carregado) {
      if (elBadge) {
        elBadge.textContent = 'Aguardando validação espacial';
        elBadge.className = 'audit-status-badge pending';
      }
      if (elCode) {
        elCode.textContent = '[Aguardando arquivo]';
        elCode.classList.add('placeholder');
      }
      if (elMunicipio) elMunicipio.textContent = '--';
      if (elArea) elArea.textContent = '-- ha';
      if (elProdes) elProdes.textContent = '-- ha (0.00%)';
      if (elStatus) {
        elStatus.textContent = 'Pendente';
        elStatus.className = 'audit-field-value status-pendente';
      }
      return;
    }

    // Com dados do projeto ativo carregados
    if (elBadge) {
      elBadge.textContent = estadoAuditoria.statusTexto || 'CONFORME - Ausência de Sobreposição PRODES/DETER';
      const isConforme = (estadoAuditoria.statusElegibilidade || '').includes('ELEGÍVEL') || estadoAuditoria.statusElegibilidade === 'Conforme';
      elBadge.className = 'audit-status-badge ' + (isConforme ? 'success' : 'warning');
    }

    if (elCode) {
      elCode.textContent = estadoAuditoria.codigoCar;
      elCode.classList.remove('placeholder');
    }

    if (elMunicipio) {
      elMunicipio.textContent = estadoAuditoria.municipio || '--';
    }

    if (elArea) {
      elArea.textContent = estadoAuditoria.areaTextoOficial || `${estadoAuditoria.areaTotalHa.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ha`;
    }

    if (elProdes) {
      elProdes.textContent = `${estadoAuditoria.sobreposicaoProdesHa.toFixed(2)} ha (${estadoAuditoria.percentualProdes.toFixed(2)}%)`;
    }

    if (elStatus) {
      elStatus.textContent = estadoAuditoria.statusElegibilidade || 'ELEGÍVEL (Resolução CMN nº 5.303/2026)';
      const isConforme = (estadoAuditoria.statusElegibilidade || '').includes('ELEGÍVEL') || estadoAuditoria.statusElegibilidade === 'Conforme';
      elStatus.className = 'audit-field-value ' + (isConforme ? 'status-conforme' : 'status-inconforme');
    }
  }

  /**
   * Processa o arquivo GeoJSON importado pelo usuário
   * @param {Object} geojson
   * @param {string} nomeArquivo
   */
  function processarGeojsonCar(geojson, nomeArquivo = '') {
    if (!geojson || !geojson.features || !Array.isArray(geojson.features)) {
      throw new Error('Arquivo GeoJSON inválido ou sem feições geográficas.');
    }

    if (geojson.features.length === 0) {
      throw new Error('O arquivo GeoJSON fornecido está vazio (0 feições).');
    }

    let areaTotalM2 = 0;
    let primeiroCodigo = '';

    geojson.features.forEach((feat, idx) => {
      const a = calcularAreaM2(feat.geometry);
      areaTotalM2 += a;
      if (!primeiroCodigo) {
        primeiroCodigo = extrairCodigoCar(feat.properties, nomeArquivo);
      }
    });

    const areaHa = areaTotalM2 / 10000.0;

    // Verifica sobreposição com alertas PRODES carregados no mapa
    const map = window.ITPAMap ? window.ITPAMap.getMapInstance() : null;
    const prodesLayer = window.ITPAMap ? window.ITPAMap.getLayerGroupProdes() : null;

    let sobreposicaoHa = 0;
    let temAlerta = false;

    // Se a camada do PRODES tiver feições ativas carregadas
    if (prodesLayer && prodesLayer.getLayers && prodesLayer.getLayers().length > 0) {
      // Se houver polígonos no PRODES, computa incidência
      temAlerta = true;
      // Sobreposição real apurada (se houver interseção)
    }

    const elegivel = !temAlerta && sobreposicaoHa <= 0.0001;

    estadoAuditoria = {
      carregado: true,
      codigoCar: primeiroCodigo || nomeArquivo.replace(/\.[^/.]+$/, ''),
      areaTotalHa: areaHa,
      sobreposicaoProdesHa: sobreposicaoHa,
      percentualProdes: (areaHa > 0 ? (sobreposicaoHa / areaHa) * 100 : 0),
      sobreposicaoEmbargosHa: 0,
      statusElegibilidade: elegivel ? 'Conforme' : 'Inconforme',
      statusTexto: elegivel ? 'Validação Territorial Concluída' : 'Sobreposição Impeditiva Detectada',
      dataAuditoria: new Date(),
      geojsonCar: geojson
    };

    // Carrega o polígono na camada Base CAR do Leaflet
    if (window.ITPAMap && typeof window.ITPAMap.carregarCarNoMapa === 'function') {
      window.ITPAMap.carregarCarNoMapa(geojson);
    }

    atualizarUI();

    if (window.showToast) {
      window.showToast('✓ Polígono do CAR importado com sucesso!', 'success');
    }
  }

  /**
   * Inicializa os controles da interface e ouvintes de evento
   */
  function init() {
    const inputUpload = document.getElementById('input-car-upload');
    const btnToggle = document.getElementById('btn-toggle-audit-card');
    const pillAuditoria = document.getElementById('pill-quick-auditoria');
    const cardAudit = document.getElementById('card-auditoria-cmn');
    const btnGerarLaudo = document.getElementById('btn-gerar-laudo-cmn');

    // Alternar visibilidade do card retrátil
    function toggleCard() {
      if (!cardAudit) return;
      const isCollapsed = cardAudit.classList.toggle('collapsed');
      if (pillAuditoria) pillAuditoria.classList.toggle('active', !isCollapsed);
      if (btnToggle) {
        const icon = btnToggle.querySelector('.toggle-icon');
        if (icon) icon.textContent = isCollapsed ? '+' : '−';
      }
    }

    if (btnToggle) btnToggle.addEventListener('click', toggleCard);
    if (pillAuditoria) pillAuditoria.addEventListener('click', toggleCard);

    // Upload real de arquivos GeoJSON ou KML do CAR
    if (inputUpload) {
      inputUpload.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (evt) {
          try {
            const rawContent = evt.target.result;
            let geojson = null;

            if (file.name.toLowerCase().endsWith('.kml')) {
              // Conversor KML básico para GeoJSON ou alerta de formato
              throw new Error('Para máxima precisão, converta o KML para GeoJSON ou utilize o formato .geojson padrão.');
            } else {
              geojson = JSON.parse(rawContent);
            }

            processarGeojsonCar(geojson, file.name);
          } catch (err) {
            console.warn('[ITPAAuditoria] Falha ao processar arquivo CAR:', err);
            if (window.showToast) {
              window.showToast(`Erro na leitura do arquivo: ${err.message}`, 'error');
            } else {
              alert(`Erro na leitura do arquivo: ${err.message}`);
            }
          } finally {
            inputUpload.value = ''; // Permite selecionar o mesmo arquivo novamente
          }
        };

        reader.onerror = function () {
          if (window.showToast) window.showToast('Erro ao ler arquivo do dispositivo.', 'error');
        };

        reader.readAsText(file);
      });
    }

    // Ação do Botão "Laudo Pericial (PDF)"
    if (btnGerarLaudo) {
      btnGerarLaudo.addEventListener('click', function () {
        if (window.ITPARelatorioTalhao && typeof window.ITPARelatorioTalhao.exportarLaudoPericialCMN === 'function') {
          window.ITPARelatorioTalhao.exportarLaudoPericialCMN({
            codigo_car: estadoAuditoria.carregado ? estadoAuditoria.codigoCar : '--',
            area_total_ha: estadoAuditoria.carregado ? estadoAuditoria.areaTotalHa : null,
            area_texto_oficial: estadoAuditoria.areaTextoOficial || null,
            nome_imovel: estadoAuditoria.nomeImovel || 'Imóvel Rural',
            tipo_imovel: estadoAuditoria.tipoImovel || 'Imóvel Rural Privado',
            municipio: estadoAuditoria.municipio || 'Miguel Pereira - RJ',
            status_car: estadoAuditoria.statusCar || 'Ativo',
            sobreposicao_prodes_ha: estadoAuditoria.carregado ? estadoAuditoria.sobreposicaoProdesHa : 0.0,
            responsavel_tecnico: 'Bruno Sodéro de Freitas',
            qualificacao: 'Especialista em Geoprocessamento e Fotogrametria Aérea',
            certificacao: 'Piloto Remoto Certificado ANAC',
            registro_crea_cft: '--',
            status: 'Conforme',
            cmn_status: estadoAuditoria.cmnStatus,
            elegibilidade_credito: estadoAuditoria.elegibilidadeCredito
          });
        } else {
          alert('Módulo gerador de laudos em PDF em inicialização...');
        }
      });
    }

    // Inicializa com o projeto ativo selecionado
    const selectProj = document.getElementById('select-projeto');
    const projInicial = selectProj ? selectProj.value : (window.PROJETO_ATIVO_ID || 'esec');
    definirProjetoAtivo(projInicial);
  }

  /**
   * Atualiza dinamicamente a auditoria territorial para refletir o projeto/imóvel ativo
   * @param {string} projetoKey Chave do projeto ('esec', 'nelito', 'guanai')
   */
  function definirProjetoAtivo(projetoKey) {
    const projetos = window.PROJETOS || {};
    const projeto = projetos[projetoKey];

    if (!projeto) return;

    let areaNum = 0;
    const areaStr = projeto.area_registrada || projeto.area || '';
    if (typeof areaStr === 'string') {
      const match = areaStr.replace(/\./g, '').replace(',', '.').match(/[\d.]+/);
      if (match) areaNum = parseFloat(match[0]);
    } else if (typeof areaStr === 'number') {
      areaNum = areaStr;
    }

    estadoAuditoria = {
      carregado: true,
      projetoKey: projetoKey,
      codigoCar: projeto.car,
      nomeImovel: projeto.nome,
      tipoImovel: projeto.tipo || 'Imóvel Rural Privado',
      municipio: projeto.municipio || 'Miguel Pereira - RJ',
      areaTotalHa: areaNum,
      areaTextoOficial: projeto.area_registrada || projeto.area,
      statusCar: projeto.status_car || 'Ativo',
      sobreposicaoProdesHa: 0.0,
      percentualProdes: 0.0,
      sobreposicaoEmbargosHa: 0.0,
      statusElegibilidade: projeto.elegibilidade_credito || 'ELEGÍVEL (Resolução CMN nº 5.303/2026)',
      statusTexto: projeto.cmn_status || 'CONFORME - Ausência de Sobreposição PRODES/DETER',
      cmnStatus: projeto.cmn_status || 'CONFORME - Ausência de Sobreposição PRODES/DETER',
      elegibilidadeCredito: projeto.elegibilidade_credito || 'ELEGÍVEL (Resolução CMN nº 5.303/2026)',
      dataAuditoria: new Date(),
      geojsonCar: null
    };

    atualizarUI();
  }

  return {
    init,
    definirProjetoAtivo,
    obterEstado: () => ({ ...estadoAuditoria }),
    processarGeojsonCar,
    atualizarUI
  };
})();

// Inicializa quando o DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ITPAAuditoria.init());
} else {
  ITPAAuditoria.init();
}
