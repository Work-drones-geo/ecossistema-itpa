/**
 * Ecossistema ITPA - Módulo de Mapa WebGIS (Leaflet & MarkerCluster)
 * Suporte a visualização de satélite, satélite + vetorial, clustering e GPS em campo.
 */

const ITPAMap = (function () {
  let map = null;
  let clusterGroup = null;
  let userLocationMarker = null;
  let userAccuracyCircle = null;
  let tempPickMarker = null;
  let onPointSelectedCallback = null;

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
      layers: [esriSat], // Padrão: Imagem de satélite para trabalho em campo com drones e reflorestamento
      zoomControl: false // Adicionaremos em posição customizada
    });

    // Reposiciona o controle de zoom
    L.control.zoom({ position: 'topright' }).addTo(map);

    // 3. Controle de camadas
    const baseLayers = {
      '🛰️ Satélite de Alta Resolução': esriSat,
      '🗺️ Mapa Topográfico / Ruas': osm,
      '🎨 Carto Voyager (Claro)': cartoVoyager
    };
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

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

    return map;
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

      const fotoHtml = item.fotos && item.fotos.length > 0
        ? `<div class="popup-thumb"><img src="${item.fotos[0].dataUrl}" alt="Foto da ocorrência"></div>`
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
  function obterLocalizacaoAtual() {
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

            map.setView([lat, lng], 16, { animate: true });
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
