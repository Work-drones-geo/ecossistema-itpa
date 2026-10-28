/**
 * Ecossistema ITPA - Módulo de Sincronização Firebase (Firestore & Storage)
 * Preparado para sincronizar ocorrências e fotos locais quando a conexão for restabelecida.
 */

const ITPASync = (function () {
  let isSyncing = false;
  let listeners = [];

  // Configuração oficial do Firebase (Ecossistema ITPA)
  let firebaseConfig = {
    apiKey: "AIzaSyCrqwtEif_uxzb30TuB1cj3zVXD7GUuqvQ",
    authDomain: "ecossistema-itpa.firebaseapp.com",
    projectId: "ecossistema-itpa",
    storageBucket: "ecossistema-itpa.firebasestorage.app",
    messagingSenderId: "20602525657",
    appId: "1:20602525657:web:c8a332bd50d70c36d8ebc8"
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
    inicializarFirebase();
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

        // Habilita persistência de dados offline no Firestore
        if (firebase.firestore) {
          firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch((err) => {
            if (err.code === 'failed-precondition') {
              console.warn('[Firestore] Persistência offline em aba secundária.');
            } else if (err.code === 'unimplemented') {
              console.warn('[Firestore] Persistência offline do SDK não suportada neste browser.');
            }
          });
        }
      }
      firestoreInstance = firebase.firestore();
      storageInstance = firebase.storage();
      console.log('[Firebase] SDK inicializado e conectado a:', firebaseConfig.projectId);
      return true;
    } catch (e) {
      console.warn('Falha ao inicializar SDK Firebase:', e);
      return false;
    }
  }

  /**
   * Faz upload de uma foto no Firebase Storage.
   * @param {string} ocorrenciaId
   * @param {Object} fotoObj { dataUrl, blob, nome }
   * @returns {Promise<string>} Download URL do Storage
   */
  async function uploadFoto(ocorrenciaId, fotoObj) {
    if (storageInstance && (fotoObj.blob || fotoObj.dataUrl)) {
      const fotoNome = fotoObj.nome || `foto_${Date.now()}.jpg`;
      const refPath = `ocorrencias/${ocorrenciaId}/${fotoNome}`;
      const storageRef = storageInstance.ref(refPath);

      let payload = fotoObj.blob;
      if (!payload && fotoObj.dataUrl) {
        const res = await fetch(fotoObj.dataUrl);
        payload = await res.blob();
      }

      if (payload) {
        const snapshot = await storageRef.put(payload, {
          contentType: 'image/jpeg',
          customMetadata: { ocorrenciaId: ocorrenciaId, enviadoPor: 'Ecossistema ITPA PWA' }
        });
        return await snapshot.ref.getDownloadURL();
      }
    }

    // Retorna dataUrl local caso ocorra alguma falha ou não tenha storage ativo
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

          // 1. Fotos comprimidas em Base64 (salvas diretamente no Firestore, 100% plano Spark gratuito)
          const fotosBase64 = (item.fotos || []).map((f) => {
            if (typeof f === 'string') return f;
            return f.dataUrl || '';
          }).filter(Boolean);

          // 2. Gravação direta no Firestore
          let remoteId = item.id;
          if (firestoreInstance) {
            await firestoreInstance.collection('ocorrencias').doc(item.id).set({
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
              fotos: fotosBase64, // Array de strings Base64 leves (<200KB)
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

  let unsubscribeSnapshot = null;

  /**
   * Ativa a sincronização em tempo real via onSnapshot do Firestore.
   * Quando uma ocorrência é criada, alterada ou removida na nuvem por qualquer membro
   * da equipe em campo ou web, os dados são automaticamente sincronizados no IndexedDB local.
   * @param {Function} [callbackAtualizacao] Chamado quando novos dados chegam
   * @returns {Function|null} Unsubscribe listener
   */
  function iniciarSincronizacaoTempoReal(callbackAtualizacao) {
    if (!firestoreInstance) {
      inicializarFirebase();
    }
    if (!firestoreInstance) {
      console.warn('[Firestore] Instância não disponível para escuta em tempo real.');
      return null;
    }

    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
    }

    try {
      unsubscribeSnapshot = firestoreInstance.collection('ocorrencias').onSnapshot(async (snapshot) => {
        let houveMudanca = false;

        for (const change of snapshot.docChanges()) {
          const doc = change.doc;
          const data = doc.data();
          const docId = doc.id;

          if (change.type === 'added' || change.type === 'modified') {
            const local = await window.ITPADatabase.obterOcorrencia(docId);

            // Não sobrescreve se houver alteração local ainda pendente de upload
            if (!local || local.syncStatus !== 'pending') {
              const ocorrenciaSincronizada = {
                id: docId,
                tipo: data.tipo || 'outro',
                titulo: data.titulo || 'Ocorrência',
                descricao: data.descricao || '',
                talhao: data.talhao || '',
                latitude: parseFloat(data.latitude) || 0,
                longitude: parseFloat(data.longitude) || 0,
                precisaoGps: data.precisaoGps || null,
                altitude: data.altitude || null,
                severidade: data.severidade || 'media',
                responsavel: data.responsavel || 'Equipe ITPA',
                fotos: (data.fotos || []).map((url, idx) => ({
                  dataUrl: url,
                  nome: `foto_${idx + 1}.jpg`,
                  tamanhoFormatado: 'Cloud'
                })),
                syncStatus: 'synced',
                remoteId: docId,
                timestamp: data.criadoEm || data.timestamp || new Date().toISOString(),
                atualizadoEm: data.sincronizadoEm || new Date().toISOString()
              };

              await window.ITPADatabase.salvarOcorrencia(ocorrenciaSincronizada);
              houveMudanca = true;
            }
          } else if (change.type === 'removed') {
            await window.ITPADatabase.removerOcorrencia(docId);
            houveMudanca = true;
          }
        }

        if (houveMudanca) {
          console.log('[Firestore] Atualizações em tempo real aplicadas ao banco local.');
          if (typeof callbackAtualizacao === 'function') {
            callbackAtualizacao();
          }
        }
      }, (erro) => {
        console.warn('[Firestore] Erro na escuta em tempo real:', erro);
      });

      console.log('[Firestore] Sincronização em tempo real ativada com sucesso!');
      return unsubscribeSnapshot;
    } catch (e) {
      console.error('[Firestore] Falha ao registrar onSnapshot:', e);
      return null;
    }
  }

  function pararSincronizacaoTempoReal() {
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
      console.log('[Firestore] Escuta em tempo real desativada.');
    }
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

  /**
   * Consulta documentos de um talhão específico no Firestore.
   * @param {string} talhaoId
   * @returns {Promise<Array>}
   */
  async function listarDocumentosTalhao(talhaoId) {
    inicializarFirebase();
    if (!firestoreInstance) {
      throw new Error('Serviço Firestore não inicializado.');
    }

    const snapshot = await firestoreInstance
      .collection('documentos_talhoes')
      .where('talhao_id', '==', talhaoId)
      .get();

    const documentos = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      let dataEnvioFormatada = '';
      let dataMs = 0;
      if (data.data_envio && data.data_envio.toDate) {
        const d = data.data_envio.toDate();
        dataEnvioFormatada = d.toLocaleString('pt-BR');
        dataMs = d.getTime();
      } else if (data.data_envio) {
        const d = new Date(data.data_envio);
        dataEnvioFormatada = d.toLocaleString('pt-BR');
        dataMs = d.getTime();
      }

      documentos.push({
        id: doc.id,
        talhao_id: data.talhao_id,
        nome_documento: data.nome_documento || 'Documento sem título',
        url_storage: data.url_storage || '',
        data_envio: dataEnvioFormatada,
        data_envio_ms: dataMs
      });
    });

    // Ordena do mais recente para o mais antigo no cliente
    documentos.sort((a, b) => b.data_envio_ms - a.data_envio_ms);
    return documentos;
  }

  /**
   * Faz upload de arquivo para o Firebase Storage e grava registro no Firestore.
   * @param {string} talhaoId
   * @param {string} nomeDocumento
   * @param {File} arquivo
   * @returns {Promise<{id: string, url_storage: string}>}
   */
  async function enviarDocumentoTalhao(talhaoId, nomeDocumento, arquivo) {
    inicializarFirebase();
    if (!storageInstance || !firestoreInstance) {
      throw new Error('Serviços do Firebase não inicializados ou indisponíveis.');
    }

    if (!talhaoId) {
      throw new Error('Identificador do talhão não fornecido.');
    }
    if (!nomeDocumento || !nomeDocumento.trim()) {
      throw new Error('Por favor, informe o título do documento.');
    }
    if (!arquivo) {
      throw new Error('Por favor, selecione um arquivo.');
    }

    const timestamp = Date.now();
    const nomeLimpo = arquivo.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `documentos_itpa/${encodeURIComponent(talhaoId)}/${timestamp}_${nomeLimpo}`;
    const storageRef = storageInstance.ref(storagePath);

    // Upload no Firebase Storage
    const snapshot = await storageRef.put(arquivo, {
      contentType: arquivo.type || 'application/octet-stream',
      customMetadata: {
        talhao_id: talhaoId,
        nome_documento: nomeDocumento.trim(),
        enviadoPor: 'Ecossistema ITPA PWA'
      }
    });

    // Obtenção da URL de download público
    const url_storage = await snapshot.ref.getDownloadURL();

    // Gravação no Firestore na coleção 'documentos_talhoes'
    const docRef = await firestoreInstance.collection('documentos_talhoes').add({
      talhao_id: talhaoId,
      nome_documento: nomeDocumento.trim(),
      url_storage: url_storage,
      data_envio: firebase.firestore.FieldValue.serverTimestamp()
    });

    return {
      id: docRef.id,
      url_storage: url_storage,
      talhao_id: talhaoId,
      nome_documento: nomeDocumento.trim()
    };
  }

  return {
    onStatusChange,
    carregarConfiguracao,
    salvarConfiguracao,
    inicializarFirebase,
    iniciarSincronizacaoTempoReal,
    pararSincronizacaoTempoReal,
    isConfigurado,
    sincronizarTudo,
    monitorarConexao,
    listarDocumentosTalhao,
    enviarDocumentoTalhao,
    isSyncing: () => isSyncing
  };
})();

// Exportação global
window.ITPASync = ITPASync;
