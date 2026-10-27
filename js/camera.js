/**
 * Ecossistema ITPA - Módulo de Câmera e Compressão em Canvas
 * Processamento no cliente: redimensiona fotos para no máximo 1280px
 * e comprime com qualidade 0.75 (JPEG/WebP) antes do salvamento offline.
 */

const ITPACamera = (function () {
  const DEFAULT_CONFIG = {
    maxDimension: 1024,
    quality: 0.7,
    mimeType: 'image/jpeg'
  };

  /**
   * Converte um File ou Blob de imagem em um objeto Image carregado.
   * @param {File|Blob} file
   * @returns {Promise<HTMLImageElement>}
   */
  function carregarImagem(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(new Error('Falha ao decodificar imagem: ' + err));
        img.src = e.target.result;
      };
      reader.onerror = (err) => reject(new Error('Falha ao ler arquivo: ' + err));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Calcula as novas dimensões mantendo a proporção original.
   * @param {number} width
   * @param {number} height
   * @param {number} maxDimension
   * @returns {{width: number, height: number}}
   */
  function calcularDimensoes(width, height, maxDimension) {
    if (width <= maxDimension && height <= maxDimension) {
      return { width, height };
    }

    if (width > height) {
      return {
        width: maxDimension,
        height: Math.round((height * maxDimension) / width)
      };
    } else {
      return {
        width: Math.round((width * maxDimension) / height),
        height: maxDimension
      };
    }
  }

  /**
   * Compacta uma imagem no cliente usando Canvas HTML5.
   * @param {File|Blob} fileArquivo
   * @param {Object} [opcoes]
   * @returns {Promise<{
   *   dataUrl: string,
   *   blob: Blob,
   *   largura: number,
   *   altura: number,
   *   tamanhoOriginalBytes: number,
   *   tamanhoCompactadoBytes: number,
   *   taxaReducao: string
   * }>}
   */
  async function compactar(fileArquivo, opcoes = {}) {
    const config = { ...DEFAULT_CONFIG, ...opcoes };
    const tamanhoOriginalBytes = fileArquivo.size || 0;

    const img = await carregarImagem(fileArquivo);
    const { width: novaLargura, height: novaAltura } = calcularDimensoes(
      img.naturalWidth || img.width,
      img.naturalHeight || img.height,
      config.maxDimension
    );

    const canvas = document.createElement('canvas');
    canvas.width = novaLargura;
    canvas.height = novaAltura;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Fundo neutro caso a imagem tenha transparência
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, novaLargura, novaAltura);

    // Desenha a imagem redimensionada
    ctx.drawImage(img, 0, 0, novaLargura, novaAltura);

    const dataUrl = canvas.toDataURL(config.mimeType, config.quality);

    // Converte para Blob para facilitar upload no Firebase Storage
    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), config.mimeType, config.quality);
    });

    const tamanhoCompactadoBytes = blob ? blob.size : Math.round((dataUrl.length * 3) / 4);
    const reducao = tamanhoOriginalBytes > 0
      ? (((tamanhoOriginalBytes - tamanhoCompactadoBytes) / tamanhoOriginalBytes) * 100).toFixed(1) + '%'
      : '0%';

    return {
      dataUrl,
      blob,
      largura: novaLargura,
      altura: novaAltura,
      tamanhoOriginalBytes,
      tamanhoCompactadoBytes,
      tamanhoFormatado: formatarBytes(tamanhoCompactadoBytes),
      taxaReducao: reducao
    };
  }

  /**
   * Utilitário para formatar bytes em KB/MB legíveis.
   * @param {number} bytes
   * @returns {string}
   */
  function formatarBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  return {
    compactar,
    calcularDimensoes,
    formatarBytes,
    DEFAULT_CONFIG
  };
})();

// Exportação global
window.ITPACamera = ITPACamera;
