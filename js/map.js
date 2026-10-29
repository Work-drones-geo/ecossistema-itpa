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

  // Camadas de Conformidade e Auditoria de Crédito (Resolução CMN nº 5.303/2026)
  let layerGroupCar = null;
  let layerGroupProdes = null;
  let layerGroupIbama = null;

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

    // 1. Camadas base com suporte a zoom ampliado (10 a 22)
    osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      minZoom: 10,
      maxZoom: 22,
      maxNativeZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | ITPA'
    });

    esriSatLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      minZoom: 10,
      maxZoom: 22,
      maxNativeZoom: 19,
      attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics | ITPA'
    });

    cartoVoyagerLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      minZoom: 10,
      maxZoom: 22,
      maxNativeZoom: 19,
      attribution: '&copy; CartoDB | ITPA'
    });

    // 2. Instanciação do mapa com limites de zoom de 10 a 22
    map = L.map(containerId, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: 10,
      maxZoom: 22,
      layers: [esriSatLayer], // Padrão: Imagem de satélite para trabalho em campo com drones e reflorestamento
      zoomControl: false // Adicionaremos em posição customizada
    });

    // Reposiciona o controle de zoom no topo esquerdo para liberar a lateral direita aos atalhos rápidos
    L.control.zoom({ position: 'topleft' }).addTo(map);

    // 3. Panes dedicados para sobreposição e controle de swipe (Recente = leftPane, Anterior = rightPane)
    // Ficam entre os tiles base (200) e os vetores de contorno (overlayPane: 400)
    if (!map.getPane('leftPane')) {
      const lp = map.createPane('leftPane');
      lp.style.zIndex = 355;
      lp.style.pointerEvents = 'none';
      lp.style.width = '100%';
      lp.style.height = '100%';
    }
    if (!map.getPane('rightPane')) {
      const rp = map.createPane('rightPane');
      rp.style.zIndex = 345;
      rp.style.pointerEvents = 'none';
      rp.style.width = '100%';
      rp.style.height = '100%';
    }

    if (map._mapPane) {
      map._mapPane.style.width = '100%';
      map._mapPane.style.height = '100%';
    }

    // Aliases para compatibilidade com chamadas legado
    if (!map.getPane('satelitePane')) {
      const sp = map.createPane('satelitePane');
      sp.style.zIndex = 355;
      sp.style.pointerEvents = 'none';
      sp.style.width = '100%';
      sp.style.height = '100%';
    }
    if (!map.getPane('sateliteAnteriorPane')) {
      const sap = map.createPane('sateliteAnteriorPane');
      sap.style.zIndex = 345;
      sap.style.pointerEvents = 'none';
      sap.style.width = '100%';
      sap.style.height = '100%';
    }

    // 4. Instanciação dos LayerGroups para NDVI e RGB dos talhões
    layerGroupNdviRecente = L.layerGroup();
    layerGroupRgbRecente = L.layerGroup();
    layerGroupNdviAnterior = L.layerGroup();
    layerGroupRgbAnterior = L.layerGroup();

    // 4b. Instanciação das Camadas de Conformidade e Auditoria (CMN nº 5.303/2026)
    layerGroupCar = L.geoJSON(null, {
      style: {
        color: '#0284c7', // Azul Ciano Oficial CAR
        weight: 2.2,
        fillColor: '#38bdf8',
        fillOpacity: 0.08
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties || {};
        const cod = props.cod_imovel || props.COD_IMOVEL || props.car || props.id || 'Imóvel Rural';
        const area = props.area_ha || props.num_area || '--';
        layer.bindPopup(`
          <div class="itpa-popup-card">
            <h4 style="margin:0 0 4px 0; color:#0284c7;">🏛️ Base CAR Oficial</h4>
            <p style="margin:0; font-size:12px;"><strong>Código:</strong> ${cod}</p>
            <p style="margin:0; font-size:12px;"><strong>Área:</strong> ${area} ha</p>
          </div>
        `);
      }
    });

    layerGroupProdes = L.geoJSON(null, {
      style: {
        color: '#dc2626', // Contorno vermelho sem preenchimento opaco
        weight: 2.5,
        fillOpacity: 0.0,
        dashArray: '5, 5'
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties || {};
        const ano = props.year || props.ano || props.date || '> 31/07/2019';
        const area = props.area_ha || props.area || '--';
        layer.bindPopup(`
          <div class="itpa-popup-card">
            <h4 style="margin:0 0 4px 0; color:#dc2626;">🚨 Alerta PRODES (> 31/07/2019)</h4>
            <p style="margin:0; font-size:12px;"><strong>Ano / Data:</strong> ${ano}</p>
            <p style="margin:0; font-size:12px;"><strong>Área:</strong> ${area} ha</p>
            <p style="margin:0; font-size:11px; color:#dc2626;"><strong>Impeditivo CMN 5.303/2026</strong></p>
          </div>
        `);
      }
    });

    layerGroupIbama = L.geoJSON(null, {
      style: {
        color: '#b91c1c',
        weight: 2.5,
        fillColor: '#ef4444',
        fillOpacity: 0.15
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties || {};
        const termo = props.num_termo || props.termo || props.id || '--';
        layer.bindPopup(`
          <div class="itpa-popup-card">
            <h4 style="margin:0 0 4px 0; color:#b91c1c;">🚫 Embargo Ambiental IBAMA</h4>
            <p style="margin:0; font-size:12px;"><strong>Termo:</strong> ${termo}</p>
          </div>
        `);
      }
    });

    // 5. Camada de Ortofoto Local (Drone / Voo de Alta Resolução) com reescalonamento no zoom reduzido
    ortofotoLayer = L.tileLayer('./assets/tiles/ortofoto/{z}/{x}/{y}.png', {
      minZoom: 10,
      maxZoom: 22,
      minNativeZoom: 10,
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
      '🌱 Talhões - NDVI (Recente 2m)': layerGroupNdviRecente,
      '🛰️ Talhões - RGB (Recente 2m)': layerGroupRgbRecente,
      '🌱 Talhões - NDVI (Anterior 09/Set - 2m)': layerGroupNdviAnterior,
      '🛰️ Talhões RGB - Passagem Anterior (2m)': layerGroupRgbAnterior,
      '🏛️ Base CAR (Polígono Oficial)': layerGroupCar,
      '🚨 Alertas PRODES (> 31/07/2019)': layerGroupProdes,
      '🚫 Embargos Ambientais (IBAMA)': layerGroupIbama
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

    // 6. Inicialização do Projeto Ativo no WebGIS (Arquitetura Multi-Projetos)
    const selectProjetoEl = document.getElementById('select-projeto');
    const projetoInicial = selectProjetoEl ? selectProjetoEl.value : 'esec';
    selecionarProjeto(projetoInicial);

    if (selectProjetoEl) {
      selectProjetoEl.addEventListener('change', function () {
        selecionarProjeto(this.value);
      });
    }

    // 7. Leitura assíncrona das camadas de Conformidade e Crédito (CMN 5.303/2026)
    carregarCamadasAuditoria();

    return map;
  }

  /**
   * Faz a leitura assíncrona das camadas oficiais de conformidade territorial e crédito
   * (Resolução CMN nº 5.303/2026). Se os arquivos estiverem vazios ([]), as camadas permanecem
   * invisíveis sem nenhum erro no console.
   */
  async function carregarCamadasAuditoria() {
    const carregarCamadaGeoJson = async (caminhos, layerGroup, nomeCamada) => {
      const listaCaminhos = Array.isArray(caminhos) ? caminhos : [caminhos];
      for (const caminho of listaCaminhos) {
        try {
          const resp = await fetch(caminho);
          if (resp.ok) {
            const data = await resp.json();
            if (data && Array.isArray(data.features) && data.features.length > 0 && layerGroup) {
              layerGroup.clearLayers();
              layerGroup.addData(data);
              console.log(`[ITPAMap] Camada ${nomeCamada} carregada com ${data.features.length} feições de: ${caminho}`);
            }
            break;
          }
        } catch (err) {
          // Silencioso se o arquivo estiver vazio ou ausente
        }
      }
    };

    await Promise.all([
      carregarCamadaGeoJson(['./DATA/car_oficial.geojson', './data/car_oficial.geojson'], layerGroupCar, 'Base CAR'),
      carregarCamadaGeoJson(['./DATA/prodes_alertas.geojson', './data/prodes_alertas.geojson'], layerGroupProdes, 'PRODES Alertas'),
      carregarCamadaGeoJson(['./DATA/ibama_embargos.geojson', './data/ibama_embargos.geojson'], layerGroupIbama, 'Embargos IBAMA')
    ]);
  }

  /**
   * Carrega dinamicamente o perímetro do CAR importado pelo usuário no mapa Leaflet
   * @param {Object} geojson Objeto GeoJSON válido do CAR
   */
  function carregarCarNoMapa(geojson) {
    if (!layerGroupCar || !map) return;
    layerGroupCar.clearLayers();
    layerGroupCar.addData(geojson);

    if (!map.hasLayer(layerGroupCar)) {
      map.addLayer(layerGroupCar);
    }

    if (layerGroupCar.getBounds && layerGroupCar.getBounds().isValid()) {
      map.fitBounds(layerGroupCar.getBounds().pad(0.06), { maxZoom: 16 });
    }

    const toggleCar = document.getElementById('sheet-toggle-car');
    if (toggleCar) toggleCar.checked = true;
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

      // Coordenadas exatas do bbox_expandido (buffer geográfico com bounds.pad(0.15) para estender latitude norte)
      // bbox expandido: minX=-43.022287, minY=-22.737766, maxX=-42.949613, maxY=-22.691124
      let boundsSateliteExpandido = L.latLngBounds(
        [-22.737766, -43.022287], // [lat_min_expandida, lng_min_expandida]
        [-22.691124, -42.949613]  // [lat_max_expandida, lng_max_expandida]
      );

      // Se talhões já carregados, assegura extensão bounds.pad(0.15) no envelope
      try {
        const respBounds = await fetch('./assets/satelite/bounds_expandido.json');
        if (respBounds.ok) {
          const bJson = await respBounds.json();
          if (bJson && bJson.bounds && bJson.bounds.length === 2) {
            boundsSateliteExpandido = L.latLngBounds(bJson.bounds[0], bJson.bounds[1]);
          }
        }
      } catch (e) {
        // Fallback para bounds expandido padrão
      }

      // Helper para criar ImageOverlay georreferenciado da AOI completa com limites de zoom (10 a 22)
      const criarAoiOverlay = (caminhoRelativo, paneName = 'leftPane') => {
        const overlay = L.imageOverlay(caminhoRelativo, boundsSateliteExpandido, {
          opacity: 0.95,
          interactive: false,
          pane: paneName,
          minZoom: 10,
          maxZoom: 22
        });
        overlay.on('error', () => {
          if (overlay.getElement()) {
            overlay.getElement().style.display = 'none';
          }
        });
        return overlay;
      };

      // 1. Sobreposição de Imagens de Satélite e NDVI da AOI consolidada com folga expandida
      // a) 🌱 Talhões - NDVI (Recente 2m) -> leftPane
      if (layerGroupNdviRecente) {
        layerGroupNdviRecente.addLayer(
          criarAoiOverlay('./assets/satelite/aoi_ndvi_recente_2m.png', 'leftPane')
        );
      }

      // b) 🛰️ Talhões - RGB (Recente 2m) -> leftPane
      if (layerGroupRgbRecente) {
        layerGroupRgbRecente.addLayer(
          criarAoiOverlay('./assets/satelite/aoi_rgb_recente_2m.png', 'leftPane')
        );
      }

      // c) 🌱 Talhões - NDVI (Anterior 09/Set - 2m) -> rightPane
      if (layerGroupNdviAnterior) {
        layerGroupNdviAnterior.addLayer(
          criarAoiOverlay('./assets/satelite/aoi_ndvi_anterior_2m.png', 'rightPane')
        );
      }

      // d) 🛰️ Talhões - RGB (Anterior 09/Set - 2m) -> rightPane
      if (layerGroupRgbAnterior) {
        layerGroupRgbAnterior.addLayer(
          criarAoiOverlay('./assets/satelite/aoi_rgb_anterior_2m.png', 'rightPane')
        );
      }

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

          // Posicionamento percentual na escala RdYlGn fixa (de 0.10 a 0.80)
          const ndviPct = ndviMean !== null 
            ? Math.max(3, Math.min(97, ((ndviMean - 0.10) / (0.80 - 0.10)) * 100))
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
                    <span>Solo (0.1)</span>
                    <span>Médio (0.4)</span>
                    <span>Dossel (0.8)</span>
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

        // Ajuste automático do enquadramento com folga bounds.pad(0.15) para englobar todos os talhões sem cortes
        if (talhoesLayer.getBounds().isValid()) {
          const totalBoundsFolga = talhoesLayer.getBounds().pad(0.15);
          map.fitBounds(totalBoundsFolga, {
            padding: [40, 40],
            maxZoom: 16
          });
          console.log('[ITPAMap] Auto-fit aplicado com bounds.pad(0.15) estendendo latitude norte:', totalBoundsFolga);
        }
      }

      return talhoesLayer;
    } catch (err) {
      console.warn('[ITPAMap] Falha ao carregar GeoJSON dos talhões:', err);
      return null;
    }
  }

  /**
   * Alterna dinamicamente o projeto ativo no WebGIS (Arquitetura Multi-Projetos).
   * Executa map.flyTo / map.fitBounds, remove o vetor anterior e renderiza o novo GeoJSON da pasta DATA/.
   * @param {string} projetoKey Chave do projeto ('esec', 'nelito', 'guanai')
   */
  async function selecionarProjeto(projetoKey) {
    const projetos = window.PROJETOS || {};
    const projeto = projetos[projetoKey];

    if (!projeto) {
      console.warn(`[ITPAMap] Projeto '${projetoKey}' não encontrado no catálogo PROJETOS.`);
      return;
    }

    window.PROJETO_ATIVO_ID = projetoKey;

    // Sincroniza o seletor HTML caso a chamada tenha vindo via script
    const selectEl = document.getElementById('select-projeto');
    if (selectEl && selectEl.value !== projetoKey) {
      selectEl.value = projetoKey;
    }

    // 0. Injeção dinâmica imediata e síncrona nos campos do painel de auditoria territorial (.card-auditoria / #painel-auditoria)
    if (window.ITPAAuditoria && typeof window.ITPAAuditoria.definirProjetoAtivo === 'function') {
      window.ITPAAuditoria.definirProjetoAtivo(projetoKey);
    }

    console.log(`[ITPAMap] Alternando para o projeto ativo: ${projeto.nome} (${projetoKey})`);

    // 1. Remove vetor anterior do projeto se existir
    if (talhoesLayer && map) {
      map.removeLayer(talhoesLayer);
      if (layerControl) {
        layerControl.removeLayer(talhoesLayer);
      }
      talhoesLayer = null;
    }

    // 2. Se for a ESEC Guanabara (Guapimirim / APA)
    if (projetoKey === 'esec') {
      await carregarTalhoesGeoJSON(projeto.arquivo_geojson || projeto.geojson || './DATA/esec_poligono.geojson');
      if (map) {
        if (talhoesLayer && talhoesLayer.getBounds && talhoesLayer.getBounds().isValid()) {
          map.fitBounds(talhoesLayer.getBounds().pad(0.15), { padding: [30, 30], maxZoom: 15 });
        } else {
          map.flyTo(projeto.coordenadas_centro || projeto.coords, projeto.zoom, { duration: 1.5 });
        }
      }
    } else {
      // 3. Fazenda Nelito ou Fazenda Guanaí (Miguel Pereira - RJ)
      // Oculta camadas de satélite específicas da ESEC Guanabara que pertencem a outra região geográfica
      if (map) {
        if (layerGroupNdviRecente && map.hasLayer(layerGroupNdviRecente)) map.removeLayer(layerGroupNdviRecente);
        if (layerGroupRgbRecente && map.hasLayer(layerGroupRgbRecente)) map.removeLayer(layerGroupRgbRecente);
        if (layerGroupNdviAnterior && map.hasLayer(layerGroupNdviAnterior)) map.removeLayer(layerGroupNdviAnterior);
        if (layerGroupRgbAnterior && map.hasLayer(layerGroupRgbAnterior)) map.removeLayer(layerGroupRgbAnterior);
        if (ortofotoLayer && map.hasLayer(ortofotoLayer)) map.removeLayer(ortofotoLayer);
      }

      // Caminhos candidatos para o GeoJSON oficial do projeto
      const arquivoGeojson = projeto.arquivo_geojson || projeto.geojson;
      const caminhos = [
        './' + arquivoGeojson,
        arquivoGeojson,
        './DATA/' + arquivoGeojson.split('/').pop(),
        './data/' + arquivoGeojson.split('/').pop()
      ];

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
        } catch (e) {}
      }

      if (geojsonData) {
        console.log(`[ITPAMap] Polígono do projeto ${projeto.nome} carregado de: ${urlSucesso}`);

        talhoesLayer = L.geoJSON(geojsonData, {
          style: function () {
            return {
              color: '#27ae60',       // Contorno verde escuro (#27ae60)
              weight: 3.5,
              opacity: 1.0,
              fillColor: '#2ecc71',   // Preenchimento verde (#2ecc71) levemente translúcido
              fillOpacity: 0.20
            };
          },
          onEachFeature: function (feature, layer) {
            const props = feature.properties || {};
            const nomeImovel = props.Name || props.nome || projeto.nome;

            layer.on({
              mouseover: function (e) {
                e.target.setStyle({ weight: 4.5, color: '#1e8449', fillOpacity: 0.35 });
                if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) e.target.bringToFront();
              },
              mouseout: function (e) {
                talhoesLayer.resetStyle(e.target);
              }
            });

            const popupHtml = `
              <div class="itpa-popup-card talhao-analytic-popup">
                <div class="talhao-popup-header">
                  <span class="talhao-badge">🏛️ PROJETO ATIVO</span>
                  <span class="talhao-code-pill">${projetoKey.toUpperCase()}</span>
                </div>
                <div class="talhao-popup-body">
                  <h3 class="talhao-popup-title">${projeto.nome}</h3>
                  <span class="talhao-popup-layer">Município: ${projeto.municipio || 'Miguel Pereira - RJ'}</span>
                  <div class="talhao-popup-metrics" style="grid-template-columns: 1fr; margin-top: 8px;">
                    <div class="metric-chip">
                      <span class="metric-chip-label">Área Registrada</span>
                      <span class="metric-chip-val">${projeto.area_registrada || projeto.area}</span>
                    </div>
                    <div class="metric-chip" style="margin-top: 4px;">
                      <span class="metric-chip-label">Código do CAR</span>
                      <span class="metric-chip-val" style="font-size: 11px; word-break: break-all;">${projeto.car}</span>
                    </div>
                    <div class="metric-chip" style="margin-top: 4px;">
                      <span class="metric-chip-label">Conformidade CMN</span>
                      <span class="metric-chip-val" style="font-size: 11px; color: #15803d; font-weight: 700;">${projeto.cmn_status || 'CONFORME'}</span>
                    </div>
                    <div class="metric-chip" style="margin-top: 4px;">
                      <span class="metric-chip-label">Elegibilidade Crédito</span>
                      <span class="metric-chip-val" style="font-size: 11px; color: #15803d; font-weight: 700;">${projeto.elegibilidade_credito || 'ELEGÍVEL'}</span>
                    </div>
                  </div>
                  <div style="margin-top: 10px; display: flex; gap: 6px;">
                    <button type="button" class="btn-itpa-pill btn-abrir-auditoria-proj" style="width: 100%; justify-content: center; font-size: 11.5px; padding: 6px 10px;">
                      ⚖️ Ver Auditoria Territorial
                    </button>
                  </div>
                </div>
              </div>
            `;
            layer.bindPopup(popupHtml, { maxWidth: 320, className: 'itpa-leaflet-popup' });

            layer.on('popupopen', () => {
              const btnAudit = document.querySelector('.btn-abrir-auditoria-proj');
              if (btnAudit) {
                btnAudit.onclick = () => {
                  const card = document.getElementById('card-auditoria-cmn');
                  if (card) {
                    card.classList.remove('collapsed');
                    const pill = document.getElementById('pill-quick-auditoria');
                    if (pill) pill.classList.add('active');
                  }
                };
              }
            });
          }
        });

        if (map) {
          talhoesLayer.addTo(map);
          if (layerControl) {
            layerControl.addOverlay(talhoesLayer, `🌱 Limites: ${projeto.nome}`);
          }
          if (talhoesLayer.getBounds().isValid()) {
            map.fitBounds(talhoesLayer.getBounds().pad(0.15), {
              padding: [30, 30],
              maxZoom: 16
            });
          } else {
            map.flyTo(projeto.coordenadas_centro || projeto.coords, projeto.zoom, { duration: 1.5 });
          }
        }
      } else {
        if (map) {
          map.flyTo(projeto.coordenadas_centro || projeto.coords, projeto.zoom, { duration: 1.5 });
        }
      }
    }

    // 4. Notifica o módulo de auditoria territorial para atualizar o CAR, município, área e elegibilidade oficiais
    if (window.ITPAAuditoria && typeof window.ITPAAuditoria.definirProjetoAtivo === 'function') {
      window.ITPAAuditoria.definirProjetoAtivo(projetoKey);
    }

    // Expande o card de auditoria na tela para visualização imediata dos dados reais do imóvel selecionado
    const cardAudit = document.getElementById('card-auditoria-cmn');
    if (cardAudit) {
      cardAudit.classList.remove('collapsed');
      const pill = document.getElementById('pill-quick-auditoria');
      if (pill) pill.classList.add('active');
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
    const toggleRgbAnt = document.getElementById('sheet-toggle-rgb-ant');
    const toggleTalhoes = document.getElementById('sheet-toggle-talhoes');
    const toggleCar = document.getElementById('sheet-toggle-car');
    const toggleProdes = document.getElementById('sheet-toggle-prodes');
    const toggleIbama = document.getElementById('sheet-toggle-ibama');

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

      // 4. Passagem Anterior NDVI (09/Set - 2m)
      const ndviAntAtivo = layerGroupNdviAnterior && map.hasLayer(layerGroupNdviAnterior);
      if (toggleNdviAnt) toggleNdviAnt.checked = !!ndviAntAtivo;

      // 4b. Passagem Anterior RGB (09/Set - 2m)
      const rgbAntAtivo = layerGroupRgbAnterior && map.hasLayer(layerGroupRgbAnterior);
      if (toggleRgbAnt) toggleRgbAnt.checked = !!rgbAntAtivo;

      // 5. Limites dos Talhões
      const talhoesAtivo = talhoesLayer && map.hasLayer(talhoesLayer);
      if (toggleTalhoes) toggleTalhoes.checked = !!talhoesAtivo;

      // 5b. Conformidade e Auditoria de Crédito (CMN nº 5.303/2026)
      const carAtivo = layerGroupCar && map.hasLayer(layerGroupCar);
      if (toggleCar) toggleCar.checked = !!carAtivo;

      const prodesAtivo = layerGroupProdes && map.hasLayer(layerGroupProdes);
      if (toggleProdes) toggleProdes.checked = !!prodesAtivo;

      const ibamaAtivo = layerGroupIbama && map.hasLayer(layerGroupIbama);
      if (toggleIbama) toggleIbama.checked = !!ibamaAtivo;

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

    if (toggleRgbAnt) {
      toggleRgbAnt.onchange = () => {
        if (toggleRgbAnt.checked) {
          if (layerGroupRgbAnterior && !map.hasLayer(layerGroupRgbAnterior)) map.addLayer(layerGroupRgbAnterior);
        } else {
          if (layerGroupRgbAnterior && map.hasLayer(layerGroupRgbAnterior)) map.removeLayer(layerGroupRgbAnterior);
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

    if (toggleCar) {
      toggleCar.onchange = () => {
        if (toggleCar.checked) {
          if (layerGroupCar && !map.hasLayer(layerGroupCar)) map.addLayer(layerGroupCar);
        } else {
          if (layerGroupCar && map.hasLayer(layerGroupCar)) map.removeLayer(layerGroupCar);
        }
        sincronizarEstadosUI();
      };
    }

    if (toggleProdes) {
      toggleProdes.onchange = () => {
        if (toggleProdes.checked) {
          if (layerGroupProdes && !map.hasLayer(layerGroupProdes)) map.addLayer(layerGroupProdes);
        } else {
          if (layerGroupProdes && map.hasLayer(layerGroupProdes)) map.removeLayer(layerGroupProdes);
        }
        sincronizarEstadosUI();
      };
    }

    if (toggleIbama) {
      toggleIbama.onchange = () => {
        if (toggleIbama.checked) {
          if (layerGroupIbama && !map.hasLayer(layerGroupIbama)) map.addLayer(layerGroupIbama);
        } else {
          if (layerGroupIbama && map.hasLayer(layerGroupIbama)) map.removeLayer(layerGroupIbama);
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
  let swipePctAtual = 50;
  let swipeCamadasPrevias = null;

  function atualizarPosicaoSwipe(pct) {
    if (!map || !swipeAtivo) return;

    // Garante valor numérico seguro entre 0% e 100%
    const clampedPct = Math.max(0, Math.min(100, Number(pct)));
    swipePctAtual = clampedPct;

    // Atualiza a posição da linha divisória
    const divider = document.getElementById('swipe-divider-line');
    if (divider) {
      divider.style.left = `${clampedPct}%`;
    }

    // Aplica o corte diretamente nos contentores dos painéis (com suporte WebKit/Safari)
    const leftPane = map.getPane('leftPane');
    const rightPane = map.getPane('rightPane');

    if (leftPane) {
      leftPane.style.clipPath = `polygon(0 0, ${clampedPct}% 0, ${clampedPct}% 100%, 0 100%)`;
      leftPane.style.webkitClipPath = `polygon(0 0, ${clampedPct}% 0, ${clampedPct}% 100%, 0 100%)`;
    }

    if (rightPane) {
      rightPane.style.clipPath = `polygon(${clampedPct}% 0, 100% 0, 100% 100%, ${clampedPct}% 100%)`;
      rightPane.style.webkitClipPath = `polygon(${clampedPct}% 0, 100% 0, 100% 100%, ${clampedPct}% 100%)`;
    }

    // Compatibilidade com panes legado
    const satPane = map.getPane('satelitePane');
    if (satPane && satPane !== leftPane) {
      satPane.style.clipPath = `polygon(0 0, ${clampedPct}% 0, ${clampedPct}% 100%, 0 100%)`;
      satPane.style.webkitClipPath = `polygon(0 0, ${clampedPct}% 0, ${clampedPct}% 100%, 0 100%)`;
    }

    const satAntPane = map.getPane('sateliteAnteriorPane');
    if (satAntPane && satAntPane !== rightPane) {
      satAntPane.style.clipPath = `polygon(${clampedPct}% 0, 100% 0, 100% 100%, ${clampedPct}% 100%)`;
      satAntPane.style.webkitClipPath = `polygon(${clampedPct}% 0, 100% 0, 100% 100%, ${clampedPct}% 100%)`;
    }
  }

  function ativarModoSwipe(talhaoFoco = null, bounds = null) {
    if (!map) return;
    swipeAtivo = true;

    const swipeContainer = document.getElementById('map-swipe-container');
    const pillSwipe = document.getElementById('pill-quick-swipe');
    if (pillSwipe) pillSwipe.classList.add('active');

    // 1. Salva o estado exato das camadas antes de entrar no modo swipe
    swipeCamadasPrevias = {
      ndviRecente: !!(layerGroupNdviRecente && map.hasLayer(layerGroupNdviRecente)),
      ndviAnterior: !!(layerGroupNdviAnterior && map.hasLayer(layerGroupNdviAnterior)),
      rgbRecente: !!(layerGroupRgbRecente && map.hasLayer(layerGroupRgbRecente)),
      rgbAnterior: !!(layerGroupRgbAnterior && map.hasLayer(layerGroupRgbAnterior))
    };

    // 2. Determina o modo ativo: prioriza RGB se qualquer uma das camadas RGB estiver ligada
    const isModoRgb = swipeCamadasPrevias.rgbRecente || swipeCamadasPrevias.rgbAnterior;

    const titleLeft = document.querySelector('.swipe-tag.left .swipe-title');
    const titleRight = document.querySelector('.swipe-tag.right .swipe-title');
    const subLeft = document.querySelector('.swipe-tag.left .swipe-sub');
    const subRight = document.querySelector('.swipe-tag.right .swipe-sub');

    if (isModoRgb) {
      // Isola modo RGB: desativa temporariamente NDVI para evitar sobreposição/mistura
      if (layerGroupNdviRecente && map.hasLayer(layerGroupNdviRecente)) {
        map.removeLayer(layerGroupNdviRecente);
      }
      if (layerGroupNdviAnterior && map.hasLayer(layerGroupNdviAnterior)) {
        map.removeLayer(layerGroupNdviAnterior);
      }

      // Garante RGB Recente (leftPane) e RGB Anterior (rightPane) ativos no mapa
      if (layerGroupRgbRecente && !map.hasLayer(layerGroupRgbRecente)) {
        map.addLayer(layerGroupRgbRecente);
      }
      if (layerGroupRgbAnterior && !map.hasLayer(layerGroupRgbAnterior)) {
        map.addLayer(layerGroupRgbAnterior);
      }

      if (titleLeft) titleLeft.textContent = '🛰️ RGB Recente (2m)';
      if (subLeft) subLeft.textContent = '28/Out';
      if (titleRight) titleRight.textContent = '⏪ RGB Anterior (2m)';
      if (subRight) subRight.textContent = '09/Set';

      // Esconde legenda de NDVI no modo RGB
      const ndviLegendEl = document.getElementById('ndvi-legend');
      if (ndviLegendEl) ndviLegendEl.style.display = 'none';
    } else {
      // Padrão NDVI: isola modo NDVI, desativando RGB
      if (layerGroupRgbRecente && map.hasLayer(layerGroupRgbRecente)) {
        map.removeLayer(layerGroupRgbRecente);
      }
      if (layerGroupRgbAnterior && map.hasLayer(layerGroupRgbAnterior)) {
        map.removeLayer(layerGroupRgbAnterior);
      }

      // Garante NDVI Recente (leftPane) e NDVI Anterior (rightPane) ativos no mapa
      if (layerGroupNdviRecente && !map.hasLayer(layerGroupNdviRecente)) {
        map.addLayer(layerGroupNdviRecente);
      }
      if (layerGroupNdviAnterior && !map.hasLayer(layerGroupNdviAnterior)) {
        map.addLayer(layerGroupNdviAnterior);
      }

      if (titleLeft) titleLeft.textContent = '🌱 NDVI Recente (2m)';
      if (subLeft) subLeft.textContent = '28/Out';
      if (titleRight) titleRight.textContent = '⏪ NDVI Anterior (2m)';
      if (subRight) subRight.textContent = '09/Set';

      // Exibe legenda de NDVI no modo NDVI
      const ndviLegendEl = document.getElementById('ndvi-legend');
      if (ndviLegendEl) ndviLegendEl.style.display = 'block';
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
    atualizarPosicaoSwipe(50);
    setTimeout(() => {
      atualizarPosicaoSwipe(50);
    }, 80);
    setTimeout(() => {
      atualizarPosicaoSwipe(50);
    }, 300);
  }

  function desativarModoSwipe() {
    swipeAtivo = false;
    const swipeContainer = document.getElementById('map-swipe-container');
    const pillSwipe = document.getElementById('pill-quick-swipe');
    if (pillSwipe) pillSwipe.classList.remove('active');

    if (swipeContainer) {
      swipeContainer.style.display = 'none';
    }

    // Restaura o clipPath em todos os painéis
    const leftPane = map ? map.getPane('leftPane') : null;
    const rightPane = map ? map.getPane('rightPane') : null;
    const satPane = map ? map.getPane('satelitePane') : null;
    const satAntPane = map ? map.getPane('sateliteAnteriorPane') : null;

    if (leftPane) {
      leftPane.style.clipPath = '';
      leftPane.style.webkitClipPath = '';
    }
    if (rightPane) {
      rightPane.style.clipPath = '';
      rightPane.style.webkitClipPath = '';
    }
    if (satPane) {
      satPane.style.clipPath = '';
      satPane.style.webkitClipPath = '';
    }
    if (satAntPane) {
      satAntPane.style.clipPath = '';
      satAntPane.style.webkitClipPath = '';
    }

    // Restaura fielmente o estado prévio das camadas
    if (swipeCamadasPrevias && map) {
      const restaurarCamada = (camada, estavaAtiva) => {
        if (!camada) return;
        const estaAtiva = map.hasLayer(camada);
        if (estavaAtiva && !estaAtiva) {
          map.addLayer(camada);
        } else if (!estavaAtiva && estaAtiva) {
          map.removeLayer(camada);
        }
      };

      restaurarCamada(layerGroupNdviRecente, swipeCamadasPrevias.ndviRecente);
      restaurarCamada(layerGroupNdviAnterior, swipeCamadasPrevias.ndviAnterior);
      restaurarCamada(layerGroupRgbRecente, swipeCamadasPrevias.rgbRecente);
      restaurarCamada(layerGroupRgbAnterior, swipeCamadasPrevias.rgbAnterior);

      swipeCamadasPrevias = null;
    } else if (map) {
      // Fallback seguro de limpeza
      if (layerGroupNdviAnterior && map.hasLayer(layerGroupNdviAnterior)) {
        map.removeLayer(layerGroupNdviAnterior);
      }
      if (layerGroupRgbAnterior && map.hasLayer(layerGroupRgbAnterior)) {
        map.removeLayer(layerGroupRgbAnterior);
      }
    }

    if (map && map.dragging) {
      map.dragging.enable();
    }

    sincronizarEstadosUI();
  }

  function setupSwipeInteractions() {
    const divider = document.getElementById('swipe-divider-line');
    const handle = document.getElementById('swipe-handle');
    const btnClose = document.getElementById('btn-close-swipe');
    const pillSwipe = document.getElementById('pill-quick-swipe');
    const swipeContainer = document.getElementById('map-swipe-container');

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

    function calcularPctDeEvento(e) {
      const mapEl = document.getElementById('map');
      if (!mapEl) return 50;
      const rect = mapEl.getBoundingClientRect();

      let clientX = e.clientX;
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
      } else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
      }

      if (clientX === undefined || isNaN(clientX)) return swipePctAtual;

      const xRel = clientX - rect.left;
      const pctRaw = (xRel / rect.width) * 100;
      return Math.max(0, Math.min(100, pctRaw));
    }

    const startDrag = (e) => {
      // Impede o scroll e gestos padrão do navegador no mobile
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      if (map && map.dragging) map.dragging.disable();

      const pct = calcularPctDeEvento(e);
      atualizarPosicaoSwipe(pct);
    };

    const doDrag = (e) => {
      if (!isDragging) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();

      const pct = calcularPctDeEvento(e);
      atualizarPosicaoSwipe(pct);
    };

    const stopDrag = () => {
      if (isDragging) {
        isDragging = false;
        if (map && map.dragging) map.dragging.enable();
      }
    };

    // Eventos táteis com { passive: false } obrigatório para mobile Safari/Chrome
    if (handle) {
      handle.addEventListener('touchstart', startDrag, { passive: false });
      handle.addEventListener('touchmove', doDrag, { passive: false });
      handle.addEventListener('touchend', stopDrag, { passive: false });
      handle.addEventListener('touchcancel', stopDrag, { passive: false });
      handle.addEventListener('mousedown', startDrag);
    }
    if (divider) {
      divider.addEventListener('touchstart', startDrag, { passive: false });
      divider.addEventListener('touchmove', doDrag, { passive: false });
      divider.addEventListener('touchend', stopDrag, { passive: false });
      divider.addEventListener('touchcancel', stopDrag, { passive: false });
      divider.addEventListener('mousedown', startDrag);
    }

    if (swipeContainer) {
      swipeContainer.addEventListener('touchmove', doDrag, { passive: false });
      swipeContainer.addEventListener('touchend', stopDrag, { passive: false });
      swipeContainer.addEventListener('touchcancel', stopDrag, { passive: false });
    }

    window.addEventListener('touchmove', doDrag, { passive: false });
    window.addEventListener('touchend', stopDrag, { passive: false });
    window.addEventListener('touchcancel', stopDrag, { passive: false });

    window.addEventListener('mousemove', doDrag);
    window.addEventListener('mouseup', stopDrag);

    if (map) {
      // Recalcula e redesenha os panes ('leftPane' e 'rightPane') sem perder o corte nem as imagens no zoom
      map.on('zoomend moveend', updateSwipeClip);
      map.on('resize viewreset', updateSwipeClip);
    }
  }

  /**
   * Recalcula e redesenha os panes ('leftPane' e 'rightPane') sem perder o corte nem as imagens
   */
  function updateSwipeClip() {
    if (!map || !swipeAtivo) return;
    atualizarPosicaoSwipe(swipePctAtual);
  }

  function getMapInstance() {
    return map;
  }

  return {
    init,
    carregarTalhoesGeoJSON,
    selecionarProjeto,
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
    getLayerGroupCar: () => layerGroupCar,
    getLayerGroupProdes: () => layerGroupProdes,
    getLayerGroupIbama: () => layerGroupIbama,
    carregarCarNoMapa,
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
