/**
 * Ecossistema ITPA - Módulo IndexedDB Offline-First
 * Gerencia o armazenamento persistente local de ocorrências e configurações de campo.
 */

const ITPADatabase = (function () {
  const DB_NAME = 'itpa_ecossistema_db';
  const DB_VERSION = 1;
  const STORE_OCORRENCIAS = 'ocorrencias';
  const STORE_CONFIG = 'config';

  let dbInstance = null;

  /**
   * Inicializa a conexão com o IndexedDB criando as Object Stores necessárias.
   * @returns {Promise<IDBDatabase>}
   */
  function init() {
    return new Promise((resolve, reject) => {
      if (dbInstance) {
        return resolve(dbInstance);
      }

      if (!('indexedDB' in window)) {
        return reject(new Error('IndexedDB não é suportado neste navegador.'));
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store para ocorrências de campo
        if (!db.objectStoreNames.contains(STORE_OCORRENCIAS)) {
          const store = db.createObjectStore(STORE_OCORRENCIAS, { keyPath: 'id' });
          store.createIndex('syncStatus', 'syncStatus', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('tipo', 'tipo', { unique: false });
          store.createIndex('talhao', 'talhao', { unique: false });
        }

        // Store para parâmetros locais e configurações
        if (!db.objectStoreNames.contains(STORE_CONFIG)) {
          db.createObjectStore(STORE_CONFIG, { keyPath: 'chave' });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;

        dbInstance.onversionchange = () => {
          dbInstance.close();
          dbInstance = null;
          console.warn('Banco de dados desatualizado; reconectando...');
        };

        resolve(dbInstance);
      };

      request.onerror = (event) => {
        console.error('Erro ao abrir IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Salva ou atualiza uma ocorrência no banco local.
   * @param {Object} ocorrencia
   * @returns {Promise<Object>}
   */
  async function salvarOcorrencia(ocorrencia) {
    const db = await init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OCORRENCIAS, 'readwrite');
      const store = tx.objectStore(STORE_OCORRENCIAS);

      const dados = {
        id: ocorrencia.id || (crypto.randomUUID ? crypto.randomUUID() : 'itpa_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)),
        tipo: ocorrencia.tipo || 'geral',
        titulo: ocorrencia.titulo || 'Ocorrência sem título',
        descricao: ocorrencia.descricao || '',
        talhao: ocorrencia.talhao || '',
        latitude: parseFloat(ocorrencia.latitude) || 0,
        longitude: parseFloat(ocorrencia.longitude) || 0,
        precisaoGps: ocorrencia.precisaoGps || null,
        altitude: ocorrencia.altitude || null,
        fotos: ocorrencia.fotos || [], // Array de objetos { dataUrl, timestamp, nome }
        severidade: ocorrencia.severidade || 'media', // 'baixa', 'media', 'alta', 'critica'
        responsavel: ocorrencia.responsavel || 'Técnico de Campo',
        syncStatus: ocorrencia.syncStatus || 'pending', // 'pending', 'syncing', 'synced', 'error'
        syncError: ocorrencia.syncError || null,
        remoteId: ocorrencia.remoteId || null,
        timestamp: ocorrencia.timestamp || new Date().toISOString(),
        atualizadoEm: new Date().toISOString()
      };

      const req = store.put(dados);

      req.onsuccess = () => resolve(dados);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Retorna uma ocorrência pelo ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async function obterOcorrencia(id) {
    const db = await init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OCORRENCIAS, 'readonly');
      const store = tx.objectStore(STORE_OCORRENCIAS);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Lista todas as ocorrências cadastradas, com opção de filtro por status de sincronização.
   * @param {string} [filtroStatus] 'pending' | 'synced' | 'error' | null
   * @returns {Promise<Array>}
   */
  async function listarOcorrencias(filtroStatus = null) {
    const db = await init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OCORRENCIAS, 'readonly');
      const store = tx.objectStore(STORE_OCORRENCIAS);

      let req;
      if (filtroStatus) {
        const index = store.index('syncStatus');
        req = index.getAll(IDBKeyRange.only(filtroStatus));
      } else {
        req = store.getAll();
      }

      req.onsuccess = () => {
        const resultados = req.result || [];
        // Ordena pela data mais recente primeiro
        resultados.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        resolve(resultados);
      };

      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Atualiza o status de sincronização de uma ocorrência.
   * @param {string} id
   * @param {'pending'|'syncing'|'synced'|'error'} status
   * @param {string|null} [erroMsg]
   * @param {string|null} [remoteId]
   */
  async function atualizarStatusSincronizacao(id, status, erroMsg = null, remoteId = null) {
    const ocorrencia = await obterOcorrencia(id);
    if (!ocorrencia) return null;

    ocorrencia.syncStatus = status;
    ocorrencia.syncError = erroMsg;
    if (remoteId) ocorrencia.remoteId = remoteId;
    ocorrencia.atualizadoEm = new Date().toISOString();

    return salvarOcorrencia(ocorrencia);
  }

  /**
   * Exclui uma ocorrência do banco local.
   * @param {string} id
   */
  async function removerOcorrencia(id) {
    const db = await init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OCORRENCIAS, 'readwrite');
      const store = tx.objectStore(STORE_OCORRENCIAS);
      const req = store.delete(id);

      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Retorna o total de ocorrências pendentes de sincronização.
   * @returns {Promise<number>}
   */
  async function contarPendentes() {
    const pendentes = await listarOcorrencias('pending');
    return pendentes.length;
  }

  /**
   * Salva uma configuração ou preferência local.
   * @param {string} chave
   * @param {any} valor
   */
  async function salvarConfig(chave, valor) {
    const db = await init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CONFIG, 'readwrite');
      const store = tx.objectStore(STORE_CONFIG);
      const req = store.put({ chave, valor, atualizadoEm: new Date().toISOString() });
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Recupera uma configuração salva.
   * @param {string} chave
   * @returns {Promise<any>}
   */
  async function obterConfig(chave) {
    const db = await init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CONFIG, 'readonly');
      const store = tx.objectStore(STORE_CONFIG);
      const req = store.get(chave);
      req.onsuccess = () => resolve(req.result ? req.result.valor : null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  return {
    init,
    salvarOcorrencia,
    obterOcorrencia,
    listarOcorrencias,
    atualizarStatusSincronizacao,
    removerOcorrencia,
    contarPendentes,
    salvarConfig,
    obterConfig
  };
})();

// Exportação global
window.ITPADatabase = ITPADatabase;
