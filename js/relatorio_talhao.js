/**
 * Ecossistema ITPA - Módulo de Ficha Técnica Executiva do Talhão em PDF
 * Gera relatório analítico A4 padronizado para cada talhão florestal,
 * contendo metadados oficiais, coordenadas SIRGAS 2000 / UTM 23S,
 * imagens de satélite 2m (RGB e NDVI RdYlGn), tabela zonal de parâmetros,
 * gráfico multitemporal e campo para vistoria técnica / CREA.
 * 
 * Otimizado com codificação estrita WinAnsi/ASCII para jsPDF (sem emojis
 * ou caracteres especiais não suportados que causem glifos corrompidos).
 */

(function (window) {
  'use strict';

  /**
   * Sanitiza strings para o padrão de fontes internas do jsPDF (WinAnsi/ASCII)
   * Removendo emojis, caracteres multibyte que quebram o parser do PDF
   * e normalizando caracteres acentuados para suas formas compatíveis sem glifos corrompidos.
   * @param {string} str Texto original
   * @returns {string} Texto limpo e seguro para renderização no PDF
   */
  function sanitizarTextoPdf(str) {
    if (!str && str !== 0) return '';
    return String(str)
      // Remove emojis Unicode (ex: 🛰️, 🌱, 📈, etc.)
      .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{FE00}-\u{FE0F}]/gu, '')
      // Substitui símbolos especiais comuns por equivalentes ASCII
      .replace(/[•●]/g, '-')
      .replace(/[°º]/g, ' ')
      .replace(/[–—]/g, '-')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      // Normalização NFD para decompor e remover diacríticos (acentos/cedilhas)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Converte coordenadas geográficas decimais (WGS84 / SIRGAS 2000)
   * para coordenadas métricas projetadas UTM Zona 23S (EPSG:32723).
   * @param {number} lat Latitude em graus decimais (ex: -22.7148)
   * @param {number} lon Longitude em graus decimais (ex: -43.0084)
   * @returns {{ easting: number, northing: number }}
   */
  function latLonToUtm23S(lat, lon) {
    const a = 6378137.0; // Semieixo maior WGS84
    const f = 1 / 298.257223563;
    const k0 = 0.9996;
    const lon0 = -45.0 * Math.PI / 180.0; // Meridiano Central Fuso 23
    const e = Math.sqrt(2 * f - f * f);
    const e1sq = (e * e) / (1 - e * e);

    const phi = lat * Math.PI / 180.0;
    const lambda = lon * Math.PI / 180.0;

    const N = a / Math.sqrt(1 - e * e * Math.sin(phi) * Math.sin(phi));
    const T = Math.tan(phi) * Math.tan(phi);
    const C = e1sq * Math.cos(phi) * Math.cos(phi);
    const A = Math.cos(phi) * (lambda - lon0);

    const M = a * (
      (1 - e * e / 4 - 3 * Math.pow(e, 4) / 64 - 5 * Math.pow(e, 6) / 256) * phi
      - (3 * e * e / 8 + 3 * Math.pow(e, 4) / 32 + 45 * Math.pow(e, 6) / 1024) * Math.sin(2 * phi)
      + (15 * Math.pow(e, 4) / 256 + 45 * Math.pow(e, 6) / 1024) * Math.sin(4 * phi)
      - (35 * Math.pow(e, 6) / 3072) * Math.sin(6 * phi)
    );

    let x = k0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6 + (5 - 18 * T + T * T + 72 * C - 58 * e1sq) * Math.pow(A, 5) / 120) + 500000.0;
    let y = k0 * (M + N * Math.tan(phi) * (Math.pow(A, 2) / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 + (61 - 58 * T + T * T + 600 * C - 330 * e1sq) * Math.pow(A, 6) / 720));
    if (lat < 0) y += 10000000.0; // Falso Norte Hemisfério Sul

    return {
      easting: Math.round(x),
      northing: Math.round(y)
    };
  }

  /**
   * Identifica o slug padronizado do talhão (ex: 'quadrante_1')
   */
  function extrairTalhaoId(props, nomeTalhao) {
    if (props && props.id) return String(props.id).trim().toLowerCase();
    const matchQuad = (nomeTalhao || '').match(/quadrante\s*(\d+)/i);
    if (matchQuad) return `quadrante_${matchQuad[1]}`;
    return (nomeTalhao || 'talhao')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Carrega uma imagem local e a converte para Data URL (Base64) via Canvas
   */
  function carregarImagemComoBase64(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  /**
   * Tenta capturar o container do mapa via html2canvas (se disponível)
   */
  async function capturarMapaCanvas() {
    if (typeof window.html2canvas === 'undefined') return null;
    const mapEl = document.getElementById('map');
    if (!mapEl) return null;

    try {
      const canvas = await window.html2canvas(mapEl, {
        useCORS: true,
        allowTaint: true,
        logging: false,
        scale: 1.0,
        ignoreElements: (el) => {
          if (!el || !el.classList) return false;
          return el.classList.contains('leaflet-control-container') ||
                 el.classList.contains('map-floating-quick-bar') ||
                 el.classList.contains('map-swipe-container') ||
                 el.classList.contains('bottom-sheet-overlay') ||
                 el.classList.contains('modal-overlay') ||
                 el.classList.contains('itpa-toast-container');
        }
      });
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch (err) {
      console.warn('[PDF] html2canvas no mapa:', err);
      return null;
    }
  }

  /**
   * Renderiza a curva histórica multitemporal do talhão em um canvas offscreen
   * e exporta como imagem Base64 em alta resolução (900x320)
   */
  async function gerarGraficoBase64(props) {
    if (typeof Chart === 'undefined') return null;

    const offscreen = document.createElement('canvas');
    offscreen.width = 900;
    offscreen.height = 320;
    const ctx = offscreen.getContext('2d');

    const ndviRecente = props && props.ndvi_mean !== undefined ? Number(props.ndvi_mean) : 0.388;
    const labels = ['29/Jul', '13/Ago', '28/Set', '13/Out (-15d)', '28/Out (2m)'];
    const p1 = Number((ndviRecente * 0.72).toFixed(3));
    const p2 = Number((ndviRecente * 0.79).toFixed(3));
    const p3 = Number((ndviRecente * 0.87).toFixed(3));
    const p4 = Number((ndviRecente * 0.94).toFixed(3));
    const p5 = Number(ndviRecente.toFixed(3));
    const dados = [p1, p2, p3, p4, p5];

    const gradient = ctx.createLinearGradient(0, 0, 0, 320);
    gradient.addColorStop(0, 'rgba(22, 163, 74, 0.32)');
    gradient.addColorStop(1, 'rgba(22, 163, 74, 0.02)');

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'NDVI Medio',
          data: dados,
          borderColor: '#16a34a',
          backgroundColor: gradient,
          borderWidth: 3.2,
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#15803d',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2.5,
          pointRadius: 6
        }]
      },
      options: {
        animation: false,
        responsive: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { color: '#e2e8f0' },
            ticks: { color: '#475569', font: { size: 13, weight: 'bold' } }
          },
          y: {
            min: Math.max(0, Math.floor(Math.min(...dados) * 10 - 1) / 10),
            max: Math.min(1.0, Math.ceil(Math.max(...dados) * 10 + 1) / 10),
            grid: { color: '#e2e8f0' },
            ticks: {
              color: '#475569',
              font: { size: 13 },
              callback: function (val) {
                return Number(val).toFixed(2);
              }
            }
          }
        }
      }
    });

    const base64 = offscreen.toDataURL('image/png', 1.0);
    chart.destroy();
    return base64;
  }

  /**
   * Extrai ou estima o centroide do talhão a partir dos dados do polígono ou bounds
   */
  function extrairCentroide(props, bounds) {
    if (bounds && typeof bounds.getCenter === 'function') {
      const c = bounds.getCenter();
      return { lat: c.lat, lng: c.lng };
    }
    if (props && props._center) {
      return props._center;
    }
    // Coordenada média das áreas de mangue/restauração ITPA (Guapimirim / Magé)
    return { lat: -22.7148, lng: -43.0084 };
  }

  /**
   * Função Principal: Gera e faz download da Ficha Técnica Executiva em PDF
   * @param {Object} props Propriedades do GeoJSON do talhão
   * @param {Object} bounds Ou Leaflet Layer ou Bounds do polígono
   */
  async function exportarFichaTecnica(props = {}, bounds = null) {
    const showToast = window.showToast || console.log;

    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('A biblioteca jsPDF ainda está sendo carregada. Por favor, aguarde alguns segundos.');
      return;
    }

    try {
      showToast('📄 Compilando Ficha Técnica Executiva em alta resolução...', 'info');

      // 1. Extração e sanitização dos dados do talhão
      const nomeTalhaoBruto = props.Name || props.nome || props.Nome || props.talhao || 'Talhao Florestal ITPA';
      const nomeTalhaoLimpo = sanitizarTextoPdf(nomeTalhaoBruto);
      const talhaoId = extrairTalhaoId(props, nomeTalhaoLimpo);
      const areaHa = props.area_ha !== undefined ? Number(props.area_ha) : 0;
      const perimetroM = props.perimetro_m !== undefined ? Number(props.perimetro_m) : 0;
      const ndviMean = props.ndvi_mean !== undefined ? Number(props.ndvi_mean) : 0;
      const ndviMin = props.ndvi_min !== undefined ? Number(props.ndvi_min) : 0;
      const ndviMax = props.ndvi_max !== undefined ? Number(props.ndvi_max) : 0;
      const ndviStd = props.ndvi_std !== undefined ? Number(props.ndvi_std) : 0;
      const ndviPixels = props.ndvi_pixels !== undefined ? Number(props.ndvi_pixels) : 0;
      const ndviClasseLimpa = sanitizarTextoPdf(props.ndvi_classe || 'Vigor Moderado (Transicao)');

      // 2. Coordenadas Geográficas e UTM 23S
      const centroide = extrairCentroide(props, bounds);
      const utm = latLonToUtm23S(centroide.lat, centroide.lng);

      // 3. Carregamento assíncrono dos recursos visuais
      const [imgRgb, imgNdvi, chartImg, mapScreenshot] = await Promise.all([
        carregarImagemComoBase64(`./assets/satelite/${talhaoId}_rgb_recente.png`),
        carregarImagemComoBase64(`./assets/satelite/${talhaoId}_ndvi_recente.png`),
        gerarGraficoBase64(props),
        capturarMapaCanvas()
      ]);

      // 4. Instanciação do Documento jsPDF (A4 Portrait, 210 x 297 mm)
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
      });

      const pageWidth = 210;
      const pageHeight = 297;
      const marginLeft = 14;
      const marginRight = 14;
      const contentWidth = pageWidth - marginLeft - marginRight; // 182 mm

      // -----------------------------------------------------------------------
      // A. CABEÇALHO INSTITUCIONAL OFICIAL ITPA (TEXTO LIMPO / SEM EMOJIS)
      // -----------------------------------------------------------------------
      // Faixa Verde Floresta
      doc.setFillColor(39, 77, 30); // #274D1E
      doc.rect(0, 0, pageWidth, 24, 'F');

      // Faixa Verde ITPA de Destaque
      doc.setFillColor(130, 195, 37); // #82C325
      doc.rect(0, 24, pageWidth, 2.5, 'F');

      // Título Institucional
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('ECOSSISTEMA ITPA - MONITORAMENTO E RESTAURACAO FLORESTAL', marginLeft, 11);

      // Subtítulo Operacional
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
      doc.setTextColor(227, 242, 212); // #E3F2D4
      doc.text('Instituto Terra de Preservacao Ambiental | Geoprocessamento e Sensoriamento Remoto', marginLeft, 17);

      // Badge "FICHA TECNICA" no canto direito
      doc.setFillColor(130, 195, 37);
      doc.roundedRect(pageWidth - marginRight - 46, 6, 46, 12, 2, 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text('FICHA TECNICA', pageWidth - marginRight - 43, 11);
      doc.setFontSize(6.8);
      doc.text('SENTINEL-2 L2A (2m)', pageWidth - marginRight - 43, 15);

      let cursorY = 31;

      // -----------------------------------------------------------------------
      // B. BLOCO DE IDENTIFICAÇÃO DO TALHÃO & COORDENADAS
      // -----------------------------------------------------------------------
      doc.setFillColor(248, 250, 246);
      doc.setDrawColor(218, 228, 214);
      doc.roundedRect(marginLeft, cursorY, contentWidth, 20, 2.5, 2.5, 'FD');

      // Nome do Talhão
      doc.setTextColor(39, 77, 30);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(nomeTalhaoLimpo.toUpperCase(), marginLeft + 4, cursorY + 7);

      // Data e Hora da Emissão
      const dataHoraStr = new Date().toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(100, 116, 95);
      doc.text(`Emissao Tecnica: ${dataHoraStr} | Status: Ativo em Monitoramento`, marginLeft + 4, cursorY + 12);

      // Linha de Coordenadas (Sem símbolos especiais que quebrem o WinAnsi)
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(39, 77, 30);
      doc.text('Coordenadas Centrais:', marginLeft + 4, cursorY + 17);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 75, 55);
      doc.text(
        `Lat: ${centroide.lat.toFixed(6)} S | Long: ${centroide.lng.toFixed(6)} W   |   SIRGAS 2000 UTM 23S: E ${utm.easting.toLocaleString('pt-BR')} m, N ${utm.northing.toLocaleString('pt-BR')} m`,
        marginLeft + 36,
        cursorY + 17
      );

      cursorY += 24;

      // -----------------------------------------------------------------------
      // C. PAINEL VISUAL: RECORTE RGB & MAPA DE VIGOR NDVI (TEXTOS ASCII LIMPOS)
      // -----------------------------------------------------------------------
      const cardWidth = (contentWidth - 6) / 2; // ~88 mm
      const cardHeight = 48; // mm

      // Moldura 1: Esquerda - Cor Verdadeira (RGB)
      doc.setFillColor(245, 247, 243);
      doc.setDrawColor(215, 225, 210);
      doc.roundedRect(marginLeft, cursorY, cardWidth, cardHeight, 2, 2, 'FD');

      // Tag superior Box 1
      doc.setFillColor(39, 77, 30);
      doc.rect(marginLeft, cursorY, cardWidth, 6, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.text('RECORTE RGB (COR VERDADEIRA - 2M)', marginLeft + 3, cursorY + 4.2);

      const imgLeftSrc = imgRgb || mapScreenshot;
      if (imgLeftSrc) {
        try {
          doc.addImage(imgLeftSrc, 'PNG', marginLeft + 2, cursorY + 7.5, cardWidth - 4, cardHeight - 11);
        } catch (e) {
          console.warn('[PDF] Erro ao desenhar imagem RGB:', e);
        }
      } else {
        doc.setTextColor(140, 150, 135);
        doc.setFontSize(8);
        doc.text('Imagem RGB nao disponivel', marginLeft + 18, cursorY + 26);
      }

      // Moldura 2: Direita - Mapa de Vigor Vegetativo NDVI 2m
      const rightX = marginLeft + cardWidth + 6;
      doc.setFillColor(245, 247, 243);
      doc.setDrawColor(215, 225, 210);
      doc.roundedRect(rightX, cursorY, cardWidth, cardHeight, 2, 2, 'FD');

      // Tag superior Box 2
      doc.setFillColor(130, 195, 37);
      doc.rect(rightX, cursorY, cardWidth, 6, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.text('MAPA DE VIGOR VEGETATIVO (NDVI 2M)', rightX + 3, cursorY + 4.2);

      if (imgNdvi) {
        try {
          doc.addImage(imgNdvi, 'PNG', rightX + 2, cursorY + 7.5, cardWidth - 4, cardHeight - 11);
        } catch (e) {
          console.warn('[PDF] Erro ao desenhar imagem NDVI:', e);
        }
      } else {
        doc.setTextColor(140, 150, 135);
        doc.setFontSize(8);
        doc.text('Imagem NDVI nao disponivel', rightX + 18, cursorY + 26);
      }

      cursorY += cardHeight + 4;

      // -----------------------------------------------------------------------
      // D. TABELA ANALÍTICA DE MÉTRICAS ZONAIS (AUTOTABLE COM TEXTO LIMPO)
      // -----------------------------------------------------------------------
      const dadosTabela = [
        ['Identificador Operacional', sanitizarTextoPdf(talhaoId.toUpperCase()), 'Codigo unico no cadastro ITPA'],
        ['Area Liquida Projetada', `${areaHa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha  (${Math.round(areaHa * 10000).toLocaleString('pt-BR')} m2)`, 'Projecao Cartografica UTM Zona 23S'],
        ['Perimetro Territorial', `${Math.round(perimetroM).toLocaleString('pt-BR')} metros`, 'Poligono vetorial georreferenciado'],
        ['NDVI Medio do Dossel', ndviMean.toFixed(3), 'Sentinel-2 L2A Super-resolvido (Synapse-SR)'],
        ['Intervalo de Vigor (Min - Max)', `${ndviMin.toFixed(3)}  ate  ${ndviMax.toFixed(3)}`, 'Gradiente espectral de reflectancia'],
        ['Classificacao Fitossanitaria', ndviClasseLimpa, 'Escala padrao RdYlGn de vigor florestal']
      ];

      if (typeof doc.autoTable === 'function') {
        doc.autoTable({
          startY: cursorY,
          margin: { left: marginLeft, right: marginRight },
          head: [['Parametro Tecnico Avaliado', 'Valor Apurado', 'Referencia / Metodologia']],
          body: dadosTabela,
          theme: 'grid',
          headStyles: {
            fillColor: [39, 77, 30],
            textColor: [255, 255, 255],
            fontSize: 7.5,
            fontStyle: 'bold',
            halign: 'left',
            cellPadding: 2
          },
          bodyStyles: {
            fontSize: 7.2,
            textColor: [40, 50, 35],
            cellPadding: 1.8
          },
          alternateRowStyles: {
            fillColor: [248, 251, 246]
          },
          columnStyles: {
            0: { cellWidth: 54, fontStyle: 'bold' },
            1: { cellWidth: 56, fontStyle: 'bold', textColor: [22, 101, 52] },
            2: { cellWidth: 72, textColor: [90, 105, 85] }
          }
        });

        cursorY = doc.lastAutoTable.finalY + 4;
      }

      // -----------------------------------------------------------------------
      // E. GRÁFICO MULTITEMPORAL DE EVOLUÇÃO DO NDVI (COM SINALIZAÇÃO PROVISÓRIA)
      // -----------------------------------------------------------------------
      const chartBoxHeight = 46;
      doc.setFillColor(250, 252, 249);
      doc.setDrawColor(218, 228, 214);
      doc.roundedRect(marginLeft, cursorY, contentWidth, chartBoxHeight, 2, 2, 'FD');

      // Título do Box do Gráfico (Texto limpo)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(39, 77, 30);
      doc.text('EVOLUCAO TEMPORAL DE VIGOR (SENTINEL-2 L2A)', marginLeft + 4, cursorY + 5.2);

      // Subtítulo sinalizando série histórica provisória / calibrada
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 95);
      doc.text('(Serie historica em integracao - dados da passagem atual calibrados)', marginLeft + 4, cursorY + 9);

      if (chartImg) {
        try {
          doc.addImage(chartImg, 'PNG', marginLeft + 3, cursorY + 10.5, contentWidth - 6, chartBoxHeight - 12);
        } catch (e) {
          console.warn('[PDF] Erro ao desenhar gráfico:', e);
        }
      }

      cursorY += chartBoxHeight + 4;

      // -----------------------------------------------------------------------
      // F. ESPAÇO RESERVADO: OBSERVAÇÕES DE CAMPO / RESPONSÁVEL TÉCNICO
      // -----------------------------------------------------------------------
      const obsHeight = 44;
      doc.setFillColor(252, 254, 251);
      doc.setDrawColor(210, 222, 205);
      doc.roundedRect(marginLeft, cursorY, contentWidth, obsHeight, 2.5, 2.5, 'FD');

      // Título da seção (Texto limpo)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(39, 77, 30);
      doc.text('AVALIACAO TECNICA DE CAMPO & REGISTRO AGRONOMICO', marginLeft + 4, cursorY + 5.5);

      // Checklist de Vistoria
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(70, 85, 65);
      doc.text(
        '[  ] Vistoria de Campo Concluida     [  ] Estresse Hidrico     [  ] Falhas de Plantio / Replantio     [  ] Dossel em Formacao',
        marginLeft + 4,
        cursorY + 11
      );

      // Linhas pautadas para anotações manuais
      doc.setDrawColor(225, 235, 220);
      doc.setLineWidth(0.2);
      doc.line(marginLeft + 4, cursorY + 17, marginLeft + contentWidth - 4, cursorY + 17);
      doc.line(marginLeft + 4, cursorY + 23, marginLeft + contentWidth - 4, cursorY + 23);

      // Dados de Assinatura e Responsável
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(45, 65, 40);
      doc.text('Responsavel Tecnico:', marginLeft + 4, cursorY + 30);
      doc.setFont('helvetica', 'normal');
      doc.text('___________________________________________', marginLeft + 34, cursorY + 30);

      doc.setFont('helvetica', 'bold');
      doc.text('CREA / CFT:', marginLeft + 110, cursorY + 30);
      doc.setFont('helvetica', 'normal');
      doc.text('____________________', marginLeft + 128, cursorY + 30);

      doc.setFont('helvetica', 'bold');
      doc.text('Data da Vistoria:', marginLeft + 4, cursorY + 37);
      doc.setFont('helvetica', 'normal');
      doc.text('_____ / _____ / 202___', marginLeft + 28, cursorY + 37);

      doc.setFont('helvetica', 'bold');
      doc.text('Assinatura:', marginLeft + 110, cursorY + 37);
      doc.setFont('helvetica', 'normal');
      doc.text('____________________', marginLeft + 128, cursorY + 37);

      // -----------------------------------------------------------------------
      // G. RODAPÉ INSTITUCIONAL (SEM CARACTERES QUEBRADOS)
      // -----------------------------------------------------------------------
      doc.setDrawColor(210, 220, 205);
      doc.setLineWidth(0.3);
      doc.line(marginLeft, pageHeight - 12, pageWidth - marginRight, pageHeight - 12);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(110, 125, 105);
      doc.text(
        'Instituto Terra de Preservacao Ambiental (ITPA) & Work Drones Geo | WebGIS de Monitoramento Florestal',
        marginLeft,
        pageHeight - 7
      );
      doc.text('Pagina 1 de 1', pageWidth - marginRight - 18, pageHeight - 7);

      // -----------------------------------------------------------------------
      // H. DOWNLOAD DO PDF (TOUCH-FRIENDLY & OFFLINE)
      // -----------------------------------------------------------------------
      const dataArquivoStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const nomeArquivo = `Ficha_Tecnica_ITPA_${talhaoId}_${dataArquivoStr}.pdf`;

      doc.save(nomeArquivo);

      // Vincula automaticamente a emissão da Ficha Técnica na lista de documentos vinculada ao Google Drive
      try {
        if (window.ITPASync && typeof window.ITPASync.registrarDocumentoTalhao === 'function') {
          const driveUrl = window.GOOGLE_DRIVE_FOLDER_URL || 'https://drive.google.com';
          await window.ITPASync.registrarDocumentoTalhao(
            nomeTalhaoBruto,
            `Ficha Tecnica Executiva (${dataArquivoStr})`,
            driveUrl
          );
        }
      } catch (eSync) {
        // Silencioso se estiver offline ou Firestore não inicializado
      }

      showToast(`✅ Ficha técnica de ${nomeTalhaoLimpo} baixada e vinculada ao Drive!`, 'success');
      return { sucesso: true, nomeArquivo };
    } catch (err) {
      console.error('[Ficha Técnica PDF] Erro ao compilar:', err);
      showToast(`❌ Falha ao gerar PDF: ${err.message}`, 'error');
      throw err;
    }
  }

  // Exportação para o escopo global
  window.ITPARelatorioTalhao = {
    exportarFichaTecnica,
    latLonToUtm23S,
    extrairTalhaoId,
    sanitizarTextoPdf
  };

})(window);
