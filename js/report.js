/**
 * Ecossistema ITPA - Módulo de Relatórios Técnicos em PDF
 * Gera relatórios técnicos limpos padrão A4 com cabeçalho oficial, totalizadores,
 * metadados de campo e galeria de fotos integradas.
 */

(function (window) {
  'use strict';

  const TIPOS_LABEL = {
    muda_danificada: '🌱 Muda Danificada',
    fogo: '🔥 Foco de Incêndio',
    erosao: '⚠️ Processo Erosivo',
    plantio: '🌿 Plantio Realizado',
    regeneracao: '🍃 Regeneração',
    fauna: '🐾 Fauna',
    outro: '📍 Outro Registro'
  };

  const SEVERIDADES_INFO = {
    baixa: { label: 'Baixa', color: [39, 174, 96] },      // Verde
    media: { label: 'Média', color: [230, 126, 34] },     // Laranja
    alta: { label: 'Alta', color: [211, 84, 0] },         // Âmbar escuro
    critica: { label: 'Crítica (Urgente)', color: [192, 57, 43] } // Vermelho
  };

  function formatarDataHora(ts) {
    if (!ts) return '--/--/---- --:--';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '--/--/---- --:--';
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Gera o PDF técnico das ocorrências fornecidas
   * @param {Array} ocorrencias - Lista de ocorrências do banco
   * @param {Object} opcoes - Opções extras (filtros, título)
   */
  async function gerarRelatorioPdf(ocorrencias, opcoes = {}) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('A biblioteca jsPDF não foi carregada no navegador.');
    }

    if (!ocorrencias || ocorrencias.length === 0) {
      throw new Error('Nenhuma ocorrência encontrada para gerar o relatório.');
    }

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
    const contentWidth = pageWidth - marginLeft - marginRight; // 182mm
    const bottomLimit = pageHeight - 18;

    let cursorY = 0;

    // Estatísticas para o Resumo
    const total = ocorrencias.length;
    const porSeveridade = { baixa: 0, media: 0, alta: 0, critica: 0 };
    const talhoesUnicos = new Set();
    let totalFotos = 0;

    ocorrencias.forEach(item => {
      const sev = (item.severidade || 'media').toLowerCase();
      if (porSeveridade[sev] !== undefined) {
        porSeveridade[sev]++;
      } else {
        porSeveridade.media++;
      }
      if (item.talhao && item.talhao.trim()) {
        talhoesUnicos.add(item.talhao.trim());
      }
      if (item.fotos && Array.isArray(item.fotos)) {
        totalFotos += item.fotos.length;
      }
    });

    // Função de Cabeçalho Superior Oficial ITPA
    function desenharCabecalho(isFirstPage = false) {
      if (isFirstPage) {
        // Faixa verde floresta superior
        doc.setFillColor(39, 77, 30); // #274D1E
        doc.rect(0, 0, pageWidth, 28, 'F');

        // Faixa de destaque verde ITPA
        doc.setFillColor(130, 195, 37); // #82C325
        doc.rect(0, 28, pageWidth, 3, 'F');

        // Título Principal
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('ECOSSISTEMA ITPA - MONITORAMENTO DE CAMPO', marginLeft, 12);

        // Subtítulo
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(227, 242, 212); // #E3F2D4
        doc.text('Instituto Terra de Preservação Ambiental • Operações de Vistoria Florestal & Drone', marginLeft, 18);

        // Metadados rápidos no cabeçalho
        const agoraStr = new Date().toLocaleString('pt-BR');
        doc.setFontSize(8);
        doc.setTextColor(255, 255, 255);
        doc.text(`Emissão: ${agoraStr} | Total: ${total} registro(s)`, marginLeft, 24);

        cursorY = 38;
      } else {
        // Cabeçalho compacto para páginas subsequentes
        doc.setFillColor(39, 77, 30);
        doc.rect(0, 0, pageWidth, 12, 'F');

        doc.setFillColor(130, 195, 37);
        doc.rect(0, 12, pageWidth, 1.5, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text('ECOSSISTEMA ITPA • RELATÓRIO TÉCNICO DE CAMPO (CONTINUAÇÃO)', marginLeft, 8);

        cursorY = 18;
      }
    }

    // Desenha o primeiro cabeçalho
    desenharCabecalho(true);

    // =========================================================================
    // 1. Resumo Executivo / Estatísticas
    // =========================================================================
    doc.setFillColor(241, 248, 235); // #F1F8EB (menta suave)
    doc.setDrawColor(220, 229, 216); // #DCE5D8
    doc.roundedRect(marginLeft, cursorY, contentWidth, 26, 3, 3, 'FD');

    doc.setTextColor(39, 77, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('📊 RESUMO DAS VISTORIAS DE CAMPO', marginLeft + 5, cursorY + 6);

    // Linha 1 de resumo: Severidades
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(50, 60, 50);

    const textoSeveridades = [
      `Crítica: ${porSeveridade.critica}`,
      `Alta: ${porSeveridade.alta}`,
      `Média: ${porSeveridade.media}`,
      `Baixa: ${porSeveridade.baixa}`
    ].join('   |   ');

    doc.text(`Severidade:  ${textoSeveridades}`, marginLeft + 5, cursorY + 13);

    // Linha 2 de resumo: Talhões e Fotos
    const listaTalhoes = talhoesUnicos.size > 0 
      ? Array.from(talhoesUnicos).slice(0, 8).join(', ') + (talhoesUnicos.size > 8 ? ` (+${talhoesUnicos.size - 8})` : '')
      : 'Nenhum talhão formal atribuído';

    doc.text(`Talhões identificados (${talhoesUnicos.size}):  ${listaTalhoes}`, marginLeft + 5, cursorY + 19);
    doc.text(`Registros Fotográficos Anexados:  ${totalFotos} foto(s) geolocalizada(s)`, marginLeft + 5, cursorY + 24);

    cursorY += 32;

    // =========================================================================
    // 2. Listagem Detalhada das Ocorrências
    // =========================================================================
    doc.setTextColor(31, 61, 23);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('DETALHAMENTO TÉCNICO DAS OCORRÊNCIAS', marginLeft, cursorY);
    cursorY += 5;

    for (let i = 0; i < ocorrencias.length; i++) {
      const item = ocorrencias[i];
      const tipoTxt = TIPOS_LABEL[item.tipo] || item.tipo || 'Registro de Campo';
      const sevKey = (item.severidade || 'media').toLowerCase();
      const sevInfo = SEVERIDADES_INFO[sevKey] || SEVERIDADES_INFO.media;
      const dataHoraTxt = formatarDataHora(item.timestamp);
      const talhaoTxt = item.talhao && item.talhao.trim() ? item.talhao.trim() : 'Sem talhão';
      const latLngTxt = (item.latitude && item.longitude)
        ? `Lat: ${Number(item.latitude).toFixed(6)}°  |  Long: ${Number(item.longitude).toFixed(6)}°  (Precisão: ±${Math.round(item.precisaoGps || 0)}m)`
        : 'Coordenadas não disponíveis';

      const desc = item.descricao && item.descricao.trim() ? item.descricao.trim() : 'Nenhuma observação técnica registrada.';
      
      // Normalização das fotos
      let fotosList = [];
      if (item.fotos && Array.isArray(item.fotos)) {
        item.fotos.forEach(f => {
          if (typeof f === 'string' && f.startsWith('data:image')) {
            fotosList.push(f);
          } else if (f && f.dataUrl && f.dataUrl.startsWith('data:image')) {
            fotosList.push(f.dataUrl);
          }
        });
      }

      // Cálculo de altura estimada do card para quebra de página
      doc.setFontSize(8.5);
      const linhasDesc = doc.splitTextToSize(`Observações: ${desc}`, contentWidth - 10);
      const alturaDesc = linhasDesc.length * 4.2;
      const temFotos = fotosList.length > 0;
      const alturaFotos = temFotos ? 36 : 0;
      const cardHeight = 26 + alturaDesc + alturaFotos + (temFotos ? 6 : 4);

      // Se o card ultrapassar a página, cria nova página
      if (cursorY + cardHeight > bottomLimit) {
        doc.addPage();
        desenharCabecalho(false);
      }

      // Fundo e borda do card
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(215, 225, 212); // Borda suave
      doc.roundedRect(marginLeft, cursorY, contentWidth, cardHeight, 2.5, 2.5, 'FD');

      // Faixa lateral com cor de severidade
      doc.setFillColor(sevInfo.color[0], sevInfo.color[1], sevInfo.color[2]);
      doc.rect(marginLeft, cursorY, 3.5, cardHeight, 'F');

      let itemY = cursorY + 6;

      // Título da ocorrência
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(31, 61, 23);
      const tituloCompleto = `#${i + 1} - ${item.titulo || 'Ocorrência sem título'}`;
      doc.text(tituloCompleto.length > 55 ? tituloCompleto.slice(0, 52) + '...' : tituloCompleto, marginLeft + 7, itemY);

      // Badge de Severidade no topo direito
      doc.setFontSize(7.5);
      doc.setTextColor(sevInfo.color[0], sevInfo.color[1], sevInfo.color[2]);
      doc.text(`[ Severidade: ${sevInfo.label.toUpperCase()} ]`, pageWidth - marginRight - 38, itemY);

      itemY += 5;

      // Linha 1: Tipo | Talhão | Data/Hora
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(60, 75, 60);
      doc.text(`Tipo: ${tipoTxt}   •   Talhão: ${talhaoTxt}   •   Data: ${dataHoraTxt}`, marginLeft + 7, itemY);

      itemY += 4.5;

      // Linha 2: Coordenadas
      doc.setTextColor(70, 85, 70);
      doc.text(`Localização: ${latLngTxt}`, marginLeft + 7, itemY);

      itemY += 5.5;

      // Linha 3: Observações de Campo
      doc.setTextColor(30, 40, 30);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
      linhasDesc.forEach(linha => {
        doc.text(linha, marginLeft + 7, itemY);
        itemY += 4.2;
      });

      // Linha 4: Galeria de Fotos (Miniaturas Nítidas)
      if (temFotos) {
        itemY += 2;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(39, 77, 30);
        doc.text(`Evidências Fotográficas (${fotosList.length}):`, marginLeft + 7, itemY);
        itemY += 3.5;

        // Renderizar miniaturas (até 4 fotos lado a lado por linha)
        const thumbWidth = 38;
        const thumbHeight = 28;
        const gap = 4;
        let fotoX = marginLeft + 7;

        for (let fIdx = 0; fIdx < fotosList.length && fIdx < 4; fIdx++) {
          try {
            const dataUri = fotosList[fIdx];
            doc.addImage(dataUri, 'JPEG', fotoX, itemY, thumbWidth, thumbHeight);
            
            // Borda elegante ao redor da foto
            doc.setDrawColor(180, 200, 175);
            doc.rect(fotoX, itemY, thumbWidth, thumbHeight, 'S');

            fotoX += thumbWidth + gap;
          } catch (errFoto) {
            console.warn('[PDF] Erro ao renderizar imagem no relatório:', errFoto);
          }
        }
      }

      cursorY += cardHeight + 4;
    }

    // =========================================================================
    // 3. Rodapé em Todas as Páginas com Numeração
    // =========================================================================
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);

      // Linha separadora do rodapé
      doc.setDrawColor(210, 220, 205);
      doc.setLineWidth(0.3);
      doc.line(marginLeft, pageHeight - 12, pageWidth - marginRight, pageHeight - 12);

      // Texto de autoria e numeração
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(110, 125, 105);
      doc.text('Instituto Terra de Preservação Ambiental (ITPA) & Work Drones Geo • Sistema Offline-First', marginLeft, pageHeight - 7);
      doc.text(`Página ${p} de ${totalPages}`, pageWidth - marginRight - 20, pageHeight - 7);
    }

    // Download direto do PDF
    const dataStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const horaStr = new Date().toTimeString().slice(0, 5).replace(':', '');
    const nomeArquivo = `Relatorio_ITPA_Campo_${dataStr}_${horaStr}.pdf`;

    doc.save(nomeArquivo);
    return { sucesso: true, nomeArquivo, totalOcorrencias: total };
  }

  // Exporta para escopo global
  window.ITPAReport = {
    gerarRelatorioPdf
  };

})(window);
