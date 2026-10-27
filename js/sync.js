/**
 * Ecossistema ITPA - Módulo de Sincronização Firebase (Firestore & Storage)
 * Preparado para sincronizar ocorrências e fotos locais quando a conexão for restabelecida.
 */

const ITPASync = (function () {
  let isSyncing = false;
  let listeners = [];

  // Configuração padrão do Firebase (pode ser sobrescrita via IndexedDB ou interface)
  let firebaseConfig = {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  };

  let firestoreInstance = null;
  let storageInstance = null;

  /**
   * Registra ouvintes para eventos de sincronização (progresso, conclusão, erro).
   * @param {Function} callback
   */
  function onStatusChange(callback) {
    listeners.push(callback);
  }

  function notificar(evento, dados) {
    listeners.forEach((fn) => {
      try {
        fn(evento, dados);
      } catch (e) {
        console.error('Erro no callback de sync:', e);
      }
    });
  }

  /**
   * Carrega a configuração do Firebase salva no banco local.
   */
  async function carregarConfiguracao() {
    if (window.ITPADatabase) {
      const configSalva = await window.ITPADatabase.obterConfig('firebase_config');
      if (configSalva) {
        firebaseConfig = { ...firebaseConfig, ...configSalva };
      }
    }
    return firebaseConfig;
  }

  /**
   * Salva a configuração do Firebase no banco local.
   * @param {Object} novaConfig
   */
  async function salvarConfiguracao(novaConfig) {
    firebaseConfig = { ...firebaseConfig, ...novaConfig };
    if (window.ITPADatabase) {
      await window.ITPADatabase.salvarConfig('firebase_config', firebaseConfig);
    }
  }

  /**
   * Verifica se as credenciais do Firebase foram devidamente preenchidas.
   * @returns {boolean}
   */
  function isConfigurado() {
    return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
  }

  /**
   * Inicializa o SDK do Firebase se estiver presente na página e configurado.
   */
  function inicializarFirebase() {
    if (!isConfigurado() || typeof firebase === 'undefined') {
      return false;
    }

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      firestoreInstance = firebase.firestore();
      storageInstance = firebase.storage();
      return true;
    } catch (e) {
      console.warn('Falha ao inicializar SDK Firebase:', e);
      return false;
    }
  }

  /**
   * Faz upload de uma foto no Firebase Storage (ou gera mock de URL caso em homologação).
   * @param {string} ocorrenciaId
   * @param {Object} fotoObj { dataUrl, blob, nome }
   * @returns {Promise<string>} Download URL do Storage
   */
  async function uploadFoto(ocorrenciaId, fotoObj) {
    if (storageInstance && fotoObj.blob) {
      const fotoNome = fotoObj.nome || `foto_${Date.now()}.jpg`;
      const refPath = `ocorrencias/${ocorrenciaId}/${fotoNome}`;
      const storageRef = storageInstance.ref(refPath);
      const snapshot = await storageRef.put(fotoObj.blob, {
        contentType: 'image/jpeg',
        customMetadata: { ocorrenciaId: ocorrenciaId, enviadoPor: 'Ecossistema ITPA PWA' }
      });
      return await snapshot.ref.getDownloadURL();
    }

    // Modo simulado / fallback quando o projeto ainda não foi apontado
    return fotoObj.dataUrl || '';
  }

  /**
   * Executa a sincronização em lote de todas as ocorrências pendentes no IndexedDB.
   * @returns {Promise<{total: number, sucesso: number, falhas: number}>}
   */
  async function sincronizarTudo() {
    if (isSyncing) {
      console.log('Sincronização já em andamento...');
      return;
    }

    if (!navigator.onLine) {
      notificar('offline', { mensagem: 'Dispositivo sem conexão de internet.' });
      return { total: 0, sucesso: 0, falhas: 0 };
    }

    isSyncing = true;
    notificar('iniciando', { mensagem: 'Iniciando sincronização de ocorrências...' });

    let total = 0;
    let sucesso = 0;
    let falhas = 0;

    try {
      const pendentes = await window.ITPADatabase.listarOcorrencias('pending');
      total = pendentes.length;

      if (total === 0) {
        notificar('concluido', { total: 0, sucesso: 0, falhas: 0, mensagem: 'Nenhuma ocorrência pendente.' });
        isSyncing = false;
        return { total: 0, sucesso: 0, falhas: 0 };
      }

      inicializarFirebase();

      for (let i = 0; i < pendentes.length; i++) {
        const item = pendentes[i];
        notificar('progresso', { atual: i + 1, total, item });

        try {
          await window.ITPADatabase.atualizarStatusSincronizacao(item.id, 'syncing');

          // 1. Upload de fotos no Storage
          const fotosUrls = [];
          if (item.fotos && item.fotos.length > 0) {
            for (const foto of item.fotos) {
              const url = await uploadFoto(item.id, foto);
              fotosUrls.push(url);
            }
          }

          // 2. Gravação no Firestore (ou persistência remota)
          let remoteId = item.id;
          if (firestoreInstance) {
            const docRef = await firestoreInstance.collection('ocorrencias').doc(item.id).set({
              tipo: item.tipo,
              titulo: item.titulo,
              descricao: item.descricao,
              talhao: item.talhao,
              latitude: item.latitude,
              longitude: item.longitude,
              precisaoGps: item.precisaoGps,
              altitude: item.altitude,
              severidade: item.severidade,
              responsavel: item.responsavel,
              fotos: fotosUrls,
              criadoEm: item.timestamp,
              sincronizadoEm: new Date().toISOString()
            });
          }

          // 3. Marca como sincronizado localmente
          await window.ITPADatabase.atualizarStatusSincronizacao(item.id, 'synced', null, remoteId);
          sucesso++;
        } catch (erroItem) {
          console.error(`Erro ao sincronizar item ${item.id}:`, erroItem);
          await window.ITPADatabase.atualizarStatusSincronizacao(item.id, 'error', erroItem.message);
          falhas++;
        }
      }

      notificar('concluido', {
        total,
        sucesso,
        falhas,
        mensagem: `Sincronização concluída: ${sucesso} enviados, ${falhas} falhas.`
      });
    } catch (errGeral) {
      console.error('Erro durante processo geral de sincronização:', errGeral);
      notificar('erro', { erro: errGeral.message });
    } finally {
      isSyncing = false;
    }

    return { total, sucesso, falhas };
  }

  /**
   * Monitora reconexão e inicia auto-sync quando a internet voltar.
   */
  function monitorarConexao() {
    window.addEventListener('online', () => {
      console.log('Rede restabelecida! Tentando sincronizar pendências...');
      notificar('rede_online', { status: 'online' });
      sincronizarTudo();
    });

    window.addEventListener('offline', () => {
      console.log('Conexão perdida. Modo 100% offline ativado.');
      notificar('rede_offline', { status: 'offline' });
    });
  }

  return {
    onStatusChange,
    carregarConfiguracao,
    salvarConfiguracao,
    isConfigurado,
    sincronizarTudo,
    monitorarConexao,
    isSyncing: () => isSyncing
  };
})();

// Exportação global
window.ITPASync = ITPASync;
