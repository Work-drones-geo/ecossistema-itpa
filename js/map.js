/**
 * Ecossistema ITPA - Módulo de Mapa WebGIS (Leaflet & MarkerCluster)
 * Suporte a visualização de satélite, satélite + vetorial, clustering e GPS em campo.
 */

const ITPAMap = (function () {
  let map = null;
  let clusterGroup = null;
  let layerControl = null;
  let talhoesLayer = null;
  let ortofotoLayer = null;
  let userLocationMarker = null;
  let userAccuracyCircle = null;
  let tempPickMarker = null;
  let onPointSelectedCallback = null;

  // Grupos de Sobreposição de Satélite (Recortados por Talhão)
  let layerGroupNdviRecente = null;
  let layerGroupRgbRecente = null;
  let layerGroupNdviAnterior = null;
  let layerGroupRgbAnterior = null;

  // Camadas Base Globais
  let osmLayer = null;
  let esriSatLayer = null;
  let cartoVoyagerLayer = null;

  // Centro padrão: Região de atuação do ITPA (Mata Atlântica / Vale do Café / Tinguá - RJ)
  const DEFAULT_CENTER = [-22.4589, -43.4312];
  const DEFAULT_ZOOM = 13;

  // Paleta de categorias de ocorrências
  const TIPO_CONFIG = {
    muda_danificada: { rotulo: 'Muda Danificada', cor: '#E67E22', icone: '🌱' },
    fogo: { rotulo: 'Foco de Incêndio', cor: '#E74C3C', icone: '🔥' },
    erosao: { rotulo: 'Processo Erosivo', cor: '#D35400', icone: '⚠️' },
    plantio: { rotulo: 'Plantio Realizado', cor: '#82C325', icone: '🌿' },
    regeneracao: { rotulo: 'Regeneração Natural', cor: '#27AE60', icone: '🍃' },
    fauna: { rotulo: 'Avistamento de Fauna', cor: '#2B88D9', icone: '🐾' },
    resíduo: { rotulo: 'Descarte / Resíduos', cor: '#8E44AD', icone: '🗑️' },
    outro: { rotulo: 'Outro Registro', cor: '#7F8C8D', icone: '📍' }
  };

  /**
   * Inicializa a instância do Leaflet e seus grupos de camadas.
   * @param {string} containerId ID do elemento div do mapa
   * @returns {Object} instância do mapa
   */
  function init(containerId = 'map') {
    if (map) return map;

    // 1. Camadas base
    osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | ITPA'
    });

    esriSatLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics | ITPA'
    });

    cartoVoyagerLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; CartoDB | ITPA'
    });

    // 2. Instanciação do mapa
    map = L.map(containerId, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxZoom: 21,
      layers: [esriSatLayer], // Padrão: Imagem de satélite para trabalho em campo com drones e reflorestamento
      zoomControl: false // Adicionaremos em posição customizada
    });

    // Reposiciona o controle de zoom no topo esquerdo para liberar a lateral direita aos atalhos rápidos
    L.control.zoom({ position: 'topleft' }).addTo(map);

    // 3. Panes dedicados para sobreposição de imagens de satélite recortadas dos talhões
    // satelitePane (Recente 2m - zIndex 355) e sateliteAnteriorPane (Anterior -15d - zIndex 345)
    // Ficam entre os tiles base (200) e os vetores de contorno (overlayPane: 400)
    if (!map.getPane('satelitePane')) {
      map.createPane('satelitePane');
      map.getPane('satelitePane').style.zIndex = 355;
      map.getPane('satelitePane').style.pointerEvents = 'none';
    }
    if (!map.getPane('sateliteAnteriorPane')) {
      map.createPane('sateliteAnteriorPane');
      map.getPane('sateliteAnteriorPane').style.zIndex = 345;
      map.getPane('sateliteAnteriorPane').style.pointerEvents = 'none';
    }

    // 4. Instanciação dos LayerGroups para NDVI e RGB dos talhões
    layerGroupNdviRecente = L.layerGroup();
    layerGroupRgbRecente = L.layerGroup();
    layerGroupNdviAnterior = L.layerGroup();
    layerGroupRgbAnterior = L.layerGroup();

    // 5. Camada de Ortofoto Local (Drone / Voo de Alta Resolução)
    ortofotoLayer = L.tileLayer('./assets/tiles/ortofoto/{z}/{x}/{y}.png', {
      minZoom: 15,
      maxZoom: 20,
      maxNativeZoom: 20,
      attribution: 'Ortofoto Drone &copy; Work Drones / ITPA'
    });

    // Ativada por padrão no mapa
    ortofotoLayer.addTo(map);

    // 6. Controle de camadas (Base + Overlays) - Mantido para compatibilidade desktop
    const baseLayers = {
      '🛰️ Satélite de Alta Resolução': esriSatLayer,
      '🗺️ Mapa Topográfico / Ruas': osmLayer,
      '🎨 Carto Voyager (Claro)': cartoVoyagerLayer
    };

    const overlays = {
      '📸 Ortofoto Drone (Alta Resolução)': ortofotoLayer,
      '🌱 Talhões - NDVI (Recente)': layerGroupNdviRecente,
      '🛰️ Talhões - RGB (Recente)': layerGroupRgbRecente,
      '🌱 Talhões - NDVI (Passagem Anterior -15d)': layerGroupNdviAnterior,
      '🛰️ Talhões - RGB (Passagem Anterior -15d)': layerGroupRgbAnterior
    };

    layerControl = L.control.layers(baseLayers, overlays, { position: 'topright' }).addTo(map);

    // 7. Controle Dinâmico da Legenda de NDVI (RdYlGn)
    const ndviLegendEl = document.getElementById('ndvi-legend');
    const btnCloseLegend = document.getElementById('btn-close-ndvi-legend');

    if (btnCloseLegend && ndviLegendEl) {
      btnCloseLegend.addEventListener('click', () => {
        ndviLegendEl.style.display = 'none';
      });
    }

    function atualizarVisibilidadeLegendaNdvi() {
      if (!ndviLegendEl || !map) return;
      const recenteAtivo = layerGroupNdviRecente && map.hasLayer(layerGroupNdviRecente);
      const anteriorAtivo = layerGroupNdviAnterior && map.hasLayer(layerGroupNdviAnterior);

      if (recenteAtivo || anteriorAtivo) {
        ndviLegendEl.style.display = 'block';
      } else {
        ndviLegendEl.style.display = 'none';
      }
    }

    map.on('overlayadd overlayremove', (e) => {
      if (e.name && e.name.includes('NDVI')) {
        atualizarVisibilidadeLegendaNdvi();
      }
    });

    // 8. Inicializa os Controles Mobile Touch-Friendly (Estilo 'Dados Fazenda' e Bottom Sheet)
    setupTouchLayerControls();

    // 4. Inicializa o Cluster com tema do ITPA
    clusterGroup = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 45,
      iconCreateFunction: function (cluster) {
        const count = cluster.getChildCount();
        let sizeClass = 'marker-cluster-small';
        if (count > 20) sizeClass = 'marker-cluster-large';
        else if (count > 8) sizeClass = 'marker-cluster-medium';

        return L.divIcon({
          html: `<div class="itpa-cluster-badge"><span>${count}</span></div>`,
          className: 'itpa-cluster ' + sizeClass,
          iconSize: L.point(42, 42)
        });
      }
    });

    map.addLayer(clusterGroup);

    // 5. Clique no mapa para capturar coordenadas
    map.on('click', (e) => {
      if (typeof onPointSelectedCallback === 'function') {
        const { lat, lng } = e.latlng;
        setTempMarker(lat, lng);
        onPointSelectedCallback(lat, lng);
      }
    });

    // 6. Leitura assíncrona dos talhões da área (GeoJSON relativo)
    carregarTalhoesGeoJSON('./DATA/KMLs.geojson');

    return map;
  }

  /**
   * Extrai e normaliza o ID do talhão para mapeamento de arquivos raster (ex: quadrante_1).
   * @param {Object} feature
   * @param {string} nomeTalhao
   * @returns {string}
   */
  function extrairTalhaoId(feature, nomeTalhao) {
    const props = (feature && feature.properties) || {};
    if (props.id) return String(props.id).trim().toLowerCase();

    // Identifica padrão "Quadrante X"
    const matchQuad = (nomeTalhao || '').match(/quadrante\s*(\d+)/i);
    if (matchQuad) {
      return `quadrante_${matchQuad[1]}`;
    }

    return (nomeTalhao || 'talhao')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Faz a leitura assíncrona do GeoJSON de talhões e aplica o estilo oficial ITPA.
   * Enquadra automaticamente a visão nos limites da camada com map.fitBounds().
   * @param {string} [url] Caminho do arquivo GeoJSON
   * @returns {Promise<L.GeoJSON|null>}
   */
  async function carregarTalhoesGeoJSON(url) {
    try {
      const caminhos = [
        url,
        './DATA/KMLs.geojson',
        './DATA/talhoes.geojson',
        './data/KMLs.geojson',
        './data/talhoes.geojson'
      ].filter(Boolean);

      let geojsonData = null;
      let urlSucesso = '';

      for (const caminho of caminhos) {
        try {
          const resp = await fetch(caminho);
          if (resp.ok) {
            geojsonData = await resp.json();
            urlSucesso = caminho;
            break;
          }
        } catch (e) {
          // Continua para o próximo caminho candidato
        }
      }

      if (!geojsonData) {
        throw new Error(`Falha ao localizar GeoJSON dos talhões em nenhum dos caminhos testados: ${caminhos.join(', ')}`);
      }

      console.log(`[ITPAMap] Talhões carregados com sucesso de: ${urlSucesso}`);

      // Remove camada anterior se existir
      if (talhoesLayer && map) {
        map.removeLayer(talhoesLayer);
        if (layerControl) layerControl.removeLayer(talhoesLayer);
      }

      // Limpa camadas anteriores de sobreposição de satélite dos talhões
      if (layerGroupNdviRecente) layerGroupNdviRecente.clearLayers();
      if (layerGroupRgbRecente) layerGroupRgbRecente.clearLayers();
      if (layerGroupNdviAnterior) layerGroupNdviAnterior.clearLayers();
      if (layerGroupRgbAnterior) layerGroupRgbAnterior.clearLayers();

      // Estilo oficial da identidade do ITPA:
      // Contorno verde vibrante destacado (#82C325, 2.5px) e preenchimento quase transparente para permitir visualização de satélite/NDVI
      talhoesLayer = L.geoJSON(geojsonData, {
        style: function () {
          return {
            color: '#82C325',       // Contorno verde vibrante oficial ITPA
            weight: 2.5,            // Borda destacada
            opacity: 1.0,           // Opacidade total na borda
            fillColor: '#82C325',   // Preenchimento verde ITPA
            fillOpacity: 0.04       // Sem preenchimento opaco (mantém visibilidade sobre satélite/NDVI)
          };
        },
        onEachFeature: function (feature, layer) {
          const props = feature.properties || {};
          const nomeTalhao = props.Name || props.nome || props.Nome || props.talhao || 'Talhão Florestal';
          const layerOrigem = props.layer || '';
          const descricao = props.description || '';
          const codigo = props.id || props.codigo || '';

          // 1. Sobreposição de Imagens de Satélite (L.imageOverlay) recortadas no bounding box exato
          if (layer.getBounds && typeof layer.getBounds === 'function') {
            const b = layer.getBounds();
            if (b && b.isValid()) {
              const south = b.getSouth();
              const west = b.getWest();
              const north = b.getNorth();
              const east = b.getEast();
              const exactBounds = [[south, west], [north, east]];

              const talhaoId = extrairTalhaoId(feature, nomeTalhao);

              // Helper para criar ImageOverlay georreferenciado com opacidade e pane dedicado
              const criarSateliteOverlay = (caminhoRelativo, paneName = 'satelitePane') => {
                const overlay = L.imageOverlay(caminhoRelativo, exactBounds, {
                  opacity: 0.92,
                  interactive: false,
                  pane: paneName
                });
                overlay.on('error', () => {
                  if (overlay.getElement()) {
                    overlay.getElement().style.display = 'none';
                  }
                });
                return overlay;
              };

              // a) 🌱 Talhões - NDVI (Recente 2m)
              if (layerGroupNdviRecente) {
                layerGroupNdviRecente.addLayer(
                  criarSateliteOverlay(`./assets/satelite/${talhaoId}_ndvi_recente.png`, 'satelitePane')
                );
              }

              // b) 🛰️ Talhões - RGB (Recente 2m)
              if (layerGroupRgbRecente) {
                layerGroupRgbRecente.addLayer(
                  criarSateliteOverlay(`./assets/satelite/${talhaoId}_rgb_recente.png`, 'satelitePane')
                );
              }

              // c) 🌱 Talhões - NDVI (Passagem Anterior -15d)
              if (layerGroupNdviAnterior) {
                layerGroupNdviAnterior.addLayer(
                  criarSateliteOverlay(`./assets/satelite/${talhaoId}_ndvi_anterior.png`, 'sateliteAnteriorPane')
                );
              }

              // d) 🛰️ Talhões - RGB (Passagem Anterior -15d)
              if (layerGroupRgbAnterior) {
                layerGroupRgbAnterior.addLayer(
                  criarSateliteOverlay(`./assets/satelite/${talhaoId}_rgb_anterior.png`, 'sateliteAnteriorPane')
                );
              }
            }
          }

          // Efeito hover interativo nos polígonos
          layer.on({
            mouseover: function (e) {
              const poly = e.target;
              poly.setStyle({
                weight: 3.5,
                color: '#6EB31A',
                fillOpacity: 0.22
              });
              if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
                poly.bringToFront();
              }
            },
            mouseout: function (e) {
              talhoesLayer.resetStyle(e.target);
            }
          });

          // Extração das métricas analíticas calculadas pelo pipeline de 2m
          const areaHa = props.area_ha !== undefined ? Number(props.area_ha) : null;
          const perimetroM = props.perimetro_m !== undefined ? Number(props.perimetro_m) : null;
          const ndviMean = props.ndvi_mean !== undefined ? Number(props.ndvi_mean) : null;
          const ndviMin = props.ndvi_min !== undefined ? Number(props.ndvi_min) : null;
          const ndviMax = props.ndvi_max !== undefined ? Number(props.ndvi_max) : null;
          const ndviClasse = props.ndvi_classe || 'Vigor Vegetativo';

          // Posicionamento percentual na escala RdYlGn (de -0.10 a 0.85)
          const ndviPct = ndviMean !== null 
            ? Math.max(3, Math.min(97, ((ndviMean - (-0.10)) / (0.85 - (-0.10))) * 100))
            : 50;

          const areaTexto = areaHa !== null 
            ? areaHa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha' 
            : '-- ha';

          const perimetroTexto = perimetroM !== null 
            ? Math.round(perimetroM).toLocaleString('pt-BR') + ' m' 
            : '-- m';

          const ndviMeanTexto = ndviMean !== null ? ndviMean.toFixed(3) : '--';
          const ndviMinTexto = ndviMin !== null ? ndviMin.toFixed(3) : '--';
          const ndviMaxTexto = ndviMax !== null ? ndviMax.toFixed(3) : '--';

          // Pop-up analítico moderno e touch-friendly (Etapa 1)
          const popupHtml = `
            <div class="itpa-popup-card talhao-analytic-popup">
              <div class="talhao-popup-header">
                <span class="talhao-badge">🌱 TALHÃO FLORESTAL</span>
                ${codigo ? `<span class="talhao-code-pill">${codigo}</span>` : ''}
              </div>

              <h4 class="talhao-popup-title">${nomeTalhao}</h4>

              <!-- Métricas de Geometria: Área Líquida e Perímetro (UTM 23S) -->
              <div class="talhao-metrics-grid">
                <div class="metric-card">
                  <span class="metric-icon">📐</span>
                  <div class="metric-data">
                    <span class="metric-label">Área Líquida</span>
                    <span class="metric-value">${areaTexto}</span>
                  </div>
                </div>
                <div class="metric-card">
                  <span class="metric-icon">📏</span>
                  <div class="metric-data">
                    <span class="metric-label">Perímetro</span>
                    <span class="metric-value">${perimetroTexto}</span>
                  </div>
                </div>
              </div>

              <!-- Cartão Analítico de Vigor Vegetativo (NDVI a 2 metros) -->
              <div class="talhao-ndvi-card">
                <div class="ndvi-card-header">
                  <div class="ndvi-header-left">
                    <span class="ndvi-header-icon">🌿</span>
                    <span class="ndvi-header-title">NDVI Médio (2m)</span>
                  </div>
                  <span class="ndvi-value-badge">${ndviMeanTexto}</span>
                </div>

                <!-- Barra de Progresso com Escala RdYlGn e Indicador -->
                <div class="ndvi-progress-wrapper">
                  <div class="ndvi-progress-track">
                    <div class="ndvi-progress-pin" style="left: ${ndviPct}%;" title="Média: ${ndviMeanTexto}"></div>
                  </div>
                  <div class="ndvi-progress-scale-labels">
                    <span>Baixo (0.1)</span>
                    <span>Médio (0.4)</span>
                    <span>Alto (0.85)</span>
                  </div>
                </div>

                <div class="ndvi-card-footer">
                  <span class="ndvi-range-tag">Intervalo: <strong>${ndviMinTexto}</strong> a <strong>${ndviMaxTexto}</strong></span>
                  <span class="ndvi-class-tag">${ndviClasse}</span>
                </div>
              </div>

              <!-- Botões de Ação Operacional -->
              <div class="talhao-popup-actions">
                <button class="btn-popup-action primary btn-talhao-grafico" data-talhao="${nomeTalhao}">
                  📈 Evolução Histórica (Gráfico)
                </button>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                  <button class="btn-popup-action swipe-action-btn btn-talhao-swipe" data-talhao="${nomeTalhao}">
                    ↔️ Comparar
                  </button>
                  <button class="btn-popup-action pdf-action-btn btn-talhao-pdf" data-talhao="${nomeTalhao}">
                    📄 Ficha (PDF)
                  </button>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                  <button class="btn-popup-action secondary btn-talhao-preencher" data-talhao="${nomeTalhao}">
                    ➕ Ocorrência
                  </button>
                  <button class="btn-popup-action secondary btn-talhao-documentos" data-talhao="${nomeTalhao}">
                    📂 Documentos
                  </button>
                </div>
              </div>
            </div>
          `;

          layer.bindPopup(popupHtml, {
            maxWidth: 320,
            className: 'talhao-popup-custom-wrapper'
          });

          layer.on('popupopen', () => {
            const btnGrafico = document.querySelector(`.btn-talhao-grafico[data-talhao="${nomeTalhao}"]`);
            if (btnGrafico && typeof window.ITPA_OnTalhaoGrafico === 'function') {
              btnGrafico.onclick = () => {
                window.ITPA_OnTalhaoGrafico(nomeTalhao, props, layer.getBounds ? layer.getBounds() : null);
              };
            }

            const btnSwipe = document.querySelector(`.btn-talhao-swipe[data-talhao="${nomeTalhao}"]`);
            if (btnSwipe) {
              btnSwipe.onclick = () => {
                ativarModoSwipe(nomeTalhao, layer.getBounds ? layer.getBounds() : null);
              };
            }

            const btnPdf = document.querySelector(`.btn-talhao-pdf[data-talhao="${nomeTalhao}"]`);
            if (btnPdf) {
              btnPdf.onclick = () => {
                if (window.ITPARelatorioTalhao && typeof window.ITPARelatorioTalhao.exportarFichaTecnica === 'function') {
                  window.ITPARelatorioTalhao.exportarFichaTecnica(props, layer.getBounds ? layer.getBounds() : null);
                }
              };
            }

            const btn = document.querySelector(`.btn-talhao-preencher[data-talhao="${nomeTalhao}"]`);
            if (btn && typeof window.ITPA_OnTalhaoSelecionado === 'function') {
              btn.onclick = () => {
                const center = layer.getBounds ? layer.getBounds().getCenter() : null;
                window.ITPA_OnTalhaoSelecionado(nomeTalhao, center);
              };
            }

            const btnDocs = document.querySelector(`.btn-talhao-documentos[data-talhao="${nomeTalhao}"]`);
            if (btnDocs && typeof window.ITPA_OnTalhaoDocumentos === 'function') {
              btnDocs.onclick = () => {
                window.ITPA_OnTalhaoDocumentos(nomeTalhao, props, 'tab-talhao-docs');
              };
            }
          });
        }
      });

      if (map) {
        talhoesLayer.addTo(map);

        if (layerControl) {
          layerControl.addOverlay(talhoesLayer, '🌱 Limites e Talhões (ITPA)');
        }

        // Ajuste automático do enquadramento do mapa para os limites da área
        if (talhoesLayer.getBounds().isValid()) {
          map.fitBounds(talhoesLayer.getBounds(), {
            padding: [30, 30],
            maxZoom: 16
          });
          console.log('[ITPAMap] Auto-fit aplicado aos limites dos talhões:', talhoesLayer.getBounds());
        }
      }

      return talhoesLayer;
    } catch (err) {
      console.warn('[ITPAMap] Falha ao carregar GeoJSON dos talhões:', err);
      return null;
    }
  }

  /**
   * Cria ícone customizado em SVG com a cor da categoria.
   * @param {string} tipo
   * @returns {L.DivIcon}
   */
  function criarIconeOcorrencia(tipo) {
    const config = TIPO_CONFIG[tipo] || TIPO_CONFIG.outro;
    const html = `
      <div class="itpa-pin" style="--pin-color: ${config.cor}">
        <div class="itpa-pin-inner">${config.icone}</div>
        <div class="itpa-pin-pulse"></div>
      </div>
    `;
    return L.divIcon({
      html: html,
      className: 'itpa-marker-wrapper',
      iconSize: [36, 46],
      iconAnchor: [18, 42],
      popupAnchor: [0, -38]
    });
  }

  /**
   * Renderiza a lista de ocorrências no MarkerCluster.
   * @param {Array} ocorrencias
   * @param {Function} [onDetalhesClick]
   */
  function carregarOcorrencias(ocorrencias, onDetalhesClick) {
    if (!clusterGroup) return;
    clusterGroup.clearLayers();

    ocorrencias.forEach((item) => {
      if (!item.latitude || !item.longitude) return;

      const marker = L.marker([item.latitude, item.longitude], {
        icon: criarIconeOcorrencia(item.tipo)
      });

      const config = TIPO_CONFIG[item.tipo] || TIPO_CONFIG.outro;
      const dataFormatada = new Date(item.timestamp).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const statusBadge = item.syncStatus === 'synced'
        ? '<span class="badge-status synced">✓ Sincronizado</span>'
        : '<span class="badge-status pending">⏳ Pendente Offline</span>';

      const primeiraFoto = item.fotos && item.fotos.length > 0 ? item.fotos[0] : null;
      const fotoUrl = primeiraFoto ? (typeof primeiraFoto === 'string' ? primeiraFoto : (primeiraFoto.dataUrl || '')) : '';
      const fotoHtml = fotoUrl
        ? `<div class="popup-thumb"><img src="${fotoUrl}" alt="Foto da ocorrência"></div>`
        : '';

      const popupHtml = `
        <div class="itpa-popup-card">
          ${fotoHtml}
          <div class="popup-header">
            <span class="popup-tipo" style="color: ${config.cor}">${config.icone} ${config.rotulo}</span>
            ${statusBadge}
          </div>
          <h4 class="popup-title">${item.titulo}</h4>
          ${item.talhao ? `<p class="popup-meta"><strong>Talhão:</strong> ${item.talhao}</p>` : ''}
          ${item.descricao ? `<p class="popup-desc">${item.descricao.substring(0, 110)}${item.descricao.length > 110 ? '...' : ''}</p>` : ''}
          <p class="popup-date">${dataFormatada}</p>
          <div class="popup-actions">
            <button class="btn-popup-ver" data-id="${item.id}">Visualizar Detalhes</button>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);

      marker.on('popupopen', () => {
        const btn = document.querySelector(`.btn-popup-ver[data-id="${item.id}"]`);
        if (btn && typeof onDetalhesClick === 'function') {
          btn.onclick = () => onDetalhesClick(item.id);
        }
      });

      clusterGroup.addLayer(marker);
    });
  }

  /**
   * Ativa a captura de ponto pelo clique no mapa.
   * @param {Function} callback (lat, lng)
   */
  function ativarModoSelecaoPonto(callback) {
    onPointSelectedCallback = callback;
  }

  /**
   * Desativa o modo de seleção por clique.
   */
  function desativarModoSelecaoPonto() {
    onPointSelectedCallback = null;
    removerTempMarker();
  }

  /**
   * Define um marcador temporário para edição ou seleção de ponto.
   * @param {number} lat
   * @param {number} lng
   */
  function setTempMarker(lat, lng) {
    removerTempMarker();
    tempPickMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        html: '<div class="itpa-temp-picker">🎯</div>',
        className: 'picker-wrapper',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      })
    }).addTo(map);
  }

  function removerTempMarker() {
    if (tempPickMarker && map) {
      map.removeLayer(tempPickMarker);
      tempPickMarker = null;
    }
  }

  /**
   * Centraliza e acompanha a posição GPS do usuário em alta precisão.
   * @returns {Promise<{latitude: number, longitude: number, accuracy: number}>}
   */
  function obterLocalizacaoAtual(centralizar = true) {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        return reject(new Error('Geolocalização não suportada no aparelho.'));
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = pos.coords.accuracy;

          if (map) {
            // Atualiza ou cria marcador do técnico
            if (!userLocationMarker) {
              userLocationMarker = L.marker([lat, lng], {
                icon: L.divIcon({
                  html: '<div class="user-gps-pulse"><div class="dot"></div></div>',
                  className: 'user-gps-wrapper',
                  iconSize: [24, 24],
                  iconAnchor: [12, 12]
                })
              }).addTo(map);

              userAccuracyCircle = L.circle([lat, lng], {
                radius: accuracy,
                color: '#2B88D9',
                weight: 1,
                fillColor: '#2B88D9',
                fillOpacity: 0.15
              }).addTo(map);
            } else {
              userLocationMarker.setLatLng([lat, lng]);
              userAccuracyCircle.setLatLng([lat, lng]);
              userAccuracyCircle.setRadius(accuracy);
            }

            if (centralizar) {
              map.setView([lat, lng], 16, { animate: true });
            }
          }

          resolve({
            latitude: lat,
            longitude: lng,
            precisaoGps: accuracy,
            altitude: pos.coords.altitude
          });
        },
        (err) => {
          console.warn('Erro ao obter GPS:', err);
          reject(err);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  }

  /**
   * Configura os controles modernos touch-friendly de camadas (Inspirados no 'Dados Fazenda'):
   * - Barra vertical flutuante de botões rápidos ("NDVI 2m", "Drone", "Satélite RGB", "Camadas")
   * - Bottom Sheet modal com cantos arredondados, alça cinza, mapas de fundo e switches iOS
   */
  function setupTouchLayerControls() {
    const pillNdvi = document.getElementById('pill-quick-ndvi');
    const pillDrone = document.getElementById('pill-quick-drone');
    const pillRgb = document.getElementById('pill-quick-rgb');
    const btnOpenSheet = document.getElementById('btn-open-layers-sheet');

    const sheetOverlay = document.getElementById('sheet-camadas-overlay');
    const btnCloseSheet = document.getElementById('btn-close-sheet-camadas');
    const baseRadios = document.querySelectorAll('input[name="base-map-choice"]');

    const toggleDrone = document.getElementById('sheet-toggle-drone');
    const toggleNdvi = document.getElementById('sheet-toggle-ndvi');
    const toggleRgb = document.getElementById('sheet-toggle-rgb');
    const toggleNdviAnt = document.getElementById('sheet-toggle-ndvi-ant');
    const toggleTalhoes = document.getElementById('sheet-toggle-talhoes');

    // Sincroniza o estado das pílulas e interruptores com o mapa Leaflet
    function sincronizarEstadosUI() {
      if (!map) return;

      // 1. Ortofoto Drone
      const droneAtivo = ortofotoLayer && map.hasLayer(ortofotoLayer);
      if (pillDrone) pillDrone.classList.toggle('active', !!droneAtivo);
      if (toggleDrone) toggleDrone.checked = !!droneAtivo;

      // 2. Talhões NDVI 2m
      const ndviAtivo = layerGroupNdviRecente && map.hasLayer(layerGroupNdviRecente);
      if (pillNdvi) pillNdvi.classList.toggle('active', !!ndviAtivo);
      if (toggleNdvi) toggleNdvi.checked = !!ndviAtivo;

      // 3. Talhões RGB 2m
      const rgbAtivo = layerGroupRgbRecente && map.hasLayer(layerGroupRgbRecente);
      if (pillRgb) pillRgb.classList.toggle('active', !!rgbAtivo);
      if (toggleRgb) toggleRgb.checked = !!rgbAtivo;

      // 4. Passagem Anterior (-15d)
      const ndviAntAtivo = layerGroupNdviAnterior && map.hasLayer(layerGroupNdviAnterior);
      if (toggleNdviAnt) toggleNdviAnt.checked = !!ndviAntAtivo;

      // 5. Limites dos Talhões
      const talhoesAtivo = talhoesLayer && map.hasLayer(talhoesLayer);
      if (toggleTalhoes) toggleTalhoes.checked = !!talhoesAtivo;

      // 6. Mapas Base
      if (baseRadios && baseRadios.length) {
        baseRadios.forEach(radio => {
          if (radio.value === 'satelite') {
            radio.checked = !!(esriSatLayer && map.hasLayer(esriSatLayer));
          } else if (radio.value === 'osm') {
            radio.checked = !!(osmLayer && map.hasLayer(osmLayer));
          } else if (radio.value === 'voyager') {
            radio.checked = !!(cartoVoyagerLayer && map.hasLayer(cartoVoyagerLayer));
          }
        });
      }

      // Atualiza legenda flutuante de NDVI
      const ndviLegendEl = document.getElementById('ndvi-legend');
      if (ndviLegendEl) {
        if (ndviAtivo || ndviAntAtivo) {
          ndviLegendEl.style.display = 'block';
        } else {
          ndviLegendEl.style.display = 'none';
        }
      }
    }

    function alternarCamada(camada) {
      if (!camada || !map) return;
      if (map.hasLayer(camada)) {
        map.removeLayer(camada);
      } else {
        map.addLayer(camada);
      }
      sincronizarEstadosUI();
    }

    // Eventos das Pílulas Rápidas Flutuantes
    if (pillNdvi) {
      pillNdvi.onclick = (e) => {
        e.preventDefault();
        alternarCamada(layerGroupNdviRecente);
      };
    }

    if (pillDrone) {
      pillDrone.onclick = (e) => {
        e.preventDefault();
        alternarCamada(ortofotoLayer);
      };
    }

    if (pillRgb) {
      pillRgb.onclick = (e) => {
        e.preventDefault();
        alternarCamada(layerGroupRgbRecente);
      };
    }

    // Abertura e Fechamento do Bottom Sheet
    function abrirSheet() {
      if (sheetOverlay) {
        sincronizarEstadosUI();
        sheetOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
      }
    }

    function fecharSheet() {
      if (sheetOverlay) {
        sheetOverlay.classList.remove('open');
        document.body.style.overflow = '';
      }
    }

    if (btnOpenSheet) {
      btnOpenSheet.onclick = (e) => {
        e.preventDefault();
        abrirSheet();
      };
    }

    if (btnCloseSheet) {
      btnCloseSheet.onclick = (e) => {
        e.preventDefault();
        fecharSheet();
      };
    }

    if (sheetOverlay) {
      sheetOverlay.onclick = (e) => {
        if (e.target === sheetOverlay) {
          fecharSheet();
        }
      };
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sheetOverlay && sheetOverlay.classList.contains('open')) {
        fecharSheet();
      }
    });

    // Mapas de Fundo Base (Radios)
    if (baseRadios && baseRadios.length) {
      baseRadios.forEach(radio => {
        radio.onchange = () => {
          if (!map) return;
          if (radio.value === 'satelite') {
            if (esriSatLayer) map.addLayer(esriSatLayer);
            if (osmLayer) map.removeLayer(osmLayer);
            if (cartoVoyagerLayer) map.removeLayer(cartoVoyagerLayer);
          } else if (radio.value === 'osm') {
            if (osmLayer) map.addLayer(osmLayer);
            if (esriSatLayer) map.removeLayer(esriSatLayer);
            if (cartoVoyagerLayer) map.removeLayer(cartoVoyagerLayer);
          } else if (radio.value === 'voyager') {
            if (cartoVoyagerLayer) map.addLayer(cartoVoyagerLayer);
            if (esriSatLayer) map.removeLayer(esriSatLayer);
            if (osmLayer) map.removeLayer(osmLayer);
          }
          sincronizarEstadosUI();
        };
      });
    }

    // Switches de Camadas Operacionais
    if (toggleDrone) {
      toggleDrone.onchange = () => {
        if (toggleDrone.checked) {
          if (ortofotoLayer && !map.hasLayer(ortofotoLayer)) map.addLayer(ortofotoLayer);
        } else {
          if (ortofotoLayer && map.hasLayer(ortofotoLayer)) map.removeLayer(ortofotoLayer);
        }
        sincronizarEstadosUI();
      };
    }

    if (toggleNdvi) {
      toggleNdvi.onchange = () => {
        if (toggleNdvi.checked) {
          if (layerGroupNdviRecente && !map.hasLayer(layerGroupNdviRecente)) map.addLayer(layerGroupNdviRecente);
        } else {
          if (layerGroupNdviRecente && map.hasLayer(layerGroupNdviRecente)) map.removeLayer(layerGroupNdviRecente);
        }
        sincronizarEstadosUI();
      };
    }

    if (toggleRgb) {
      toggleRgb.onchange = () => {
        if (toggleRgb.checked) {
          if (layerGroupRgbRecente && !map.hasLayer(layerGroupRgbRecente)) map.addLayer(layerGroupRgbRecente);
        } else {
          if (layerGroupRgbRecente && map.hasLayer(layerGroupRgbRecente)) map.removeLayer(layerGroupRgbRecente);
        }
        sincronizarEstadosUI();
      };
    }

    if (toggleNdviAnt) {
      toggleNdviAnt.onchange = () => {
        if (toggleNdviAnt.checked) {
          if (layerGroupNdviAnterior && !map.hasLayer(layerGroupNdviAnterior)) map.addLayer(layerGroupNdviAnterior);
        } else {
          if (layerGroupNdviAnterior && map.hasLayer(layerGroupNdviAnterior)) map.removeLayer(layerGroupNdviAnterior);
        }
        sincronizarEstadosUI();
      };
    }

    if (toggleTalhoes) {
      toggleTalhoes.onchange = () => {
        if (toggleTalhoes.checked) {
          if (talhoesLayer && !map.hasLayer(talhoesLayer)) map.addLayer(talhoesLayer);
        } else {
          if (talhoesLayer && map.hasLayer(talhoesLayer)) map.removeLayer(talhoesLayer);
        }
        sincronizarEstadosUI();
      };
    }

    // Reatividade a qualquer mudança de camada no Leaflet
    map.on('layeradd layerremove', () => {
      sincronizarEstadosUI();
    });

    // Inicializa os controles do Comparador Swipe
    setupSwipeInteractions();

    sincronizarEstadosUI();
  }

  // ==========================================================================
  // 9. Ferramenta de Comparação "Antes e Depois" (Swipe / Cortina Deslizante)
  // ==========================================================================
  let swipeAtivo = false;

  function ativarModoSwipe(talhaoFoco = null, bounds = null) {
    if (!map) return;
    swipeAtivo = true;

    const swipeContainer = document.getElementById('map-swipe-container');
    const pillSwipe = document.getElementById('pill-quick-swipe');
    if (pillSwipe) pillSwipe.classList.add('active');

    // Liga ambas as camadas para a comparação: Recente (superior) vs Anterior (inferior)
    if (layerGroupNdviRecente && !map.hasLayer(layerGroupNdviRecente)) {
      map.addLayer(layerGroupNdviRecente);
    }
    if (layerGroupNdviAnterior && !map.hasLayer(layerGroupNdviAnterior)) {
      map.addLayer(layerGroupNdviAnterior);
    }

    if (swipeContainer) {
      swipeContainer.style.display = 'block';
    }

    // Se fornecido bounds do talhão, aproxima e fecha popup
    if (bounds && bounds.isValid && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
      map.closePopup();
    }

    // Posiciona o divisor inicialmente a 50%
    setTimeout(() => {
      atualizarPosicaoSwipe(map.getSize().x * 0.5);
    }, 50);
  }

  function desativarModoSwipe() {
    swipeAtivo = false;
    const swipeContainer = document.getElementById('map-swipe-container');
    const pillSwipe = document.getElementById('pill-quick-swipe');
    if (pillSwipe) pillSwipe.classList.remove('active');

    if (swipeContainer) {
      swipeContainer.style.display = 'none';
    }

    // Restaura o clipPath
    const pane = map ? map.getPane('satelitePane') : null;
    if (pane) {
      pane.style.clipPath = '';
    }

    // Desliga a camada anterior após o swipe para manter o mapa limpo
    if (layerGroupNdviAnterior && map && map.hasLayer(layerGroupNdviAnterior)) {
      map.removeLayer(layerGroupNdviAnterior);
    }
  }

  function atualizarPosicaoSwipe(xPx) {
    if (!map || !swipeAtivo) return;
    const mapWidth = map.getSize().x;
    const clampedX = Math.max(10, Math.min(mapWidth - 10, xPx));

    const divider = document.getElementById('swipe-divider-line');
    if (divider) {
      divider.style.left = `${clampedX}px`;
    }

    const pane = map.getPane('satelitePane');
    if (pane) {
      pane.style.clipPath = `polygon(0 0, ${clampedX}px 0, ${clampedX}px 100%, 0 100%)`;
    }
  }

  function setupSwipeInteractions() {
    const divider = document.getElementById('swipe-divider-line');
    const handle = document.getElementById('swipe-handle');
    const btnClose = document.getElementById('btn-close-swipe');
    const pillSwipe = document.getElementById('pill-quick-swipe');

    if (pillSwipe) {
      pillSwipe.addEventListener('click', (e) => {
        e.preventDefault();
        if (swipeAtivo) {
          desativarModoSwipe();
        } else {
          ativarModoSwipe();
        }
      });
    }

    if (btnClose) {
      btnClose.addEventListener('click', (e) => {
        e.preventDefault();
        desativarModoSwipe();
      });
    }

    let isDragging = false;

    const startDrag = (e) => {
      isDragging = true;
      if (map && map.dragging) map.dragging.disable();
    };

    const doDrag = (e) => {
      if (!isDragging) return;
      let clientX = e.clientX;
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
      }
      const mapEl = document.getElementById('map');
      if (mapEl) {
        const rect = mapEl.getBoundingClientRect();
        atualizarPosicaoSwipe(clientX - rect.left);
      }
    };

    const stopDrag = () => {
      if (isDragging) {
        isDragging = false;
        if (map && map.dragging) map.dragging.enable();
      }
    };

    if (handle) {
      handle.addEventListener('mousedown', startDrag);
      handle.addEventListener('touchstart', startDrag, { passive: true });
    }
    if (divider) {
      divider.addEventListener('mousedown', startDrag);
      divider.addEventListener('touchstart', startDrag, { passive: true });
    }

    window.addEventListener('mousemove', doDrag);
    window.addEventListener('touchmove', doDrag, { passive: true });
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('touchend', stopDrag);

    if (map) {
      map.on('resize', () => {
        if (swipeAtivo) {
          atualizarPosicaoSwipe(map.getSize().x * 0.5);
        }
      });
    }
  }

  function getMapInstance() {
    return map;
  }

  return {
    init,
    carregarTalhoesGeoJSON,
    setupTouchLayerControls,
    ativarModoSwipe,
    desativarModoSwipe,
    isSwipeAtivo: () => swipeAtivo,
    getTalhoesLayer: () => talhoesLayer,
    getOrtofotoLayer: () => ortofotoLayer,
    getLayerGroupNdviRecente: () => layerGroupNdviRecente,
    getLayerGroupRgbRecente: () => layerGroupRgbRecente,
    getLayerGroupNdviAnterior: () => layerGroupNdviAnterior,
    getLayerGroupRgbAnterior: () => layerGroupRgbAnterior,
    carregarOcorrencias,
    obterLocalizacaoAtual,
    ativarModoSelecaoPonto,
    desativarModoSelecaoPonto,
    setTempMarker,
    removerTempMarker,
    getMapInstance,
    TIPO_CONFIG
  };
})();

// Exportação global
window.ITPAMap = ITPAMap;
