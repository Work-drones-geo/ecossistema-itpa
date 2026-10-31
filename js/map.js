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
  let projetoPendente = null;
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
      '🌱 NDVI de Alta Resolução (Recente 2m)': layerGroupNdviRecente,
      '🛰️ Satélite RGB (Recente 2m)': layerGroupRgbRecente,
      '🌱 NDVI - Passagem Anterior (09/Set - 2m)': layerGroupNdviAnterior,
      '🛰️ Satélite RGB - Passagem Anterior (2m)': layerGroupRgbAnterior,
      '🏛️ Base CAR (Polígono Oficial)': layerGroupCar,
      '🚨 Alertas PRODES (> 31/07/2019)': layerGroupProdes,
      '🚫 Embargos Ambientais (IBAMA)': layerGroupIbama
    };

    // Controle nativo de camadas integrado ao mapa
    layerControl = L.control.layers(baseLayers, overlays, { collapsed: true });
    layerControl.addTo(map);

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

    // Listener global de popup para garantir que o botão 'Ver Auditoria Territorial' funcione em qualquer dispositivo
    map.on('popupopen', (e) => {
      const popupEl = e.popup ? e.popup.getElement() : null;
      if (!popupEl) return;
      const btnAudit = popupEl.querySelector('.btn-abrir-auditoria-proj');
      if (btnAudit) {
        L.DomEvent.disableClickPropagation(btnAudit);
        L.DomEvent.on(btnAudit, 'click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          L.DomEvent.preventDefault(ev);
          const pKey = btnAudit.getAttribute('data-projeto') || window.PROJETO_ATIVO_ID || 'nelito';
          if (typeof window.abrirAuditoriaDoProjeto === 'function') {
            window.abrirAuditoriaDoProjeto(pKey);
          }
          map.closePopup();
        });
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

    // 5. Clique no mapa para capturar coordenadas ou abrir talhões
    map.on('click', (e) => {
      if (typeof onPointSelectedCallback === 'function') {
        const { lat, lng } = e.latlng;
        setTempMarker(lat, lng);
        onPointSelectedCallback(lat, lng);
        return;
      }

      // Detecção de clique complementar: se o clique incidiu no interior de algum polígono, abre seu pop-up
      if (talhoesLayer && map.hasLayer(talhoesLayer) && e && e.latlng) {
        let aberto = false;
        talhoesLayer.eachLayer((polyLayer) => {
          if (aberto) return;
          if (polyLayer.getBounds && polyLayer.getBounds().contains(e.latlng)) {
            const f = polyLayer.feature;
            if (f && f.geometry) {
              const geom = f.geometry;
              const coords = geom.type === 'Polygon' ? geom.coordinates : (geom.type === 'MultiPolygon' ? geom.coordinates[0] : null);
              if (coords && verificarPontoNoPoligono(e.latlng.lat, e.latlng.lng, coords)) {
                aberto = true;
                polyLayer.openPopup(e.latlng);
                return;
              }
            }
            // Fallback pelos bounds se não houver coordenadas inspecionáveis
            aberto = true;
            polyLayer.openPopup(e.latlng);
          }
        });
      }
    });

    // 6. Inicialização do Projeto Ativo no WebGIS (Arquitetura Multi-Projetos)
    const selectProjetoEl = document.getElementById('select-projeto');
    const projetoInicial = projetoPendente || (selectProjetoEl ? selectProjetoEl.value : 'esec');
    projetoPendente = null;
    selecionarProjeto(projetoInicial);

    if (selectProjetoEl && !selectProjetoEl._hasChangeBound) {
      selectProjetoEl._hasChangeBound = true;
      selectProjetoEl.addEventListener('change', function () {
        if (typeof window.trocarProjeto === 'function') {
          window.trocarProjeto(this.value);
        } else {
          selecionarProjeto(this.value);
        }
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
   * Algoritmo Ray-Casting leve para verificar se coordenada [lat, lng] incide no interior de polígono GeoJSON
   * Usado para garantir detecção à prova de falhas em cliques/toques móveis.
   */
  function verificarPontoNoPoligono(lat, lng, coordinates) {
    if (!coordinates || !coordinates.length) return false;
    const ring = Array.isArray(coordinates[0][0]) ? coordinates[0] : coordinates;
    let dentro = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
      if (intersect) dentro = !dentro;
    }
    return dentro;
  }

  /**
   * Constrói o HTML estruturado e padronizado para Pop-ups (ESEC Guanabara, Nelito e Guanaí)
   * Seguindo rigorosamente a identidade visual Agritech do Ecossistema ITPA.
   */
  function gerarHtmlPopupPadronizado(p) {
    const isEsec = p.tipo === 'esec';
    return `
      <div class="itpa-popup-card talhao-analytic-popup imovel-analytic-popup">
        <!-- 1. Header do Pop-up Padronizado: Status e Código Pill -->
        <div class="talhao-popup-header">
          <span class="talhao-badge">${p.badge || 'MONITORAMENTO ATIVO'}</span>
          <span class="talhao-code-pill">${p.codigoPill || (p.key ? p.key.toUpperCase() : 'GEO')}</span>
        </div>

        <!-- 2. Título do Imóvel / Talhão -->
        <h4 class="talhao-popup-title">${p.nome}</h4>

        <!-- 3. Grid de Métricas Principais (2 colunas padronizadas) -->
        <div class="talhao-metrics-grid">
          <div class="metric-card">
            <span class="metric-icon">📍</span>
            <div class="metric-data">
              <span class="metric-label">Município / Região</span>
              <span class="metric-value" style="font-size: 0.76rem;">${p.municipio}</span>
            </div>
          </div>
          <div class="metric-card">
            <span class="metric-icon">📐</span>
            <div class="metric-data">
              <span class="metric-label">Área Total</span>
              <span class="metric-value" style="font-size: 0.80rem; color: #15803d; font-weight: 700;">${p.areaTexto}</span>
            </div>
          </div>
        </div>

        <!-- 4. Bloco Analítico / Conformidade Pericial -->
        ${isEsec ? `
          <div class="talhao-ndvi-card" style="margin-bottom: 8px;">
            <div class="ndvi-card-header">
              <div class="ndvi-header-left">
                <span class="ndvi-header-icon">🌿</span>
                <span class="ndvi-header-title">Vigor NDVI Médio (2m)</span>
              </div>
              <span class="ndvi-value-badge">${p.ndviMeanTexto || '--'}</span>
            </div>
            <div class="ndvi-progress-wrapper">
              <div class="ndvi-progress-track">
                <div class="ndvi-progress-pin" style="left: ${p.ndviPct || 50}%;" title="Média: ${p.ndviMeanTexto || '--'}"></div>
              </div>
              <div class="ndvi-progress-scale-labels">
                <span>Solo (0.1)</span>
                <span>Médio (0.4)</span>
                <span>Dossel (0.8)</span>
              </div>
            </div>
            <div class="ndvi-card-footer">
              <span class="ndvi-range-tag">Conformidade: <strong>CNUC / ICMBio</strong></span>
              <span class="ndvi-class-tag">${p.ndviClasse || 'Vigor Vegetativo'}</span>
            </div>
          </div>
        ` : `
          <div class="imovel-popup-details" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 7px 10px; margin-bottom: 10px; font-size: 11px; line-height: 1.45;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
              <span style="color: #64748b; font-weight: 600;">Status CMN:</span>
              <span style="color: #16a34a; font-weight: 700;">${p.statusCmn || 'CONFORME CMN nº 5.303/2026'}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b; font-weight: 600;">Código CAR:</span>
              <span style="color: #334155; font-family: monospace; font-size: 10px;">${p.carCurto || p.car}</span>
            </div>
          </div>
        `}

        <!-- 5. Rodapé Padronizado de Ações Interativas (com botão Comparar em destaque!) -->
        <div class="talhao-popup-actions">
          <button type="button" class="btn-popup-action primary swipe-action-btn btn-popup-comparar" data-projeto="${p.key}" data-foco="${p.focoSwipe}" onclick="window.acionarComparacaoSwipe('${p.key || p.focoSwipe}')" ontouchend="window.acionarComparacaoSwipe('${p.key || p.focoSwipe}')">
            ↔️ Comparar Passagens Temporais
          </button>
          <div style="display: grid; grid-template-columns: ${isEsec ? '1fr 1fr' : '1fr'}; gap: 6px;">
            ${isEsec ? `
              <button type="button" class="btn-popup-action secondary btn-talhao-grafico" data-talhao="${p.nomeTalhao}">
                📈 Histórico
              </button>
            ` : ''}
            <button type="button" class="btn-popup-action secondary btn-abrir-auditoria-proj" data-projeto="${p.key}">
              ⚖️ Laudo & Auditoria
            </button>
          </div>
        </div>
      </div>
    `;
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

      // Estilo oficial da identidade do ITPA (Contorno vetorial nítido com captura confiável de cliques):
      talhoesLayer = L.geoJSON(geojsonData, {
        style: function () {
          return {
            stroke: true,
            color: '#2E7D32',       // Contorno verde nítido oficial
            weight: 2.5,            // Linha precisa sem preenchimento visível
            opacity: 1.0,           // Opacidade total no traço
            fill: true,
            fillColor: '#2E7D32',
            fillOpacity: 0.001,     // 100% transparente para a visão humana, mas força o SVG a registrar cliques em todo o interior
            interactive: true
          };
        },
        onEachFeature: function (feature, layer) {
          const props = feature.properties || {};
          const nomeTalhao = props.Name || props.nome || props.Nome || props.talhao || 'Área de Manejo';
          const layerOrigem = props.layer || '';
          const descricao = props.description || '';
          const codigo = props.id || props.codigo || '';

          // Efeito hover interativo nos polígonos
          layer.on({
            mouseover: function (e) {
              const poly = e.target;
              poly.setStyle({
                stroke: true,
                weight: 3.5,
                color: '#1B5E20',
                fill: true,
                fillColor: '#2E7D32',
                fillOpacity: 0.05
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

          // Pop-up Padronizado Oficial com Destaque para [ Comparar ]
          const popupHtml = gerarHtmlPopupPadronizado({
            tipo: 'esec',
            key: 'esec',
            focoSwipe: nomeTalhao,
            nomeTalhao: nomeTalhao,
            badge: 'MONITORAMENTO ATIVO',
            codigoPill: codigo || 'ESEC',
            nome: nomeTalhao,
            municipio: 'Guapimirim / APA - RJ',
            areaTexto: areaTexto,
            statusCmn: 'CONFORME CNUC / ICMBio',
            ndviMeanTexto: ndviMeanTexto,
            ndviPct: ndviPct,
            ndviClasse: ndviClasse
          });

          layer.bindPopup(popupHtml, {
            maxWidth: 320,
            minWidth: 260,
            className: 'talhao-popup-custom-wrapper',
            autoPan: true,
            autoPanPadding: [20, 20]
          });

          // Listener de clique explícito para abrir o popup em qualquer toque/clique no interior do polígono
          layer.on('click', function (e) {
            if (e) {
              if (e.originalEvent) {
                L.DomEvent.stopPropagation(e.originalEvent);
                L.DomEvent.preventDefault(e.originalEvent);
              }
              L.DomEvent.stopPropagation(e);
            }
            const clickPos = (e && e.latlng) ? e.latlng : (layer.getBounds ? layer.getBounds().getCenter() : null);
            if (clickPos) {
              layer.openPopup(clickPos);
            } else {
              layer.openPopup();
            }
          });

          layer.on('popupopen', () => {
            const popupEl = layer.getPopup() ? layer.getPopup().getElement() : null;
            if (!popupEl) return;

            const btnComp = popupEl.querySelector('.btn-popup-comparar');
            if (btnComp) {
              btnComp.onclick = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                ativarModoSwipe(nomeTalhao, layer.getBounds ? layer.getBounds() : null);
              };
            }

            const btnAudit = popupEl.querySelector('.btn-abrir-auditoria-proj');
            if (btnAudit) {
              btnAudit.onclick = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (typeof window.abrirAuditoriaDoProjeto === 'function') {
                  window.abrirAuditoriaDoProjeto('esec');
                }
                map.closePopup();
              };
            }

            const btnGrafico = popupEl.querySelector('.btn-talhao-grafico');
            if (btnGrafico && typeof window.ITPA_OnTalhaoGrafico === 'function') {
              btnGrafico.onclick = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                window.ITPA_OnTalhaoGrafico(nomeTalhao, props, layer.getBounds ? layer.getBounds() : null);
              };
            }
          });
        }
      });

      if (map) {
        talhoesLayer.addTo(map);

        if (layerControl) {
          layerControl.addOverlay(talhoesLayer, '🟩 Limites Territoriais Oficiais (ITPA)');
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

  // =========================================================================
  // Polígonos Oficiais Embutidos (Zero-Fail / Suporte Offline Absoluto)
  // Garante exibição imediata e infalível dos limites de Nelito e Guanaí
  // =========================================================================
  const POLIGONOS_EMBUTIDOS = {
    nelito: {
      type: "FeatureCollection",
      name: "nelito",
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
      features: [
        {
          type: "Feature",
          properties: { Name: "Fazenda Nelito - Limite Oficial" },
          geometry: {
            type: "Polygon",
            coordinates: [ [
              [ -43.55319519261522, -22.536344969047811, 0.0 ],
              [ -43.553271072707567, -22.53665849948041, 0.0 ],
              [ -43.552720502167872, -22.537864734511491, 0.0 ],
              [ -43.548734344815067, -22.545842954838701, 0.0 ],
              [ -43.547919341969752, -22.547945421182479, 0.0 ],
              [ -43.54501971742517, -22.553501096662242, 0.0 ],
              [ -43.542956672367133, -22.556060671281681, 0.0 ],
              [ -43.542514533094881, -22.554053436278721, 0.0 ],
              [ -43.539530935305777, -22.548080081769079, 0.0 ],
              [ -43.539609046180402, -22.54718841209111, 0.0 ],
              [ -43.544255109585102, -22.537788236118232, 0.0 ],
              [ -43.544495547353087, -22.537381472725361, 0.0 ],
              [ -43.546068990321388, -22.533592757669929, 0.0 ],
              [ -43.546363981142093, -22.532831488419841, 0.0 ],
              [ -43.54787247242718, -22.53351847351168, 0.0 ],
              [ -43.551202549443531, -22.535038032574949, 0.0 ],
              [ -43.55337196761436, -22.53599642954639, 0.0 ],
              [ -43.55319519261522, -22.536344969047811, 0.0 ]
            ] ]
          }
        }
      ]
    },
    guanai: {
      type: "FeatureCollection",
      name: "guanai",
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
      features: [
        {
          type: "Feature",
          properties: { id: "046596D24E32B5E48B05", Name: "Fazenda Guanaí - Limite Oficial" },
          geometry: {
            type: "Polygon",
            coordinates: [ [
              [ -43.551349433915597, -22.541512147836599, 0.0 ],
              [ -43.558557228926126, -22.54522545399022, 0.0 ],
              [ -43.557113755976793, -22.54906714864909, 0.0 ],
              [ -43.553164446043127, -22.557978895598271, 0.0 ],
              [ -43.5514540878807, -22.56118214040626, 0.0 ],
              [ -43.547913125465243, -22.557691916547761, 0.0 ],
              [ -43.545831270342141, -22.556157080222391, 0.0 ],
              [ -43.544213807404923, -22.554931226733899, 0.0 ],
              [ -43.545775900063468, -22.551945542584281, 0.0 ],
              [ -43.547461670805127, -22.548525878429881, 0.0 ],
              [ -43.549030103671782, -22.545217512266809, 0.0 ],
              [ -43.550063963686192, -22.543317738791231, 0.0 ],
              [ -43.551349433915597, -22.541512147836599, 0.0 ]
            ] ]
          }
        }
      ]
    }
  };

  // =========================================================================
  // Função Mestre de Sincronização Visual da Interface (Escopo do Módulo)
  // Atualiza as pílulas flutuantes e os switches da gaveta de camadas
  // =========================================================================
  function sincronizarEstadosUI() {
    if (!map) return;

    const pillNdvi = document.getElementById('pill-quick-ndvi');
    const pillDrone = document.getElementById('pill-quick-drone');
    const pillRgb = document.getElementById('pill-quick-rgb');
    const pillLimites = document.getElementById('pill-quick-limites');

    const toggleDrone = document.getElementById('sheet-toggle-drone');
    const toggleNdvi = document.getElementById('sheet-toggle-ndvi');
    const toggleRgb = document.getElementById('sheet-toggle-rgb');
    const toggleNdviAnt = document.getElementById('sheet-toggle-ndvi-ant');
    const toggleRgbAnt = document.getElementById('sheet-toggle-rgb-ant');
    const toggleTalhoes = document.getElementById('sheet-toggle-talhoes');
    const toggleCar = document.getElementById('sheet-toggle-car');
    const toggleProdes = document.getElementById('sheet-toggle-prodes');
    const toggleIbama = document.getElementById('sheet-toggle-ibama');
    const baseRadios = document.querySelectorAll('input[name="base-map-choice"]');

    const keyAtiva = (window.PROJETO_ATIVO_ID || 'esec').toLowerCase().trim();

    // 1. Ortofoto Drone (ESEC Guanabara)
    const droneAtivo = ortofotoLayer && map.hasLayer(ortofotoLayer);
    if (pillDrone) {
      pillDrone.classList.toggle('active', !!droneAtivo);
      pillDrone.style.display = 'flex';
    }
    if (toggleDrone) toggleDrone.checked = !!droneAtivo;

    // 2. Talhões NDVI 2m
    const ndviAtivo = layerGroupNdviRecente && map.hasLayer(layerGroupNdviRecente);
    if (pillNdvi) pillNdvi.classList.toggle('active', !!ndviAtivo);
    if (toggleNdvi) toggleNdvi.checked = !!ndviAtivo;

    // 3. Talhões RGB 2m / 10m
    const rgbAtivo = layerGroupRgbRecente && map.hasLayer(layerGroupRgbRecente);
    if (pillRgb) pillRgb.classList.toggle('active', !!rgbAtivo);
    if (toggleRgb) toggleRgb.checked = !!rgbAtivo;

    // 4. Passagem Anterior NDVI (09/Set - 2m)
    const ndviAntAtivo = layerGroupNdviAnterior && map.hasLayer(layerGroupNdviAnterior);
    if (toggleNdviAnt) toggleNdviAnt.checked = !!ndviAntAtivo;

    // 4b. Passagem Anterior RGB (09/Set - 2m)
    const rgbAntAtivo = layerGroupRgbAnterior && map.hasLayer(layerGroupRgbAnterior);
    if (toggleRgbAnt) toggleRgbAnt.checked = !!rgbAntAtivo;

    // 5. Limites Territoriais Oficiais / Perímetro Imóvel vs CAR
    const talhoesAtivo = talhoesLayer && map.hasLayer(talhoesLayer);
    if (pillLimites) pillLimites.classList.toggle('active', !!talhoesAtivo);
    if (toggleTalhoes) toggleTalhoes.checked = !!talhoesAtivo;

    // 5b. Conformidade e Auditoria de Crédito (CMN nº 5.303/2026)
    const carAtivo = layerGroupCar && map.hasLayer(layerGroupCar);
    if (toggleCar) toggleCar.checked = !!carAtivo;

    const prodesAtivo = layerGroupProdes && map.hasLayer(layerGroupProdes);
    if (toggleProdes) toggleProdes.checked = !!prodesAtivo;

    const ibamaAtivo = layerGroupIbama && map.hasLayer(layerGroupIbama);
    if (toggleIbama) toggleIbama.checked = !!ibamaAtivo;

    // 6. Mapas Base (Radios)
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

    // 7. Atualização do Badge Temporal Flutuante de Rastreabilidade das Imagens
    atualizarBadgeTemporal();

    // 8. Atualização Dinâmica do Texto do Switch de Drone no Menu de Camadas
    const labelDroneEl = document.getElementById('sheet-label-drone');
    if (labelDroneEl) {
      labelDroneEl.textContent = (keyAtiva === 'esec')
        ? 'Ortofoto Drone (Base 2025)'
        : 'Ortofoto Drone (Voo Recente 2026)';
    }
  }

  // =========================================================================
  // Rastreabilidade Temporal das Imagens (Badge Flutuante no Canto Superior Esquerdo)
  // Atualiza dinamicamente o badge conforme a camada ativa e a propriedade selecionada
  // =========================================================================
  function atualizarBadgeTemporal(textoCustomizado) {
    const badgeTextEl = document.getElementById('temporal-badge-text');
    if (!badgeTextEl) return;

    if (textoCustomizado) {
      badgeTextEl.textContent = textoCustomizado;
      return;
    }

    if (swipeAtivo) {
      badgeTextEl.textContent = 'COMPARAÇÃO TEMPORAL: 24/Out vs 04/Set';
      return;
    }

    const keyAtiva = (window.PROJETO_ATIVO_ID || 'esec').toLowerCase().trim();
    const droneAtivo = ortofotoLayer && map.hasLayer(ortofotoLayer);
    const ndviAtivo = layerGroupNdviRecente && map.hasLayer(layerGroupNdviRecente);
    const rgbAtivo = layerGroupRgbRecente && map.hasLayer(layerGroupRgbRecente);
    const ndviAntAtivo = layerGroupNdviAnterior && map.hasLayer(layerGroupNdviAnterior);
    const rgbAntAtivo = layerGroupRgbAnterior && map.hasLayer(layerGroupRgbAnterior);

    let texto = '';

    // Prioridade de exibição conforme as camadas ativas na visualização
    if (ndviAntAtivo && !ndviAtivo) {
      texto = 'NDVI HISTÓRICO: 04/Set/2026';
    } else if (rgbAntAtivo && !rgbAtivo) {
      texto = 'SATÉLITE HISTÓRICO: 04/Set/2026';
    } else if (ndviAtivo) {
      texto = 'NDVI: 24/Out/2026 (Super-resolvido 2m)';
    } else if (rgbAtivo) {
      texto = 'SATÉLITE: 24/Out/2026 (Sentinel-2 L2A)';
    } else if (droneAtivo) {
      if (keyAtiva === 'esec') {
        texto = 'DRONE: Voo Base 2025 (Alta Resolução)';
      } else {
        texto = 'DRONE: Voo Recente 2026';
      }
    } else if (ndviAntAtivo) {
      texto = 'NDVI HISTÓRICO: 04/Set/2026';
    } else if (rgbAntAtivo) {
      texto = 'SATÉLITE HISTÓRICO: 04/Set/2026';
    } else {
      texto = 'MAPA BASE: Esri World Imagery';
    }

    badgeTextEl.textContent = texto;
  }

  // =========================================================================
  // Configuração e Carregamento Dinâmico de Rasters (PNG / bounds.json) por Projeto
  // Permite que 'Satélite RGB', 'NDVI 2m' e 'Comparar' funcionem para Nelito, Guanaí e ESEC
  // =========================================================================
  const CONFIG_RASTERS_PROJETOS = {
    nelito: {
      nome: 'Fazenda Nelito',
      boundsJson: [
        'DATA/bounds.json',
        'assets/satelite/bounds_expandido.json',
        'assets/satelite/bounds.json',
        'assets/rasters/bounds.json',
        'assets/rasters/nelito_bounds.json',
        'DATA/nelito_bounds.json'
      ],
      fallbackBounds: [
        [-22.556060671, -43.553371968],
        [-22.532831488, -43.539530935]
      ],
      rgbRecente: 'DATA/nelito_rgb_10m.png',
      ndviRecente: 'DATA/nelito_ndvi_2m.png',
      fallbackRgbRecente: 'assets/satelite/nelito_rgb_10m.png',
      fallbackNdviRecente: 'assets/satelite/nelito_ndvi_2m.png',
      rgbAnterior: 'DATA/nelito_rgb_anterior.png',
      ndviAnterior: 'DATA/nelito_ndvi_anterior.png',
      fallbackRgbAnterior: 'assets/rasters/nelito_rgb_anterior.png',
      fallbackNdviAnterior: 'assets/rasters/nelito_ndvi_anterior.png',
      labelRecente: '24/Out (10m)',
      labelAnterior: '04/Set (10m)'
    },
    guanai: {
      nome: 'Fazenda Guanaí',
      boundsJson: [
        'DATA/bounds.json',
        'assets/satelite/bounds_expandido.json',
        'assets/satelite/bounds.json',
        'assets/rasters/bounds.json',
        'assets/rasters/guanai_bounds.json',
        'DATA/guanai_bounds.json'
      ],
      fallbackBounds: [
        [-22.561182140, -43.558557229],
        [-22.541512148, -43.544213807]
      ],
      rgbRecente: 'DATA/guanai_rgb_10m.png',
      ndviRecente: 'DATA/guanai_ndvi_2m.png',
      fallbackRgbRecente: 'assets/satelite/guanai_rgb_10m.png',
      fallbackNdviRecente: 'assets/satelite/guanai_ndvi_2m.png',
      rgbAnterior: 'DATA/guanai_rgb_anterior.png',
      ndviAnterior: 'DATA/guanai_ndvi_anterior.png',
      fallbackRgbAnterior: 'assets/rasters/guanai_rgb_anterior.png',
      fallbackNdviAnterior: 'assets/rasters/guanai_ndvi_anterior.png',
      labelRecente: '24/Out (10m)',
      labelAnterior: '04/Set (10m)'
    },
    esec: {
      nome: 'ESEC Guanabara',
      boundsJson: [
        'DATA/bounds.json',
        'assets/satelite/bounds_expandido.json',
        'assets/satelite/bounds.json',
        'assets/rasters/esec_bounds.json',
        'DATA/esec_bounds.json'
      ],
      fallbackBounds: [
        [-22.737766, -43.022287],
        [-22.691124, -42.949613]
      ],
      rgbRecente: 'assets/satelite/aoi_rgb_recente_2m.png',
      ndviRecente: 'assets/satelite/aoi_ndvi_recente_2m.png',
      fallbackRgbRecente: 'DATA/esec_rgb_2m.png',
      fallbackNdviRecente: 'DATA/esec_ndvi_2m.png',
      rgbAnterior: 'assets/satelite/aoi_rgb_anterior_2m.png',
      ndviAnterior: 'assets/satelite/aoi_ndvi_anterior_2m.png',
      fallbackRgbAnterior: 'DATA/esec_rgb_anterior.png',
      fallbackNdviAnterior: 'DATA/esec_ndvi_anterior.png',
      labelRecente: '24/Out (2m)',
      labelAnterior: '04/Set (2m)'
    }
  };

  /**
   * Instancia dinamicamente no Leaflet (via L.imageOverlay) os rasters em PNG de
   * Satélite RGB (10m/2m) e NDVI (2m) da fazenda ativa, usando os limites reais de bounds.json.
   * Garante que os botões 'Satélite RGB', 'NDVI 2m' e 'Comparar' funcionem para cada propriedade.
   * @param {string} projetoKey Chave da fazenda/projeto ('nelito', 'guanai', 'esec')
   */
  async function carregarRastersDoProjeto(projetoKey) {
    if (!map) return null;
    const key = (projetoKey || 'nelito').toLowerCase().trim();
    const config = CONFIG_RASTERS_PROJETOS[key] || CONFIG_RASTERS_PROJETOS.nelito;

    console.log(`[ITPAMap] Carregando rasters e limites para: ${config.nome} (${key})`);

    // 1. Memoriza se as camadas estavam ligadas para manter sua visibilidade
    const manterNdvi = layerGroupNdviRecente ? map.hasLayer(layerGroupNdviRecente) : false;
    const manterRgb = layerGroupRgbRecente ? map.hasLayer(layerGroupRgbRecente) : false;
    const manterNdviAnt = layerGroupNdviAnterior ? map.hasLayer(layerGroupNdviAnterior) : false;
    const manterRgbAnt = layerGroupRgbAnterior ? map.hasLayer(layerGroupRgbAnterior) : false;

    // 2. Limpa os overlays anteriores para evitar sobreposição de áreas geográficas distintas
    if (layerGroupNdviRecente) layerGroupNdviRecente.clearLayers();
    if (layerGroupRgbRecente) layerGroupRgbRecente.clearLayers();
    if (layerGroupNdviAnterior) layerGroupNdviAnterior.clearLayers();
    if (layerGroupRgbAnterior) layerGroupRgbAnterior.clearLayers();

    // 3. Lê assincronamente os limites do bounds.json correspondente
    let boundsOverlay = L.latLngBounds(config.fallbackBounds[0], config.fallbackBounds[1]);

    for (const urlBounds of config.boundsJson) {
      try {
        const resp = await fetch(urlBounds);
        if (resp.ok) {
          const bData = await resp.json();
          if (bData && Array.isArray(bData[key]) && bData[key].length === 2) {
            boundsOverlay = L.latLngBounds(bData[key][0], bData[key][1]);
            break;
          } else if (bData && bData[key] && bData[key].leaflet_bounds && bData[key].leaflet_bounds.length === 2) {
            boundsOverlay = L.latLngBounds(bData[key].leaflet_bounds[0], bData[key].leaflet_bounds[1]);
            break;
          } else if (bData && bData.leaflet_bounds && bData.leaflet_bounds.length === 2) {
            boundsOverlay = L.latLngBounds(bData.leaflet_bounds[0], bData.leaflet_bounds[1]);
            break;
          } else if (bData && bData.bounds && bData.bounds.length === 2) {
            boundsOverlay = L.latLngBounds(bData.bounds[0], bData.bounds[1]);
            break;
          }
        }
      } catch (e) {
        // Fallback já garantido
      }
    }

    // 4. Helper seguro para criar ImageOverlay georreferenciado com suporte a fallback de URL
    const criarOverlay = (caminhoImg, caminhoFallback, paneName = 'leftPane', opacity = 0.95) => {
      let currentSrc = caminhoImg;
      const overlay = L.imageOverlay(currentSrc, boundsOverlay, {
        opacity: opacity,
        interactive: false,
        pane: paneName,
        minZoom: 9,
        maxZoom: 22
      });
      overlay.on('error', () => {
        if (caminhoFallback && currentSrc !== caminhoFallback) {
          console.warn(`[ITPAMap] Fallback para imagem alternativa: ${caminhoFallback}`);
          currentSrc = caminhoFallback;
          overlay.setUrl(caminhoFallback);
        } else if (overlay.getElement()) {
          overlay.getElement().style.display = 'none';
        }
      });
      return overlay;
    };

    // 5. Instanciação das novas camadas PNG via L.imageOverlay
    if (layerGroupNdviRecente && config.ndviRecente) {
      layerGroupNdviRecente.addLayer(criarOverlay(config.ndviRecente, config.fallbackNdviRecente, 'leftPane'));
    }

    if (layerGroupRgbRecente && config.rgbRecente) {
      layerGroupRgbRecente.addLayer(criarOverlay(config.rgbRecente, config.fallbackRgbRecente, 'leftPane'));
    }

    if (layerGroupNdviAnterior && config.ndviAnterior) {
      layerGroupNdviAnterior.addLayer(criarOverlay(config.ndviAnterior, config.fallbackNdviAnterior, 'rightPane'));
    }

    if (layerGroupRgbAnterior && config.rgbAnterior) {
      layerGroupRgbAnterior.addLayer(criarOverlay(config.rgbAnterior, config.fallbackRgbAnterior, 'rightPane'));
    }

    // 6. Restaura as camadas no mapa se estavam ligadas pelo usuário
    if (manterNdvi && layerGroupNdviRecente && !map.hasLayer(layerGroupNdviRecente)) {
      map.addLayer(layerGroupNdviRecente);
    }
    if (manterRgb && layerGroupRgbRecente && !map.hasLayer(layerGroupRgbRecente)) {
      map.addLayer(layerGroupRgbRecente);
    }
    if (manterNdviAnt && layerGroupNdviAnterior && !map.hasLayer(layerGroupNdviAnterior)) {
      map.addLayer(layerGroupNdviAnterior);
    }
    if (manterRgbAnt && layerGroupRgbAnterior && !map.hasLayer(layerGroupRgbAnterior)) {
      map.addLayer(layerGroupRgbAnterior);
    }

    // 7. Atualiza os rótulos de data e resolução do comparador (Swipe)
    const subLeft = document.querySelector('.swipe-tag.left .swipe-sub');
    const subRight = document.querySelector('.swipe-tag.right .swipe-sub');
    if (subLeft && config.labelRecente) subLeft.textContent = config.labelRecente;
    if (subRight && config.labelAnterior) subRight.textContent = config.labelAnterior;

    // 8. Integração dinâmica com o controle de camadas L.control.layers
    if (layerControl) {
      try {
        layerControl.addOverlay(layerGroupRgbRecente, `🛰️ Satélite RGB: ${config.nome}`);
        layerControl.addOverlay(layerGroupNdviRecente, `🌱 NDVI 2m: ${config.nome}`);
      } catch (e) {}
    }

    sincronizarEstadosUI();
    return boundsOverlay;
  }

  /**
   * Constrói a camada vetorial (talhoesLayer) para uma fazenda privada (Nelito ou Guanaí)
   * Utiliza caminhos de arquivo DATA/ com contingência embutida POLIGONOS_EMBUTIDOS
   * @param {string} key 'nelito' ou 'guanai'
   * @param {Object} projeto Metadados do projeto
   */
  async function carregarLimitesFazendaPrivada(key, projeto) {
    let geojsonData = null;
    let urlSucesso = '';

    const arquivoGeojson = projeto.arquivo_geojson || projeto.geojson || `DATA/${key}.geojson`;
    const caminhos = [
      arquivoGeojson,
      './' + arquivoGeojson,
      'DATA/' + arquivoGeojson.split('/').pop(),
      './DATA/' + arquivoGeojson.split('/').pop(),
      'data/' + arquivoGeojson.split('/').pop()
    ];

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

    // Fallback de contingência garantido em memória (zero-fail)
    if (!geojsonData && POLIGONOS_EMBUTIDOS && POLIGONOS_EMBUTIDOS[key]) {
      console.log(`[ITPAMap] Usando polígono GeoJSON embutido de contingência para: ${projeto.nome}`);
      geojsonData = POLIGONOS_EMBUTIDOS[key];
      urlSucesso = 'memoria_embutida';
    }

    if (!geojsonData) {
      console.warn(`[ITPAMap] Não foi possível carregar limites para ${key}`);
      return null;
    }

    console.log(`[ITPAMap] Limites de ${projeto.nome} carregados de: ${urlSucesso}`);

    talhoesLayer = L.geoJSON(geojsonData, {
      style: function () {
        return {
          stroke: true,
          color: '#2E7D32',       // Contorno vetorial nítido oficial
          weight: 2.5,            // Traço exato sem preenchimento visível
          opacity: 1.0,           // Opacidade total no traço
          fill: true,
          fillColor: '#2E7D32',
          fillOpacity: 0.001,     // 100% transparente para a visão humana, mas força o SVG a registrar cliques em todo o interior
          interactive: true
        };
      },
      onEachFeature: function (feature, layer) {
        layer.on({
          mouseover: function (e) {
            e.target.setStyle({
              stroke: true,
              weight: 3.5,
              color: '#1B5E20',
              fill: true,
              fillColor: '#2E7D32',
              fillOpacity: 0.05
            });
            if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) e.target.bringToFront();
          },
          mouseout: function (e) {
            talhoesLayer.resetStyle(e.target);
          }
        });

        const nomeProp = projeto.nome || (key === 'nelito' ? 'Fazenda Nelito' : 'Fazenda Guanaí');
        const municipioProp = projeto.municipio || 'Miguel Pereira - RJ';
        const areaProp = projeto.area_registrada || projeto.area || (key === 'nelito' ? '246,116 ha' : '615,808 ha');
        const carProp = projeto.car || (key === 'nelito' ? 'RJ-3302908-AE983FB03BAE42A9B32833247D8CCD4D' : 'RJ-3302908-D52C6812F1464345885FE14360B005CE');
        const carCurto = carProp.length > 20 ? carProp.substring(0, 18) + '...' : carProp;

        // Pop-up Padronizado Oficial com Destaque para [ Comparar ]
        const popupHtml = gerarHtmlPopupPadronizado({
          tipo: 'fazenda',
          key: key,
          focoSwipe: key,
          badge: 'MONITORAMENTO ATIVO',
          codigoPill: key.toUpperCase(),
          nome: nomeProp,
          municipio: municipioProp,
          areaTexto: areaProp,
          statusCmn: 'CONFORME CMN nº 5.303/2026',
          car: carProp,
          carCurto: carCurto
        });

        layer.bindPopup(popupHtml, {
          maxWidth: 320,
          minWidth: 260,
          className: 'talhao-popup-custom-wrapper',
          autoPan: true,
          autoPanPadding: [20, 20]
        });

        // Listener explícito para abrir popup em qualquer toque/clique no interior do polígono
        layer.on('click', function (e) {
          if (e) {
            if (e.originalEvent) {
              L.DomEvent.stopPropagation(e.originalEvent);
              L.DomEvent.preventDefault(e.originalEvent);
            }
            L.DomEvent.stopPropagation(e);
          }
          const clickPos = (e && e.latlng) ? e.latlng : (layer.getBounds ? layer.getBounds().getCenter() : null);
          if (clickPos) {
            layer.openPopup(clickPos);
          } else {
            layer.openPopup();
          }
        });

        layer.on('popupopen', () => {
          const popupEl = layer.getPopup() ? layer.getPopup().getElement() : null;
          if (!popupEl) return;

          const btnComp = popupEl.querySelector('.btn-popup-comparar');
          if (btnComp) {
            btnComp.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              ativarModoSwipe(key, layer.getBounds ? layer.getBounds() : null);
            };
          }

          const btnAudit = popupEl.querySelector('.btn-abrir-auditoria-proj');
          if (btnAudit) {
            btnAudit.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (typeof window.abrirAuditoriaDoProjeto === 'function') {
                window.abrirAuditoriaDoProjeto(key);
              }
              map.closePopup();
            };
          }
        });
      }
    });

    if (map) {
      talhoesLayer.addTo(map);
    }

    return talhoesLayer;
  }

  /**
   * Recarrega sob demanda os limites oficiais da propriedade ativa caso ainda não estejam na memória.
   */
  async function recarregarLimitesDoProjetoAtivo() {
    const key = (window.PROJETO_ATIVO_ID || 'esec').toLowerCase().trim();
    const projetos = window.PROJETOS || {};
    const projeto = projetos[key] || (window.ITPA_DADOS_PROJETOS && window.ITPA_DADOS_PROJETOS[key]);
    if (!projeto) return null;

    if (key === 'esec') {
      return await carregarTalhoesGeoJSON(projeto.arquivo_geojson || projeto.geojson || './DATA/esec_poligono.geojson');
    } else {
      return await carregarLimitesFazendaPrivada(key, projeto);
    }
  }

  /**
   * Alterna a camada de Limites Territoriais Oficiais no mapa (ligar / desligar)
   * Se a camada estiver nula, dispara recarga imediata do GeoJSON do projeto ativo.
   * @param {boolean} [forcarAtivo]
   */
  async function alternarLimitesTerritoriais(forcarAtivo) {
    if (!map) return;
    const deveAtivar = (typeof forcarAtivo === 'boolean') 
      ? forcarAtivo 
      : !(talhoesLayer && map.hasLayer(talhoesLayer));

    if (deveAtivar) {
      if (!talhoesLayer) {
        await recarregarLimitesDoProjetoAtivo();
      } else if (!map.hasLayer(talhoesLayer)) {
        map.addLayer(talhoesLayer);
      }

      if (talhoesLayer && talhoesLayer.getBounds && talhoesLayer.getBounds().isValid()) {
        map.fitBounds(talhoesLayer.getBounds().pad(0.15), { maxZoom: 16 });
      }
    } else {
      if (talhoesLayer && map.hasLayer(talhoesLayer)) {
        map.removeLayer(talhoesLayer);
      }
    }

    sincronizarEstadosUI();
  }

  /**
   * Alterna dinamicamente o projeto ativo no WebGIS (Arquitetura Multi-Projetos).
   * Executa voo imediato (flyTo / fitBounds), remove ortofoto se for fazenda privada,
   * carrega e exibe o GeoJSON oficial e sincroniza as imagens de satélite.
   * @param {string} projetoKey Chave do projeto ('esec', 'nelito', 'guanai')
   */
  async function selecionarProjeto(projetoKey) {
    if (!map) {
      projetoPendente = projetoKey;
      return;
    }
    const projetos = window.PROJETOS || {};
    const key = (projetoKey || 'esec').toLowerCase().trim();
    const projeto = projetos[key] || (window.ITPA_DADOS_PROJETOS && window.ITPA_DADOS_PROJETOS[key]) || projetos.esec;

    if (!projeto) {
      console.warn(`[ITPAMap] Projeto '${key}' não encontrado no catálogo.`);
      return;
    }

    window.PROJETO_ATIVO_ID = key;

    // Sincroniza visualmente os botões do header
    const projectButtons = document.querySelectorAll('.btn-project-tab');
    projectButtons.forEach(btn => {
      const btnKey = (btn.getAttribute('data-projeto') || '').toLowerCase().trim();
      btn.classList.toggle('active', btnKey === key);
    });

    // Sincroniza o seletor HTML caso a chamada tenha vindo via script
    const selectEl = document.getElementById('select-projeto');
    if (selectEl && selectEl.value !== key) {
      selectEl.value = key;
    }

    // Atualização silenciosa dos dados da auditoria (sem abrir o card)
    if (typeof window.atualizarDadosAuditoria === 'function') {
      window.atualizarDadosAuditoria(key);
    } else if (typeof window.atualizarAuditoria === 'function') {
      window.atualizarAuditoria(key);
    }

    console.log(`[ITPAMap] Alternando para o projeto ativo: ${projeto.nome} (${key})`);

    // =========================================================================
    // ETAPA 1 (IMEDIATA / SÍNCRONA): Voo instantâneo e ajuste da ortofoto do drone
    // =========================================================================
    const coordsCentro = projeto.coordenadas_centro || projeto.coords || (key === 'nelito' ? [-22.544446, -43.546451] : key === 'guanai' ? [-22.551347, -43.551385] : [-22.705, -43.030]);
    const zoomAlvo = projeto.zoom || (key === 'esec' ? 14 : 15);

    if (key === 'esec') {
      // ESEC: Ativa ortofoto do voo de drone, desativa satélite RGB concorrente
      if (ortofotoLayer && !map.hasLayer(ortofotoLayer)) {
        map.addLayer(ortofotoLayer);
      }
      if (layerGroupRgbRecente && map.hasLayer(layerGroupRgbRecente)) {
        map.removeLayer(layerGroupRgbRecente);
      }
    } else {
      // Nelito e Guanaí: Desativa ortofoto do drone imediatamente
      if (ortofotoLayer && map.hasLayer(ortofotoLayer)) {
        map.removeLayer(ortofotoLayer);
      }
    }

    // Inicia voo imediato no mapa para a propriedade selecionada
    map.flyTo(coordsCentro, zoomAlvo, { duration: 1.2 });

    // =========================================================================
    // ETAPA 2 (LIMITES TERRITORIAIS): Remove vetor anterior e carrega o novo
    // =========================================================================
    if (talhoesLayer && map.hasLayer(talhoesLayer)) {
      map.removeLayer(talhoesLayer);
    }
    talhoesLayer = null;

    if (key === 'esec') {
      await carregarTalhoesGeoJSON(projeto.arquivo_geojson || projeto.geojson || './DATA/esec_poligono.geojson');
    } else {
      await carregarLimitesFazendaPrivada(key, projeto);
    }

    // Se a camada vetorial estiver válida, enquadra com precisão
    if (talhoesLayer && talhoesLayer.getBounds && talhoesLayer.getBounds().isValid()) {
      map.fitBounds(talhoesLayer.getBounds().pad(0.15), {
        padding: [30, 30],
        maxZoom: 16
      });
    }

    // =========================================================================
    // ETAPA 3 (RASTERS): Instanciação protegida das imagens PNG (RGB 10m e NDVI 2m)
    // =========================================================================
    try {
      await carregarRastersDoProjeto(key);
    } catch (errRaster) {
      console.warn(`[ITPAMap] Falha não impeditiva ao carregar rasters de ${key}:`, errRaster);
    }

    // Para Nelito e Guanaí, ativa o Satélite RGB recente automaticamente (se NDVI não estiver ligado)
    if (key !== 'esec') {
      const ndviAtivo = layerGroupNdviRecente && map.hasLayer(layerGroupNdviRecente);
      if (!ndviAtivo && layerGroupRgbRecente && !map.hasLayer(layerGroupRgbRecente)) {
        map.addLayer(layerGroupRgbRecente);
      }
    }

    // =========================================================================
    // ETAPA 4 (SINCRONIZAÇÃO UI & AUDITORIA): Atualiza botões e estados da tela
    // =========================================================================
    sincronizarEstadosUI();

    if (window.ITPAAuditoria && typeof window.ITPAAuditoria.definirProjetoAtivo === 'function') {
      try {
        window.ITPAAuditoria.definirProjetoAtivo(key);
      } catch (e) {
        console.warn(`[ITPAMap] Aviso em ITPAAuditoria.definirProjetoAtivo:`, e);
      }
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
          ${item.talhao ? `<p class="popup-meta"><strong>Imóvel:</strong> ${item.talhao}</p>` : ''}
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

    function alternarCamada(camada) {
      if (!camada || !map) return;
      if (map.hasLayer(camada)) {
        map.removeLayer(camada);
      } else {
        map.addLayer(camada);
      }
      sincronizarEstadosUI();
    }

    function obterBoundsPropriedadeAtiva() {
      if (talhoesLayer && talhoesLayer.getBounds && talhoesLayer.getBounds().isValid()) {
        return talhoesLayer.getBounds();
      }
      const key = (window.PROJETO_ATIVO_ID || 'nelito').toLowerCase().trim();
      const cfg = CONFIG_RASTERS_PROJETOS[key] || CONFIG_RASTERS_PROJETOS.nelito;
      return L.latLngBounds(cfg.fallbackBounds[0], cfg.fallbackBounds[1]);
    }

    // Eventos das Pílulas Rápidas Flutuantes
    if (pillNdvi) {
      pillNdvi.onclick = (e) => {
        e.preventDefault();
        if (swipeAtivo) {
          alternarModoSwipeTipo('ndvi');
          return;
        }

        const estaAtivo = layerGroupNdviRecente && map.hasLayer(layerGroupNdviRecente);
        if (estaAtivo) {
          map.removeLayer(layerGroupNdviRecente);
        } else {
          // Desativa RGB se estiver ativo para evitar conflito de visualização
          if (layerGroupRgbRecente && map.hasLayer(layerGroupRgbRecente)) {
            map.removeLayer(layerGroupRgbRecente);
          }
          // Garante clipPath limpo fora do modo comparador
          const lp = map.getPane('leftPane');
          if (lp) { lp.style.clipPath = ''; lp.style.webkitClipPath = ''; }
          
          if (layerGroupNdviRecente) {
            map.addLayer(layerGroupNdviRecente);
          }
          const b = obterBoundsPropriedadeAtiva();
          if (b && b.isValid && b.isValid()) {
            map.fitBounds(b.pad(0.15), { maxZoom: 16 });
          }
        }
        sincronizarEstadosUI();
      };
    }

    if (pillDrone) {
      pillDrone.onclick = (e) => {
        e.preventDefault();
        const keyAtiva = (window.PROJETO_ATIVO_ID || 'esec').toLowerCase().trim();
        const vaiAtivar = (!ortofotoLayer || !map.hasLayer(ortofotoLayer));
        if (vaiAtivar) {
          if (layerGroupNdviRecente && map.hasLayer(layerGroupNdviRecente)) map.removeLayer(layerGroupNdviRecente);
          if (layerGroupRgbRecente && map.hasLayer(layerGroupRgbRecente)) map.removeLayer(layerGroupRgbRecente);
          if (keyAtiva !== 'esec' && window.showToast) {
            window.showToast('Ortofoto Drone (Voo Recente 2026) ativada.', 'info');
          }
        }
        alternarCamada(ortofotoLayer);
      };
    }

    if (pillRgb) {
      pillRgb.onclick = (e) => {
        e.preventDefault();
        if (swipeAtivo) {
          alternarModoSwipeTipo('rgb');
          return;
        }

        const estaAtivo = layerGroupRgbRecente && map.hasLayer(layerGroupRgbRecente);
        if (estaAtivo) {
          map.removeLayer(layerGroupRgbRecente);
        } else {
          // Desativa NDVI se estiver ativo para evitar conflito de visualização
          if (layerGroupNdviRecente && map.hasLayer(layerGroupNdviRecente)) {
            map.removeLayer(layerGroupNdviRecente);
          }
          // Garante clipPath limpo fora do modo comparador
          const lp = map.getPane('leftPane');
          if (lp) { lp.style.clipPath = ''; lp.style.webkitClipPath = ''; }
          
          if (layerGroupRgbRecente) {
            map.addLayer(layerGroupRgbRecente);
          }
          const b = obterBoundsPropriedadeAtiva();
          if (b && b.isValid && b.isValid()) {
            map.fitBounds(b.pad(0.15), { maxZoom: 16 });
          }
        }
        sincronizarEstadosUI();
      };
    }

    const pillLimites = document.getElementById('pill-quick-limites');
    if (pillLimites) {
      pillLimites.onclick = (e) => {
        e.preventDefault();
        alternarLimitesTerritoriais();
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
        alternarLimitesTerritoriais(toggleTalhoes.checked);
      };

      const rowTalhoes = toggleTalhoes.closest('.sheet-switch-row');
      if (rowTalhoes) {
        rowTalhoes.style.cursor = 'pointer';
        rowTalhoes.addEventListener('click', (e) => {
          if (e.target !== toggleTalhoes && !e.target.closest('.ios-toggle')) {
            toggleTalhoes.checked = !toggleTalhoes.checked;
            alternarLimitesTerritoriais(toggleTalhoes.checked);
          }
        });
      }
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

  function atualizarTextosSwipe(isRgb) {
    const titleLeft = document.querySelector('.swipe-tag.left .swipe-title');
    const titleRight = document.querySelector('.swipe-tag.right .swipe-title');
    const subLeft = document.querySelector('.swipe-tag.left .swipe-sub');
    const subRight = document.querySelector('.swipe-tag.right .swipe-sub');

    if (isRgb) {
      if (titleLeft) titleLeft.textContent = 'Satélite RGB';
      if (subLeft) subLeft.textContent = '24/Out/2026';
      if (titleRight) titleRight.textContent = 'Satélite Histórico';
      if (subRight) subRight.textContent = '04/Set/2026';
    } else {
      if (titleLeft) titleLeft.textContent = 'Índice NDVI (2m)';
      if (subLeft) subLeft.textContent = '24/Out/2026';
      if (titleRight) titleRight.textContent = 'NDVI Histórico (2m)';
      if (subRight) subRight.textContent = '04/Set/2026';
    }
  }

  function alternarModoSwipeTipo(tipo) {
    if (!swipeAtivo || !map) return;
    const isRgb = tipo === 'rgb';

    if (isRgb) {
      // Isola modo RGB: remove NDVI
      if (layerGroupNdviRecente && map.hasLayer(layerGroupNdviRecente)) map.removeLayer(layerGroupNdviRecente);
      if (layerGroupNdviAnterior && map.hasLayer(layerGroupNdviAnterior)) map.removeLayer(layerGroupNdviAnterior);

      // Adiciona RGB Recente (leftPane) e RGB Anterior (rightPane)
      if (layerGroupRgbRecente && !map.hasLayer(layerGroupRgbRecente)) map.addLayer(layerGroupRgbRecente);
      if (layerGroupRgbAnterior && !map.hasLayer(layerGroupRgbAnterior)) map.addLayer(layerGroupRgbAnterior);

      const ndviLegendEl = document.getElementById('ndvi-legend');
      if (ndviLegendEl) ndviLegendEl.style.display = 'none';
    } else {
      // Isola modo NDVI: remove RGB
      if (layerGroupRgbRecente && map.hasLayer(layerGroupRgbRecente)) map.removeLayer(layerGroupRgbRecente);
      if (layerGroupRgbAnterior && map.hasLayer(layerGroupRgbAnterior)) map.removeLayer(layerGroupRgbAnterior);

      // Adiciona NDVI Recente (leftPane) e NDVI Anterior (rightPane)
      if (layerGroupNdviRecente && !map.hasLayer(layerGroupNdviRecente)) map.addLayer(layerGroupNdviRecente);
      if (layerGroupNdviAnterior && !map.hasLayer(layerGroupNdviAnterior)) map.addLayer(layerGroupNdviAnterior);

      const ndviLegendEl = document.getElementById('ndvi-legend');
      if (ndviLegendEl) ndviLegendEl.style.display = 'block';
    }

    atualizarTextosSwipe(isRgb);
    atualizarPosicaoSwipe(swipePctAtual);
    sincronizarEstadosUI();
  }

  function ativarModoSwipe(talhaoFoco = null, bounds = null) {
    if (!map) return;
    swipeAtivo = true;

    // Fecha imediatamente qualquer pop-up para visão desobstruída do comparador
    map.closePopup();

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

    // 2. Determina o modo ativo: se NDVI estava ativo, prioriza NDVI; caso contrário, RGB
    const isModoNdvi = swipeCamadasPrevias.ndviRecente || swipeCamadasPrevias.ndviAnterior;
    const isModoRgb = !isModoNdvi;

    if (isModoRgb) {
      // Isola modo RGB: desativa temporariamente NDVI para evitar sobreposição/mistura
      if (layerGroupNdviRecente && map.hasLayer(layerGroupNdviRecente)) {
        map.removeLayer(layerGroupNdviRecente);
      }
      if (layerGroupNdviAnterior && map.hasLayer(layerGroupNdviAnterior)) {
        map.removeLayer(layerGroupNdviAnterior);
      }

      // Garante RGB Recente (leftPane - 24/Out) e RGB Anterior (rightPane - 04/Set) ativos no mapa
      if (layerGroupRgbRecente && !map.hasLayer(layerGroupRgbRecente)) {
        map.addLayer(layerGroupRgbRecente);
      }
      if (layerGroupRgbAnterior && !map.hasLayer(layerGroupRgbAnterior)) {
        map.addLayer(layerGroupRgbAnterior);
      }

      const ndviLegendEl = document.getElementById('ndvi-legend');
      if (ndviLegendEl) ndviLegendEl.style.display = 'none';
    } else {
      // Isola modo NDVI: desativa RGB
      if (layerGroupRgbRecente && map.hasLayer(layerGroupRgbRecente)) {
        map.removeLayer(layerGroupRgbRecente);
      }
      if (layerGroupRgbAnterior && map.hasLayer(layerGroupRgbAnterior)) {
        map.removeLayer(layerGroupRgbAnterior);
      }

      // Garante NDVI Recente (leftPane - 24/Out) e NDVI Anterior (rightPane - 04/Set) ativos no mapa
      if (layerGroupNdviRecente && !map.hasLayer(layerGroupNdviRecente)) {
        map.addLayer(layerGroupNdviRecente);
      }
      if (layerGroupNdviAnterior && !map.hasLayer(layerGroupNdviAnterior)) {
        map.addLayer(layerGroupNdviAnterior);
      }

      const ndviLegendEl = document.getElementById('ndvi-legend');
      if (ndviLegendEl) ndviLegendEl.style.display = 'block';
    }

    atualizarTextosSwipe(isModoRgb);

    if (swipeContainer) {
      swipeContainer.style.display = 'block';
    }

    // Se fornecido bounds do talhão ou da propriedade ativa, aproxima
    let targetBounds = (bounds && bounds.isValid && bounds.isValid()) ? bounds : null;
    if (!targetBounds && talhaoFoco && typeof talhaoFoco === 'string' && CONFIG_RASTERS_PROJETOS[talhaoFoco.toLowerCase()]) {
      const cfg = CONFIG_RASTERS_PROJETOS[talhaoFoco.toLowerCase()];
      targetBounds = L.latLngBounds(cfg.fallbackBounds[0], cfg.fallbackBounds[1]);
    }
    if (!targetBounds && typeof obterBoundsPropriedadeAtiva === 'function') {
      targetBounds = obterBoundsPropriedadeAtiva();
    }

    if (targetBounds && targetBounds.isValid && targetBounds.isValid()) {
      map.fitBounds(targetBounds.pad(0.12), { padding: [30, 30], maxZoom: 17 });
    }

    // Posiciona o divisor inicialmente a 50%
    atualizarPosicaoSwipe(50);
    setTimeout(() => {
      atualizarPosicaoSwipe(50);
    }, 80);
    setTimeout(() => {
      atualizarPosicaoSwipe(50);
    }, 300);

    sincronizarEstadosUI();
  }

  // Função global de disparo infalível para o Comparador Swipe
  window.acionarComparacaoSwipe = function (projetoOuTalhao) {
    console.log('[Comparador Swipe] Disparado via ação direta:', projetoOuTalhao);
    if (map) map.closePopup();
    ativarModoSwipe(projetoOuTalhao);
  };
  window.ativarModoSwipe = window.acionarComparacaoSwipe;

  // Capturador delegado global para cliques e toques no botão [ Comparar ]
  ['click', 'touchend'].forEach(evt => {
    document.addEventListener(evt, function (e) {
      const btn = e.target && e.target.closest ? e.target.closest('.btn-popup-comparar, .btn-talhao-swipe') : null;
      if (btn) {
        console.log(`[Swipe] Capturado evento ${evt} no botão Comparar`);
        e.preventDefault();
        e.stopPropagation();
        const alvo = btn.getAttribute('data-projeto') || btn.getAttribute('data-foco') || btn.getAttribute('data-talhao') || window.PROJETO_ATIVO_ID || 'nelito';
        window.acionarComparacaoSwipe(alvo);
      }
    }, { capture: true, passive: false });
  });

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
    carregarRastersDoProjeto,
    CONFIG_RASTERS_PROJETOS,
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
    getLayerControl: () => layerControl,
    sincronizarEstadosUI,
    atualizarBadgeTemporal,
    alternarLimitesTerritoriais,
    alternarModoSwipeTipo,
    TIPO_CONFIG
  };
})();

// Exportação global
window.ITPAMap = ITPAMap;
window.atualizarBadgeTemporal = ITPAMap.atualizarBadgeTemporal;
