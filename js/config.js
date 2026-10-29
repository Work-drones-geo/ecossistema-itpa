/**
 * Ecossistema ITPA - Configurações Centrais e Constantes Globais
 * 
 * Centraliza os endpoints de nuvem, identificadores e a URL da Pasta Mestre do Google Drive
 * para que usuários e relatórios não precisem digitar ou colar links manualmente.
 */

(function (window) {
  'use strict';

  // URL e ID oficial da Pasta Mestre do Google Drive compartilhada para o projeto ITPA
  const GOOGLE_DRIVE_FOLDER_ID = '1ITPA-Drones-Geo-Restaura-Florestal';
  const GOOGLE_DRIVE_FOLDER_URL = 'https://drive.google.com/drive/folders/1ITPA-Drones-Geo-Restaura-Florestal?usp=sharing';

  const ITPA_CONFIG = {
    // Identificação do Sistema
    NOME_SISTEMA: 'Ecossistema ITPA - Monitoramento & Restauração Florestal',
    VERSAO: '2.4.0',

    // Google Drive Oficial
    GOOGLE_DRIVE_FOLDER_ID: GOOGLE_DRIVE_FOLDER_ID,
    GOOGLE_DRIVE_FOLDER_URL: GOOGLE_DRIVE_FOLDER_URL,

    /**
     * Retorna o link direto da pasta do Google Drive.
     * @param {string} [talhaoId] Identificador opcional do talhão
     * @returns {string} URL da pasta compartilhada
     */
    obterUrlDrive: function (talhaoId) {
      return this.GOOGLE_DRIVE_FOLDER_URL;
    },

    /**
     * Abre a pasta do Google Drive em nova aba do navegador com segurança.
     * @param {string} [talhaoId] Identificador opcional do talhão
     */
    abrirPastaDrive: function (talhaoId) {
      const url = this.obterUrlDrive(talhaoId);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // Exportação em escopo global para acesso universal
  window.GOOGLE_DRIVE_FOLDER_ID = GOOGLE_DRIVE_FOLDER_ID;
  window.GOOGLE_DRIVE_FOLDER_URL = GOOGLE_DRIVE_FOLDER_URL;
  window.ITPA_CONFIG = ITPA_CONFIG;

})(window);
