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
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | ITPA'
    });

    const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics | ITPA'
    });

    const cartoVoyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; CartoDB | ITPA'
    });

    // 2. Instanciação do mapa
    map = L.map(containerId, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxZoom: 21,
      layers: [esriSat], // Padrão: Imagem de satélite para trabalho em campo com drones e reflorestamento
      zoomControl: false // Adicionaremos em posição customizada
    });

    // Reposiciona o controle de zoom
    L.control.zoom({ position: 'topright' }).addTo(map);

    // 3. Pane dedicado para sobreposição de imagens de satélite recortadas dos talhões
    // zIndex 350 fica entre os tiles base (200) e os vetores de contorno (overlayPane: 400)
    if (!map.getPane('satelitePane')) {
      map.createPane('satelitePane');
      map.getPane('satelitePane').style.zIndex = 350;
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

    // 6. Controle de camadas (Base + Overlays)
    const baseLayers = {
      '🛰️ Satélite de Alta Resolução': esriSat,
      '🗺️ Mapa Topográfico / Ruas': osm,
      '🎨 Carto Voyager (Claro)': cartoVoyager
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

    map.on('overlayadd', (e) => {
      if (e.name && e.name.includes('NDVI')) {
        atualizarVisibilidadeLegendaNdvi();
      }
    });

    map.on('overlayremove', (e) => {
      if (e.name && e.name.includes('NDVI')) {
        atualizarVisibilidadeLegendaNdvi();
      }
    });

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

              // Helper para criar ImageOverlay georreferenciado com opacidade 0.9 e pane dedicado
              const criarSateliteOverlay = (caminhoRelativo) => {
                const overlay = L.imageOverlay(caminhoRelativo, exactBounds, {
                  opacity: 0.9,
                  interactive: false,
                  pane: 'satelitePane'
                });
                overlay.on('error', () => {
                  if (overlay.getElement()) {
                    overlay.getElement().style.display = 'none';
                  }
                });
                return overlay;
              };

              // a) 🌱 Talhões - NDVI (Recente)
              if (layerGroupNdviRecente) {
                layerGroupNdviRecente.addLayer(
                  criarSateliteOverlay(`./assets/satelite/${talhaoId}_ndvi_recente.png`)
                );
              }

              // b) 🛰️ Talhões - RGB (Recente)
              if (layerGroupRgbRecente) {
                layerGroupRgbRecente.addLayer(
                  criarSateliteOverlay(`./assets/satelite/${talhaoId}_rgb_recente.png`)
                );
              }

              // c) 🌱 Talhões - NDVI (Passagem Anterior -15d)
              if (layerGroupNdviAnterior) {
                layerGroupNdviAnterior.addLayer(
                  criarSateliteOverlay(`./assets/satelite/${talhaoId}_ndvi_anterior.png`)
                );
              }

              // d) 🛰️ Talhões - RGB (Passagem Anterior -15d)
              if (layerGroupRgbAnterior) {
                layerGroupRgbAnterior.addLayer(
                  criarSateliteOverlay(`./assets/satelite/${talhaoId}_rgb_anterior.png`)
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

          // Popup com atributos do talhão (nome, código, camada de origem, descrição)
          const popupHtml = `
            <div class="itpa-popup-card">
              <div class="popup-header">
                <span class="popup-tipo" style="color: #82C325;">🌱 Talhão / Limite de Voo</span>
              </div>
              <h4 class="popup-title">${nomeTalhao}</h4>
              ${codigo ? `<p class="popup-meta"><strong>Código:</strong> ${codigo}</p>` : ''}
              ${layerOrigem ? `<p class="popup-meta"><strong>Camada:</strong> ${layerOrigem}</p>` : ''}
              ${descricao ? `<p class="popup-desc">${descricao}</p>` : ''}
              <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 6px;">
                <button class="btn-popup-ver btn-talhao-preencher" data-talhao="${nomeTalhao}">
                  ➕ Registrar Ocorrência Aqui
                </button>
                <button class="btn-popup-ver btn-talhao-documentos" data-talhao="${nomeTalhao}">
                  📂 Documentos do Talhão
                </button>
              </div>
            </div>
          `;

          layer.bindPopup(popupHtml);

          layer.on('popupopen', () => {
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
                window.ITPA_OnTalhaoDocumentos(nomeTalhao, props);
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

  function getMapInstance() {
    return map;
  }

  return {
    init,
    carregarTalhoesGeoJSON,
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
