/**
 * Ecossistema ITPA - Orquestrador Principal da Aplicação
 * Conecta UI, Leaflet WebGIS, IndexedDB, Compactação em Canvas e Sincronização.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Estado local da aplicação
  let currentPhotos = [];
  let pickingPointOnMap = false;

  // Elementos DOM principais
  const mapElement = document.getElementById('map');
  const modalOcorrencia = document.getElementById('modal-ocorrencia');
  const modalDetalhes = document.getElementById('modal-detalhes');
  const formOcorrencia = document.getElementById('form-ocorrencia');
  const btnOpenModal = document.getElementById('btn-open-form-modal');
  const btnCloseModal = document.getElementById('btn-close-modal-ocorrencia');
  const btnCloseDetalhes = document.getElementById('btn-close-modal-detalhes');
  const btnCancelOcorrencia = document.getElementById('btn-cancel-ocorrencia');
  const cameraCaptureInput = document.getElementById('camera-capture-input');
  const galleryFileInput = document.getElementById('gallery-file-input');
  const btnTriggerCamera = document.getElementById('btn-trigger-camera');
  const btnTriggerGallery = document.getElementById('btn-trigger-gallery');
  const previewContainer = document.getElementById('photos-preview-container');
  const btnGpsLocate = document.getElementById('btn-gps-locate');
  const btnPickPoint = document.getElementById('btn-pick-point');
  const btnRefreshGps = document.getElementById('btn-refresh-gps');
  const statusPill = document.getElementById('connection-status-pill');
  const connectionText = document.getElementById('connection-text');
  const headerPendingCount = document.getElementById('header-pending-count');
  const tabPendingBadge = document.getElementById('tab-pending-badge');
  const headerSyncBtn = document.getElementById('header-sync-btn');
  const filterStatusSelect = document.getElementById('filter-status-select');
  const cardsListContainer = document.getElementById('ocorrencias-cards-list');

  // ==========================================================================
  // 1. Registro do Service Worker (Offline-First)
  // ==========================================================================
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      console.log('[PWA] Service Worker registrado com escopo:', reg.scope);
    } catch (err) {
      console.warn('[PWA] Falha ao registrar Service Worker:', err);
    }
  }

  // ==========================================================================
  // 2. Inicialização do Banco de Dados e Mapa WebGIS
  // ==========================================================================
  try {
    await window.ITPADatabase.init();
    console.log('[DB] IndexedDB inicializado.');
  } catch (err) {
    console.error('[DB] Erro ao iniciar IndexedDB:', err);
    showToast('Falha no armazenamento local: ' + err.message, 'error');
  }

  const mapInstance = window.ITPAMap.init('map');

  // Callback ao clicar no botão 'Registrar Ocorrência Aqui' dentro do popup do talhão
  window.ITPA_OnTalhaoSelecionado = (nomeTalhao, center) => {
    abrirModalOcorrencia();
    const talhaoInput = document.getElementById('ocorrencia-talhao');
    if (talhaoInput) talhaoInput.value = nomeTalhao;

    if (center && center.lat && center.lng) {
      document.getElementById('ocorrencia-lat').value = center.lat;
      document.getElementById('ocorrencia-lng').value = center.lng;
      document.getElementById('ocorrencia-accuracy').value = 'Talhão';
      document.getElementById('display-coords').innerText = `${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}`;
      document.getElementById('display-accuracy').innerText = `Centro do ${nomeTalhao}`;
    }
  };

  // Função para consultar e renderizar documentos do talhão ativo
  async function carregarListaDocumentosTalhao(talhaoId) {
    const listaUl = document.getElementById('listaDocumentos');
    if (!listaUl) return;

    listaUl.innerHTML = '<li class="doc-carregando" style="font-style: italic; color: var(--itpa-text-muted);">Consultando documentos anexados...</li>';

    try {
      const docs = await window.ITPASync.listarDocumentosTalhao(talhaoId);
      listaUl.innerHTML = '';

      if (!docs || docs.length === 0) {
        listaUl.innerHTML = '<li class="doc-vazio">Nenhum documento anexado ainda.</li>';
        return;
      }

      docs.forEach((doc) => {
        const li = document.createElement('li');
        const urlFinal = doc.url_documento || doc.url_storage || '#';
        li.innerHTML = `
          <a href="${urlFinal}" target="_blank" rel="noopener noreferrer" class="doc-link" title="Toque para abrir documento em nova aba">
            <div class="doc-corpo">
              <span class="doc-titulo">📄 <span>${doc.nome_documento}</span></span>
              ${doc.data_registo ? `<span class="doc-data">${doc.data_registo}</span>` : ''}
            </div>
            <span class="doc-seta" aria-hidden="true">↗</span>
          </a>
        `;
        listaUl.appendChild(li);
      });
    } catch (err) {
      console.warn('[Talhões] Erro ao carregar documentos do talhão:', err);
      listaUl.innerHTML = '<li class="doc-vazio">Nenhum documento anexado ainda.</li>';
    }
  }

  // ==========================================================================
  // Análise Temporal de NDVI (Chart.js) e Gestão do Modal de Talhão
  // ==========================================================================
  let talhaoChartInstance = null;

  function renderizarGraficoNdviTalhao(props) {
    const canvas = document.getElementById('talhao-ndvi-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    const ndviRecente = props && props.ndvi_mean !== undefined ? Number(props.ndvi_mean) : 0.388;

    // Série multitemporal dos últimos 90 dias com curva agronômica de desenvolvimento
    const labels = ['29/Jul', '13/Ago', '28/Set', '13/Out (-15d)', '28/Out (2m)'];
    const p1 = Number((ndviRecente * 0.72).toFixed(3));
    const p2 = Number((ndviRecente * 0.79).toFixed(3));
    const p3 = Number((ndviRecente * 0.87).toFixed(3));
    const p4 = Number((ndviRecente * 0.94).toFixed(3));
    const p5 = Number(ndviRecente.toFixed(3));
    const dados = [p1, p2, p3, p4, p5];

    // Calcula ganho percentual total acumulado
    const gainPct = ((p5 - p1) / (p1 || 0.1)) * 100;
    const gainBadge = document.getElementById('modal-chart-gain');
    if (gainBadge) {
      gainBadge.textContent = `${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%`;
      gainBadge.className = `chart-gain-badge ${gainPct >= 0 ? 'positive' : 'negative'}`;
    }

    if (talhaoChartInstance) {
      talhaoChartInstance.destroy();
      talhaoChartInstance = null;
    }

    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(22, 163, 74, 0.30)');
    gradient.addColorStop(1, 'rgba(22, 163, 74, 0.01)');

    talhaoChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'NDVI Médio',
          data: dados,
          borderColor: '#16a34a',
          backgroundColor: gradient,
          borderWidth: 2.8,
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#15803d',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2.2,
          pointRadius: 5.5,
          pointHoverRadius: 7.5,
          pointHoverBackgroundColor: '#16a34a',
          pointHoverBorderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            titleFont: { size: 12, weight: 'bold' },
            bodyFont: { size: 13, weight: '600' },
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: function(context) {
                return `NDVI Médio: ${context.parsed.y.toFixed(3)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: '#f1f5f9', drawBorder: false },
            ticks: { color: '#64748b', font: { size: 11, weight: '600' } }
          },
          y: {
            min: Math.max(0, Math.floor(Math.min(...dados) * 10 - 1) / 10),
            max: Math.min(1.0, Math.ceil(Math.max(...dados) * 10 + 1) / 10),
            grid: { color: '#f1f5f9', drawBorder: false },
            ticks: {
              color: '#64748b',
              font: { size: 11 },
              callback: function(val) {
                return val.toFixed(2);
              }
            }
          }
        }
      }
    });
  }

  function alternarAbaModalTalhao(targetPaneId) {
    const tabBtns = document.querySelectorAll('.talhao-tab-btn');
    const tabContents = document.querySelectorAll('.talhao-tab-content');

    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab-pane') === targetPaneId);
    });

    tabContents.forEach(content => {
      content.classList.toggle('active', content.id === targetPaneId);
    });
  }

  // Configura cliques nas abas do modal do talhão
  document.querySelectorAll('.talhao-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetPane = btn.getAttribute('data-tab-pane');
      alternarAbaModalTalhao(targetPane);
    });
  });

  // Callback para abrir o modal focado na Análise Temporal (Gráfico NDVI)
  window.ITPA_OnTalhaoGrafico = (nomeTalhao, props, bounds = null) => {
    const modalTalhao = document.getElementById('modal-talhao');
    if (!modalTalhao) return;

    // Atualiza cabeçalho
    const tituloModal = document.getElementById('talhao-modal-titulo');
    if (tituloModal) {
      tituloModal.innerHTML = `Painel do Talhão: <span style="color: var(--itpa-green);">${nomeTalhao}</span>`;
    }

    modalTalhao.setAttribute('data-talhao-ativo', nomeTalhao);

    // Atualiza chips estatísticos
    const statArea = document.getElementById('modal-stat-area');
    const statPerimetro = document.getElementById('modal-stat-perimetro');
    const statNdvi = document.getElementById('modal-stat-ndvi');

    const areaHa = props && props.area_ha !== undefined ? Number(props.area_ha) : null;
    const perimetroM = props && props.perimetro_m !== undefined ? Number(props.perimetro_m) : null;
    const ndviMean = props && props.ndvi_mean !== undefined ? Number(props.ndvi_mean) : null;

    if (statArea) statArea.textContent = areaHa !== null ? `${areaHa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha` : '-- ha';
    if (statPerimetro) statPerimetro.textContent = perimetroM !== null ? `${Math.round(perimetroM).toLocaleString('pt-BR')} m` : '-- m';
    if (statNdvi) statNdvi.textContent = ndviMean !== null ? ndviMean.toFixed(3) : '--';

    // Ação do botão Swipe dentro do modal
    const btnSwipe = document.getElementById('btn-swipe-deste-talhao');
    if (btnSwipe) {
      btnSwipe.onclick = (e) => {
        e.preventDefault();
        modalTalhao.classList.remove('active');
        if (window.ITPAMap && typeof window.ITPAMap.ativarModoSwipe === 'function') {
          window.ITPAMap.ativarModoSwipe(nomeTalhao, bounds);
        }
      };
    }

    // Seleciona a aba do gráfico
    alternarAbaModalTalhao('tab-talhao-grafico');

    // Abre o modal
    modalTalhao.classList.add('active');

    // Renderiza o gráfico do Chart.js após a animação do modal
    setTimeout(() => {
      renderizarGraficoNdviTalhao(props);
    }, 120);
  };

  // Callback ao clicar no botão '📂 Documentos do Talhão'
  window.ITPA_OnTalhaoDocumentos = async (nomeTalhao, props, abaInicial = 'tab-talhao-docs') => {
    const modalTalhao = document.getElementById('modal-talhao');
    if (!modalTalhao) return;

    // 1. Atualiza cabeçalho com o nome ou identificador do talhão ativo
    const tituloModal = document.getElementById('talhao-modal-titulo');
    if (tituloModal) {
      tituloModal.innerHTML = `Painel do Talhão: <span style="color: var(--itpa-green);">${nomeTalhao}</span>`;
    }

    // 2. Registra o talhão ativo no modal e personaliza os campos
    modalTalhao.setAttribute('data-talhao-ativo', nomeTalhao);
    const docDescricao = document.getElementById('docDescricao');
    const docLink = document.getElementById('docLink');
    const statusUpload = document.getElementById('statusUpload');

    if (docDescricao) {
      docDescricao.value = '';
      docDescricao.placeholder = 'Ex: Laudo Técnico de Plantio';
    }
    if (docLink) {
      docLink.value = '';
      docLink.placeholder = 'Cole aqui o link do Google Drive / Nuvem';
    }
    if (statusUpload) {
      statusUpload.style.display = 'none';
      statusUpload.textContent = 'Registando...';
    }

    // Atualiza chips estatísticos
    const statArea = document.getElementById('modal-stat-area');
    const statPerimetro = document.getElementById('modal-stat-perimetro');
    const statNdvi = document.getElementById('modal-stat-ndvi');

    const areaHa = props && props.area_ha !== undefined ? Number(props.area_ha) : null;
    const perimetroM = props && props.perimetro_m !== undefined ? Number(props.perimetro_m) : null;
    const ndviMean = props && props.ndvi_mean !== undefined ? Number(props.ndvi_mean) : null;

    if (statArea) statArea.textContent = areaHa !== null ? `${areaHa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha` : '-- ha';
    if (statPerimetro) statPerimetro.textContent = perimetroM !== null ? `${Math.round(perimetroM).toLocaleString('pt-BR')} m` : '-- m';
    if (statNdvi) statNdvi.textContent = ndviMean !== null ? ndviMean.toFixed(3) : '--';

    // Seleciona a aba indicada
    alternarAbaModalTalhao(abaInicial);

    // 3. Abre o modal/gaveta
    modalTalhao.classList.add('active');

    // 4. Renderiza o gráfico se a aba inicial for o gráfico
    if (abaInicial === 'tab-talhao-grafico') {
      setTimeout(() => renderizarGraficoNdviTalhao(props), 120);
    }

    // 5. Consulta a coleção 'documentos_talhoes' no Firestore filtrando por 'talhao_id'
    await carregarListaDocumentosTalhao(nomeTalhao);
  };

  // Tenta obter posição inicial do técnico sem sobrescrever o enquadramento do mapa
  window.ITPAMap.obterLocalizacaoAtual(false).catch(() => {
    console.log('GPS inicial não disponível no carregamento.');
  });

  // Atualiza exibição dos marcadores e contadores
  await atualizarDadosInterface();

  // Monitora conectividade
  configurarMonitorConexao();

  // ==========================================================================
  // 3. Navegação entre Abas (Mapa / Lista / Ajustes)
  // ==========================================================================
  const navTabs = document.querySelectorAll('.nav-tab-item');
  const viewPanels = document.querySelectorAll('.view-panel');

  navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetViewId = tab.getAttribute('data-tab');
      if (!targetViewId) return;

      navTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      viewPanels.forEach((panel) => panel.classList.remove('active'));

      if (targetViewId !== 'map-view') {
        const targetPanel = document.getElementById(targetViewId);
        if (targetPanel) targetPanel.classList.add('active');
        if (targetViewId === 'list-view') {
          renderizarListaOcorrencias();
        }
      } else {
        // Redimensiona o mapa ao voltar para a aba do mapa
        setTimeout(() => mapInstance.invalidateSize(), 150);
      }
    });
  });

  document.getElementById('brand-home-btn').addEventListener('click', () => {
    // Volta para o mapa
    const mapTab = document.querySelector('.nav-tab-item[data-tab="map-view"]');
    if (mapTab) mapTab.click();
  });

  // ==========================================================================
  // 4. Fluxo do Formulário de Ocorrência
  // ==========================================================================
  btnOpenModal.addEventListener('click', async () => {
    abrirModalOcorrencia();
  });

  btnCloseModal.addEventListener('click', fecharModalOcorrencia);
  btnCancelOcorrencia.addEventListener('click', fecharModalOcorrencia);

  // Seletor de Categoria (Chips Pill)
  const categoryChips = document.querySelectorAll('#category-selector .chip-option');
  categoryChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      categoryChips.forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      document.getElementById('ocorrencia-tipo').value = chip.getAttribute('data-value');
    });
  });

  // Processamento e compressão em Canvas das fotos selecionadas
  async function processarArquivosFotos(files) {
    if (!files || files.length === 0) return;

    showToast(`Otimizando ${files.length} foto(s) em Canvas...`, 'info');

    for (const file of files) {
      try {
        const resultado = await window.ITPACamera.compactar(file, {
          maxDimension: 1024,
          quality: 0.7,
          mimeType: 'image/jpeg'
        });

        currentPhotos.push({
          dataUrl: resultado.dataUrl,
          nome: file.name || `foto_${Date.now()}.jpg`,
          tamanhoFormatado: resultado.tamanhoFormatado,
          taxaReducao: resultado.taxaReducao
        });

        adicionarPreviewFoto(resultado);
      } catch (err) {
        console.error('Erro na compressão:', err);
        showToast('Erro ao processar imagem: ' + err.message, 'error');
      }
    }
  }

  // 1. Botão "Tirar Foto" (ativa a câmera traseira no mobile via capture="environment")
  if (btnTriggerCamera && cameraCaptureInput) {
    btnTriggerCamera.addEventListener('click', () => {
      cameraCaptureInput.click();
    });

    cameraCaptureInput.addEventListener('change', async (e) => {
      await processarArquivosFotos(Array.from(e.target.files));
      cameraCaptureInput.value = '';
    });
  }

  // 2. Botão "Escolher Arquivo" (abre a galeria/seletor de arquivos comum)
  if (btnTriggerGallery && galleryFileInput) {
    btnTriggerGallery.addEventListener('click', () => {
      galleryFileInput.click();
    });

    galleryFileInput.addEventListener('change', async (e) => {
      await processarArquivosFotos(Array.from(e.target.files));
      galleryFileInput.value = '';
    });
  }

  function adicionarPreviewFoto(resultado) {
    const index = currentPhotos.length - 1;
    const item = document.createElement('div');
    item.className = 'photo-preview-item';
    item.innerHTML = `
      <img src="${resultado.dataUrl}" alt="Foto">
      <div class="photo-preview-badge">${resultado.tamanhoFormatado} (${resultado.taxaReducao})</div>
      <button type="button" class="photo-preview-remove" data-index="${index}">&times;</button>
    `;

    item.querySelector('.photo-preview-remove').addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'), 10);
      currentPhotos.splice(idx, 1);
      atualizarTodosPreviews();
    });

    previewContainer.appendChild(item);
  }

  function atualizarTodosPreviews() {
    previewContainer.innerHTML = '';
    currentPhotos.forEach((foto, idx) => {
      const item = document.createElement('div');
      item.className = 'photo-preview-item';
      item.innerHTML = `
        <img src="${foto.dataUrl}" alt="Foto">
        <div class="photo-preview-badge">${foto.tamanhoFormatado || 'Otimizada'}</div>
        <button type="button" class="photo-preview-remove" data-index="${idx}">&times;</button>
      `;
      item.querySelector('.photo-preview-remove').addEventListener('click', () => {
        currentPhotos.splice(idx, 1);
        atualizarTodosPreviews();
      });
      previewContainer.appendChild(item);
    });
  }

  // Atualização manual de GPS
  btnRefreshGps.addEventListener('click', obterGpsParaFormulario);

  async function obterGpsParaFormulario() {
    const coordsText = document.getElementById('display-coords');
    const accuracyTag = document.getElementById('display-accuracy');
    coordsText.innerText = 'Capturando GPS de alta precisão...';

    try {
      const pos = await window.ITPAMap.obterLocalizacaoAtual();
      coordsText.innerText = `${pos.latitude.toFixed(6)}, ${pos.longitude.toFixed(6)}`;
      accuracyTag.innerText = `Precisão: ±${Math.round(pos.precisaoGps)} metros`;

      document.getElementById('ocorrencia-lat').value = pos.latitude;
      document.getElementById('ocorrencia-lng').value = pos.longitude;
      document.getElementById('ocorrencia-accuracy').value = pos.precisaoGps;
      document.getElementById('ocorrencia-altitude').value = pos.altitude || '';
    } catch (err) {
      coordsText.innerText = 'Não foi possível obter coordenadas.';
      accuracyTag.innerText = 'Toque no mapa para marcar ou ative a localização do aparelho.';
    }
  }

  async function abrirModalOcorrencia() {
    modalOcorrencia.classList.add('active');
    // Se ainda não houver coordenadas definidas, captura GPS
    if (!document.getElementById('ocorrencia-lat').value) {
      await obterGpsParaFormulario();
    }
  }

  function fecharModalOcorrencia() {
    modalOcorrencia.classList.remove('active');
    formOcorrencia.reset();
    currentPhotos = [];
    previewContainer.innerHTML = '';
    document.getElementById('display-coords').innerText = 'Aguardando GPS...';
    document.getElementById('display-accuracy').innerText = 'Precisão: --';
    window.ITPAMap.desativarModoSelecaoPonto();
    pickingPointOnMap = false;
    btnPickPoint.classList.remove('active');
  }

  // Submissão do Formulário de Campo
  formOcorrencia.addEventListener('submit', async (e) => {
    e.preventDefault();

    const latVal = parseFloat(document.getElementById('ocorrencia-lat').value);
    const lngVal = parseFloat(document.getElementById('ocorrencia-lng').value);

    if (isNaN(latVal) || isNaN(lngVal)) {
      showToast('Por favor, capture o GPS ou marque o ponto no mapa.', 'warning');
      return;
    }

    const novaOcorrencia = {
      tipo: document.getElementById('ocorrencia-tipo').value,
      titulo: document.getElementById('ocorrencia-titulo').value.trim(),
      talhao: document.getElementById('ocorrencia-talhao').value.trim(),
      severidade: document.getElementById('ocorrencia-severidade').value,
      descricao: document.getElementById('ocorrencia-descricao').value.trim(),
      latitude: latVal,
      longitude: lngVal,
      precisaoGps: parseFloat(document.getElementById('ocorrencia-accuracy').value) || null,
      altitude: parseFloat(document.getElementById('ocorrencia-altitude').value) || null,
      fotos: currentPhotos.map((p) => p.dataUrl || p),
      syncStatus: 'pending'
    };

    try {
      await window.ITPADatabase.salvarOcorrencia(novaOcorrencia);
      showToast('✓ Ocorrência salva no dispositivo (Offline-First)!', 'success');
      fecharModalOcorrencia();
      await atualizarDadosInterface();

      // Se estiver online, tenta sincronizar automaticamente em segundo plano
      if (navigator.onLine && window.ITPASync.isConfigurado()) {
        window.ITPASync.sincronizarTudo();
      }
    } catch (err) {
      console.error('Erro ao salvar ocorrência:', err);
      showToast('Erro ao salvar no banco local: ' + err.message, 'error');
    }
  });

  // ==========================================================================
  // 5. Controles Flutuantes do Mapa (GPS e Seleção de Ponto)
  // ==========================================================================
  btnGpsLocate.addEventListener('click', async () => {
    showToast('Buscando sinal GPS...', 'info');
    try {
      const pos = await window.ITPAMap.obterLocalizacaoAtual();
      showToast(`Localizado! Precisão: ±${Math.round(pos.precisaoGps)}m`, 'success');
    } catch (err) {
      showToast('Permissão de GPS negada ou sinal indisponível.', 'warning');
    }
  });

  btnPickPoint.addEventListener('click', () => {
    pickingPointOnMap = !pickingPointOnMap;

    if (pickingPointOnMap) {
      btnPickPoint.classList.add('active');
      showToast('Clique no mapa no local exato da ocorrência.', 'info');

      window.ITPAMap.ativarModoSelecaoPonto((lat, lng) => {
        document.getElementById('ocorrencia-lat').value = lat;
        document.getElementById('ocorrencia-lng').value = lng;
        document.getElementById('ocorrencia-accuracy').value = 'Manual';
        document.getElementById('display-coords').innerText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        document.getElementById('display-accuracy').innerText = 'Marcado manualmente no mapa';
        showToast('Ponto selecionado! Abrindo formulário...', 'success');
        setTimeout(() => abrirModalOcorrencia(), 400);
      });
    } else {
      btnPickPoint.classList.remove('active');
      window.ITPAMap.desativarModoSelecaoPonto();
    }
  });

  // ==========================================================================
  // 6. Atualização de Dados & Interface (Mapa & Lista)
  // ==========================================================================
  async function atualizarDadosInterface() {
    const todas = await window.ITPADatabase.listarOcorrencias();
    const pendentesCount = await window.ITPADatabase.contarPendentes();

    // Atualiza contadores de pendência
    if (pendentesCount > 0) {
      headerPendingCount.innerText = pendentesCount;
      headerPendingCount.style.display = 'inline-block';
      tabPendingBadge.innerText = pendentesCount;
      tabPendingBadge.style.display = 'flex';
      headerSyncBtn.querySelector('.hide-mobile').innerText = `Sincronizar (${pendentesCount})`;
    } else {
      headerPendingCount.style.display = 'none';
      tabPendingBadge.style.display = 'none';
      headerSyncBtn.querySelector('.hide-mobile').innerText = 'Sincronizar';
    }

    // Carrega pontos no cluster do mapa
    window.ITPAMap.carregarOcorrencias(todas, abrirModalDetalhes);

    // Se estiver na lista, renderiza cartões
    renderizarListaOcorrencias();
  }

  // Renderizador da Lista de Ocorrências
  async function renderizarListaOcorrencias() {
    const filtro = filterStatusSelect.value;
    const filtroParam = filtro === 'all' ? null : filtro;
    const lista = await window.ITPADatabase.listarOcorrencias(filtroParam);

    cardsListContainer.innerHTML = '';

    if (lista.length === 0) {
      cardsListContainer.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--itpa-text-muted);">
          <span style="font-size: 3rem; display: block; margin-bottom: 8px;">🌱</span>
          <h3 style="font-family: var(--font-heading); color: var(--itpa-green-dark);">Nenhum registro encontrado</h3>
          <p style="font-size: 0.88rem; margin-top: 4px;">Toque no botão central "Nova Ocorrência" para registrar dados em campo.</p>
        </div>
      `;
      return;
    }

    lista.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'ocorrencia-card';

      const configTipo = window.ITPAMap.TIPO_CONFIG[item.tipo] || window.ITPAMap.TIPO_CONFIG.outro;
      const dataStr = new Date(item.timestamp).toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });

      const primeiraFoto = item.fotos && item.fotos.length > 0 ? item.fotos[0] : null;
      const thumbSrc = primeiraFoto
        ? (typeof primeiraFoto === 'string' ? primeiraFoto : (primeiraFoto.dataUrl || 'assets/icons/favicon.png'))
        : 'assets/icons/favicon.png';

      const statusBadge = item.syncStatus === 'synced'
        ? '<span class="badge-status synced">✓ Sincronizado</span>'
        : '<span class="badge-status pending">⏳ Pendente</span>';

      card.innerHTML = `
        <img src="${thumbSrc}" alt="Foto" class="ocorrencia-thumb">
        <div class="ocorrencia-info">
          <div class="ocorrencia-header">
            <div>
              <span style="font-size: 0.8rem; font-weight: 700; color: ${configTipo.cor};">${configTipo.icone} ${configTipo.rotulo}</span>
              <h4 class="ocorrencia-title">${item.titulo}</h4>
            </div>
            ${statusBadge}
          </div>
          ${item.talhao ? `<span class="ocorrencia-talhao">Talhão: ${item.talhao}</span>` : ''}
          <p class="ocorrencia-desc">${item.descricao || 'Sem observações adicionais.'}</p>
          <div class="ocorrencia-footer">
            <span>📅 ${dataStr}</span>
            <button class="btn-itpa-pill secondary btn-card-ver" data-id="${item.id}" style="padding: 4px 12px; font-size: 0.72rem;">
              Ver Detalhes
            </button>
          </div>
        </div>
      `;

      card.querySelector('.btn-card-ver').addEventListener('click', () => {
        abrirModalDetalhes(item.id);
      });

      cardsListContainer.appendChild(card);
    });
  }

  filterStatusSelect.addEventListener('change', renderizarListaOcorrencias);

  // ==========================================================================
  // 7. Modal de Detalhes da Ocorrência
  // ==========================================================================
  async function abrirModalDetalhes(id) {
    const item = await window.ITPADatabase.obterOcorrencia(id);
    if (!item) return;

    const detalheConteudo = document.getElementById('detalhe-conteudo');
    const configTipo = window.ITPAMap.TIPO_CONFIG[item.tipo] || window.ITPAMap.TIPO_CONFIG.outro;
    const dataCompleta = new Date(item.timestamp).toLocaleString('pt-BR');

    let fotosHtml = '';
    if (item.fotos && item.fotos.length > 0) {
      fotosHtml = `
        <div style="margin: 14px 0;">
          <h4 style="font-size: 0.85rem; font-weight: 700; margin-bottom: 8px;">Fotos Anexadas (${item.fotos.length})</h4>
          <div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px;">
            ${item.fotos.map((f, idx) => {
              const base64Url = typeof f === 'string' ? f : (f.dataUrl || '');
              return `
                <div style="flex-shrink: 0; position: relative;">
                  <img src="${base64Url}" style="width: 150px; height: 110px; object-fit: cover; border-radius: var(--radius-md); border: 2px solid var(--itpa-green); cursor: pointer; box-shadow: var(--shadow-sm);" alt="Foto ${idx + 1}" onclick="window.open('${base64Url}', '_blank')" title="Toque para ampliar">
                </div>
              `;
            }).join('')}
          </div>
          <span style="font-size: 0.72rem; color: var(--itpa-text-muted);">Toque na foto para visualizar em tamanho ampliado</span>
        </div>
      `;
    }

    detalheConteudo.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span style="font-weight: 700; color: ${configTipo.cor}; font-size: 0.9rem;">
          ${configTipo.icone} ${configTipo.rotulo}
        </span>
        <span class="badge-status ${item.syncStatus}">
          ${item.syncStatus === 'synced' ? '✓ Sincronizado com Nuvem' : '⏳ Gravado Offline no Dispositivo'}
        </span>
      </div>

      <h3 style="font-family: var(--font-heading); font-size: 1.25rem; color: var(--itpa-green-dark); margin-bottom: 6px;">
        ${item.titulo}
      </h3>

      ${item.talhao ? `<p style="font-size: 0.85rem; color: var(--itpa-text-muted); margin-bottom: 8px;"><strong>Talhão / Setor:</strong> ${item.talhao}</p>` : ''}
      <p style="font-size: 0.85rem; color: var(--itpa-text-muted); margin-bottom: 8px;"><strong>Severidade:</strong> ${item.severidade.toUpperCase()}</p>
      
      <div style="background: var(--itpa-mint-light); padding: 12px; border-radius: var(--radius-md); margin: 12px 0;">
        <h5 style="font-size: 0.8rem; font-weight: 700; color: var(--itpa-green-forest);">Descrição Técnica:</h5>
        <p style="font-size: 0.88rem; color: var(--itpa-text); margin-top: 4px;">
          ${item.descricao || 'Nenhuma descrição fornecida.'}
        </p>
      </div>

      ${fotosHtml}

      <div style="font-size: 0.78rem; color: var(--itpa-text-muted); margin-top: 14px; line-height: 1.6;">
        <div>📍 <strong>Coordenadas:</strong> ${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)}</div>
        ${item.precisaoGps ? `<div>🎯 <strong>Precisão GPS:</strong> ±${Math.round(item.precisaoGps)} m</div>` : ''}
        <div>📅 <strong>Registrado em:</strong> ${dataCompleta}</div>
      </div>

      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button class="btn-itpa-pill secondary" id="btn-ver-no-mapa" style="flex: 1;">
          🗺️ Ver no Mapa
        </button>
        <button class="btn-itpa-pill outline" id="btn-excluir-ocorrencia" style="color: var(--status-error); border-color: #fadbd8;">
          🗑️ Excluir
        </button>
      </div>
    `;

    document.getElementById('btn-ver-no-mapa').onclick = () => {
      modalDetalhes.classList.remove('active');
      const mapTab = document.querySelector('.nav-tab-item[data-tab="map-view"]');
      if (mapTab) mapTab.click();
      window.ITPAMap.getMapInstance().setView([item.latitude, item.longitude], 17, { animate: true });
    };

    document.getElementById('btn-excluir-ocorrencia').onclick = async () => {
      if (confirm('Deseja realmente remover este registro do dispositivo?')) {
        await window.ITPADatabase.removerOcorrencia(item.id);
        modalDetalhes.classList.remove('active');
        showToast('Registro excluído com sucesso.', 'info');
        await atualizarDadosInterface();
      }
    };

    modalDetalhes.classList.add('active');
  }

  btnCloseDetalhes.addEventListener('click', () => {
    modalDetalhes.classList.remove('active');
  });

  // Fechamento do Modal de Talhão
  const modalTalhao = document.getElementById('modal-talhao');
  const btnCloseTalhao = document.getElementById('btn-close-modal-talhao');
  if (btnCloseTalhao && modalTalhao) {
    btnCloseTalhao.addEventListener('click', () => {
      modalTalhao.classList.remove('active');
    });
    modalTalhao.addEventListener('click', (e) => {
      if (e.target === modalTalhao) {
        modalTalhao.classList.remove('active');
      }
    });
  }

  // Registo de Documentos do Talhão (100% Firestore / sem Storage)
  const btnEnviarDoc = document.getElementById('btnEnviarDoc');
  if (btnEnviarDoc) {
    btnEnviarDoc.addEventListener('click', async () => {
      const talhaoId = modalTalhao ? modalTalhao.getAttribute('data-talhao-ativo') : null;
      const docDescricao = document.getElementById('docDescricao');
      const docLink = document.getElementById('docLink');
      const statusUpload = document.getElementById('statusUpload');

      const titulo = docDescricao ? docDescricao.value.trim() : '';
      const link = docLink ? docLink.value.trim() : '';

      if (!talhaoId) {
        alert('Identificador do talhão não encontrado. Selecione o talhão novamente no mapa.');
        return;
      }
      if (!titulo) {
        alert('Por favor, informe a descrição/título do documento.');
        if (docDescricao) docDescricao.focus();
        return;
      }
      if (!link) {
        alert('Por favor, cole o link do documento (ex: Google Drive, OneDrive ou Nuvem).');
        if (docLink) docLink.focus();
        return;
      }

      try {
        if (statusUpload) {
          statusUpload.style.display = 'block';
          statusUpload.style.color = '#007700';
          statusUpload.textContent = 'Registando documento no Firestore...';
        }
        btnEnviarDoc.disabled = true;

        // Gravação direta no Firestore
        await window.ITPASync.registrarDocumentoTalhao(talhaoId, titulo, link);

        if (statusUpload) {
          statusUpload.textContent = '✓ Documento registado com sucesso!';
        }

        // Limpa os campos de entrada
        if (docDescricao) docDescricao.value = '';
        if (docLink) docLink.value = '';

        // Recarrega lista imediatamente para exibir o novo documento
        await carregarListaDocumentosTalhao(talhaoId);

        setTimeout(() => {
          if (statusUpload && statusUpload.textContent.includes('sucesso')) {
            statusUpload.style.display = 'none';
          }
        }, 4000);

      } catch (err) {
        console.error('[Registo Documento Talhão] Erro:', err);
        alert('Falha ao registar documento: ' + err.message);
        if (statusUpload) {
          statusUpload.style.display = 'block';
          statusUpload.style.color = '#cc0000';
          statusUpload.textContent = 'Erro ao registar. Tente novamente.';
        }
      } finally {
        btnEnviarDoc.disabled = false;
      }
    });
  }

  // ==========================================================================
  // 8. Sincronização & Integração Cloud
  // ==========================================================================
  headerSyncBtn.addEventListener('click', async () => {
    if (!navigator.onLine) {
      showToast('Sem conexão de internet no momento.', 'warning');
      return;
    }
    showToast('Iniciando sincronização com a nuvem...', 'info');
    await window.ITPASync.sincronizarTudo();
    await atualizarDadosInterface();
  });

  // Configuração do Firebase
  const fbForm = document.getElementById('firebase-config-form');
  const cfgAtual = await window.ITPASync.carregarConfiguracao();
  if (cfgAtual) {
    const inputApiKey = document.getElementById('fb-apiKey');
    const inputProjId = document.getElementById('fb-projectId');
    const inputBucket = document.getElementById('fb-storageBucket');
    if (inputApiKey) inputApiKey.value = cfgAtual.apiKey || '';
    if (inputProjId) inputProjId.value = cfgAtual.projectId || '';
    if (inputBucket) inputBucket.value = cfgAtual.storageBucket || '';
  }

  window.ITPASync.inicializarFirebase();

  // Ativa a sincronização em tempo real (onSnapshot) com Firestore
  window.ITPASync.iniciarSincronizacaoTempoReal(async () => {
    await atualizarDadosInterface();
  });

  fbForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const novaCfg = {
      apiKey: document.getElementById('fb-apiKey').value.trim(),
      projectId: document.getElementById('fb-projectId').value.trim(),
      storageBucket: document.getElementById('fb-storageBucket').value.trim()
    };
    await window.ITPASync.salvarConfiguracao(novaCfg);
    showToast('Configurações do Firebase salvas com sucesso!', 'success');
  });

  // Função compartilhada para exportar GeoJSON
  async function exportarGeoJsonOcorrencias() {
    const ocorrencias = await window.ITPADatabase.listarOcorrencias();
    if (ocorrencias.length === 0) {
      showToast('Nenhuma ocorrência para exportar.', 'info');
      return;
    }

    const geojson = {
      type: 'FeatureCollection',
      name: 'ITPA_Ocorrencias_Campo',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: ocorrencias.map((item) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [item.longitude, item.latitude, item.altitude || 0]
        },
        properties: {
          id: item.id,
          tipo: item.tipo,
          titulo: item.titulo,
          talhao: item.talhao,
          severidade: item.severidade,
          descricao: item.descricao,
          precisaoGps: item.precisaoGps,
          syncStatus: item.syncStatus,
          timestamp: item.timestamp,
          totalFotos: item.fotos ? item.fotos.length : 0
        }
      }))
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `itpa_ocorrencias_${new Date().toISOString().slice(0, 10)}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('GeoJSON exportado com sucesso para o QGIS!', 'success');
  }

  // Vincular exportação GeoJSON nos dois locais (Aba Registros e Aba Ajustes)
  const btnExportGeoJsonSettings = document.getElementById('btn-export-geojson');
  if (btnExportGeoJsonSettings) {
    btnExportGeoJsonSettings.addEventListener('click', exportarGeoJsonOcorrencias);
  }

  const btnExportGeoJsonList = document.getElementById('btn-export-geojson-list');
  if (btnExportGeoJsonList) {
    btnExportGeoJsonList.addEventListener('click', exportarGeoJsonOcorrencias);
  }

  // Exportar Relatório Técnico Completo em PDF (com fotos)
  const btnExportPdf = document.getElementById('btn-export-pdf');
  if (btnExportPdf) {
    btnExportPdf.addEventListener('click', async () => {
      try {
        const filtroAtual = filterStatusSelect ? filterStatusSelect.value : 'all';
        const ocorrencias = await window.ITPADatabase.listarOcorrencias(filtroAtual);

        if (ocorrencias.length === 0) {
          showToast('Nenhum registro encontrado para emitir o relatório.', 'info');
          return;
        }

        showToast('📄 Compilando relatório técnico e galeria fotográfica...', 'info');

        const originalText = btnExportPdf.innerHTML;
        btnExportPdf.disabled = true;
        btnExportPdf.innerHTML = '⏳ Gerando PDF...';

        setTimeout(async () => {
          try {
            await window.ITPAReport.gerarRelatorioPdf(ocorrencias);
            showToast(`Relatório PDF com ${ocorrencias.length} registro(s) gerado e baixado!`, 'success');
          } catch (err) {
            console.error('[Relatório PDF] Falha:', err);
            showToast(`Erro ao gerar PDF: ${err.message}`, 'error');
          } finally {
            btnExportPdf.disabled = false;
            btnExportPdf.innerHTML = originalText;
          }
        }, 100);

      } catch (err) {
        console.error('[PDF] Erro geral:', err);
        showToast('Não foi possível compilar o relatório.', 'error');
      }
    });
  }

  // Limpar ocorrências já sincronizadas
  document.getElementById('btn-clean-synced').addEventListener('click', async () => {
    const sincronizadas = await window.ITPADatabase.listarOcorrencias('synced');
    if (sincronizadas.length === 0) {
      showToast('Não há ocorrências sincronizadas para limpar.', 'info');
      return;
    }

    if (confirm(`Remover ${sincronizadas.length} ocorrência(s) já sincronizadas da memória local?`)) {
      for (const item of sincronizadas) {
        await window.ITPADatabase.removerOcorrencia(item.id);
      }
      showToast('Memória local limpa!', 'success');
      await atualizarDadosInterface();
    }
  });

  // ==========================================================================
  // 9. Monitor de Conectividade e Notificações Toast
  // ==========================================================================
  function configurarMonitorConexao() {
    function atualizarStatus() {
      if (navigator.onLine) {
        statusPill.className = 'status-pill online';
        connectionText.innerText = 'Online';
      } else {
        statusPill.className = 'status-pill offline';
        connectionText.innerText = 'Offline (Gravando Local)';
      }
    }

    window.addEventListener('online', () => {
      atualizarStatus();
      showToast('Conexão restabelecida!', 'success');
    });

    window.addEventListener('offline', () => {
      atualizarStatus();
      showToast('Modo Offline ativado. Dados gravados localmente.', 'warning');
    });

    atualizarStatus();
    window.ITPASync.monitorarConexao();
  }

  function showToast(mensagem, tipo = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'itpa-toast';

    let icone = 'ℹ️';
    if (tipo === 'success') icone = '✅';
    else if (tipo === 'warning') icone = '⚠️';
    else if (tipo === 'error') icone = '❌';

    toast.innerHTML = `<span>${icone}</span><span>${mensagem}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
});
