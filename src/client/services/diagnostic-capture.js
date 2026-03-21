/**
 * Serviço de captura de diagnósticos para o módulo de tickets.
 *
 * Responsabilidades:
 * - Interceptar console.log, console.warn, console.error e console.info,
 *   mantendo um buffer circular das últimas entradas.
 * - Capturar screenshot da tela via html2canvas (com cópia de canvas nativos
 *   de mapas Leaflet/OpenLayers).
 * - Persistir dados em localStorage para transferência entre abas.
 *
 * Fluxo:
 * 1. Na aba de inspeção: prepareAndOpenTickets() abre a nova aba imediatamente
 *    (preservando o contexto de user gesture para evitar bloqueio de popup),
 *    captura screenshot em paralelo e grava os dados em localStorage.
 * 2. Na aba de tickets: loadFromStorage() recupera os dados capturados.
 *
 * Decisões de design:
 * - localStorage (não sessionStorage): sessionStorage não é compartilhado entre
 *   abas, então localStorage é obrigatório para transferência cross-tab.
 * - Chave única com timestamp: evita colisão entre capturas concorrentes.
 * - TTL de 5 minutos: dados expiram automaticamente, evitando acúmulo.
 * - Screenshot em JPEG 0.7: reduz o tamanho de ~3MB (PNG) para ~300-800KB,
 *   ficando dentro do limite de ~5MB do localStorage.
 * - window.open() síncrono: evita bloqueio de popup por perda de user gesture.
 * - onclone com cópia de canvas: html2canvas não captura canvas WebGL/2D de
 *   mapas; a cópia explícita preserva o conteúdo visual dos mapas.
 */
Application.service('diagnosticCapture', function () {

  var self = this;

  // --- Configuração ---
  var MAX_LOG_ENTRIES = 200;
  var STORAGE_KEY = 'tvi_diagnostic_data';
  var DATA_TTL_MS = 5 * 60 * 1000; // 5 minutos

  // --- Buffer de console (ativo na aba atual) ---
  var consoleLogs = [];
  var originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info
  };

  /**
   * Serializa argumentos do console em string legível.
   */
  function serializeArgs(args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) {
      var arg = args[i];
      if (arg === null) {
        parts.push('null');
      } else if (arg === undefined) {
        parts.push('undefined');
      } else if (typeof arg === 'string') {
        parts.push(arg);
      } else if (typeof arg === 'number' || typeof arg === 'boolean') {
        parts.push(String(arg));
      } else if (arg instanceof Error) {
        parts.push(arg.stack || arg.message || String(arg));
      } else {
        try {
          parts.push(JSON.stringify(arg, null, 2));
        } catch (e) {
          parts.push('[Objeto não serializável: ' + typeof arg + ']');
        }
      }
    }
    return parts.join(' ');
  }

  /**
   * Cria um wrapper para o método do console que intercepta e armazena a entrada.
   */
  function wrapConsoleMethod(level) {
    return function () {
      originalConsole[level].apply(console, arguments);

      var entry = {
        level: level,
        message: serializeArgs(arguments),
        timestamp: new Date().toISOString()
      };

      consoleLogs.push(entry);

      if (consoleLogs.length > MAX_LOG_ENTRIES) {
        consoleLogs.shift();
      }
    };
  }

  // Aplicar interceptação
  console.log = wrapConsoleMethod('log');
  console.warn = wrapConsoleMethod('warn');
  console.error = wrapConsoleMethod('error');
  console.info = wrapConsoleMethod('info');

  // --- Dados carregados do storage (para a aba de tickets) ---
  var loadedScreenshotDataUrl = null;
  var loadedLogs = null;
  var loadedMetadata = null;
  var dataLoaded = false;

  /**
   * Copia o conteúdo de canvas existentes no DOM para o clone do html2canvas.
   * Necessário porque html2canvas não consegue capturar canvas WebGL/2D
   * de mapas Leaflet e OpenLayers.
   */
  function copyCanvasContent(document, clone) {
    var origCanvases = document.querySelectorAll('canvas');
    var cloneCanvases = clone.querySelectorAll('canvas');

    for (var i = 0; i < origCanvases.length && i < cloneCanvases.length; i++) {
      try {
        var origCanvas = origCanvases[i];
        var cloneCanvas = cloneCanvases[i];

        cloneCanvas.width = origCanvas.width;
        cloneCanvas.height = origCanvas.height;

        var ctx = cloneCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(origCanvas, 0, 0);
        }
      } catch (e) {
        // Canvas tainted (CORS) — ignora silenciosamente
      }
    }
  }

  /**
   * Captura screenshot via html2canvas e retorna como data URL.
   * @param {Function} callback - function(err, dataUrl)
   */
  function captureScreenshot(callback) {
    if (typeof html2canvas === 'undefined') {
      originalConsole.warn('[diagnosticCapture] html2canvas não disponível.');
      return callback(null, null);
    }

    html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      logging: false,
      scale: 1,
      onclone: function (clonedDoc) {
        copyCanvasContent(document, clonedDoc);
      },
      ignoreElements: function (element) {
        return element.tagName === 'IFRAME';
      }
    }).then(function (canvas) {
      // JPEG com qualidade 0.7: ~300-800KB vs ~2-5MB do PNG
      var dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      callback(null, dataUrl);
    }).catch(function (err) {
      originalConsole.error('[diagnosticCapture] Erro ao capturar screenshot:', err);
      callback(err, null);
    });
  }

  /**
   * Persiste dados no localStorage com tratamento de estouro.
   */
  function persistToStorage(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // Se exceder o limite com screenshot, tenta sem
      if (data.screenshot) {
        originalConsole.warn('[diagnosticCapture] Dados com screenshot excedem o limite do localStorage. Salvando sem screenshot.');
        var fallback = {
          consoleLogs: data.consoleLogs,
          metadata: data.metadata,
          timestamp: data.timestamp
        };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback));
        } catch (e2) {
          originalConsole.error('[diagnosticCapture] Erro ao salvar diagnósticos:', e2);
        }
      }
    }
  }

  /**
   * Abre a aba de tickets e captura diagnósticos em paralelo.
   *
   * IMPORTANTE: window.open() é chamado de forma síncrona dentro do handler
   * do evento de clique para evitar que o navegador bloqueie o popup.
   * A captura do screenshot (assíncrona) ocorre em paralelo e os dados
   * são atualizados no localStorage assim que disponíveis.
   *
   * @param {string} targetUrl - URL de destino (ex: '#/tickets')
   */
  self.prepareAndOpenTickets = function (targetUrl) {
    var metadata = {
      userAgent: navigator.userAgent,
      url: window.location.href,
      screenResolution: window.screen.width + 'x' + window.screen.height,
      viewportSize: window.innerWidth + 'x' + window.innerHeight,
      capturedAt: new Date().toISOString()
    };

    var logsSnapshot = consoleLogs.slice();
    var timestamp = Date.now();

    // Persistir logs e metadados ANTES de abrir a aba (sem screenshot ainda)
    persistToStorage({
      consoleLogs: logsSnapshot,
      metadata: metadata,
      timestamp: timestamp
    });

    // Abrir nova aba IMEDIATAMENTE (síncrono, dentro do user gesture)
    window.open(targetUrl || '#/tickets', '_blank');

    // Capturar screenshot em paralelo e atualizar o storage
    captureScreenshot(function (err, dataUrl) {
      if (dataUrl) {
        persistToStorage({
          consoleLogs: logsSnapshot,
          metadata: metadata,
          screenshot: dataUrl,
          timestamp: timestamp
        });
      }
    });
  };

  /**
   * Carrega diagnósticos do localStorage (chamado na aba de tickets).
   * Tenta múltiplas vezes para aguardar o screenshot que pode chegar
   * depois (a captura html2canvas é assíncrona na aba de origem).
   *
   * @param {Function} callback - function(hasData) chamado quando os dados estão prontos
   * @param {number} maxRetries - tentativas máximas (padrão: 6, intervalo 500ms = 3s)
   */
  self.loadFromStorage = function (callback, maxRetries) {
    maxRetries = maxRetries || 6;
    var attempts = 0;

    function tryLoad() {
      attempts++;
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          if (attempts < maxRetries) {
            setTimeout(tryLoad, 500);
            return;
          }
          dataLoaded = false;
          if (callback) callback(false);
          return;
        }

        var data = JSON.parse(raw);

        // Verificar TTL: ignorar dados com mais de 5 minutos
        if (data.timestamp && (Date.now() - data.timestamp) > DATA_TTL_MS) {
          localStorage.removeItem(STORAGE_KEY);
          dataLoaded = false;
          if (callback) callback(false);
          return;
        }

        loadedLogs = data.consoleLogs || [];
        loadedMetadata = data.metadata || {};
        loadedScreenshotDataUrl = data.screenshot || null;

        // Se ainda não tem screenshot e há tentativas restantes, espera
        if (!loadedScreenshotDataUrl && attempts < maxRetries) {
          setTimeout(tryLoad, 500);
          return;
        }

        dataLoaded = true;

        // Limpar localStorage após leitura completa (uso único)
        localStorage.removeItem(STORAGE_KEY);

        if (callback) callback(true);
      } catch (e) {
        originalConsole.error('[diagnosticCapture] Erro ao carregar do localStorage:', e);
        dataLoaded = false;
        if (callback) callback(false);
      }
    }

    tryLoad();
  };

  /**
   * Retorna os logs capturados.
   */
  self.getCapturedLogs = function () {
    return loadedLogs || [];
  };

  /**
   * Retorna os metadados capturados.
   */
  self.getCapturedMetadata = function () {
    return loadedMetadata || {};
  };

  /**
   * Retorna o data URL do screenshot capturado.
   */
  self.getCapturedScreenshotDataUrl = function () {
    return loadedScreenshotDataUrl;
  };

  /**
   * Indica se há dados de diagnóstico carregados.
   */
  self.hasData = function () {
    return dataLoaded && (loadedScreenshotDataUrl || (loadedLogs && loadedLogs.length > 0));
  };

  /**
   * Indica se os dados foram carregados.
   */
  self.isReady = function () {
    return dataLoaded;
  };

  /**
   * Limpa os dados carregados.
   */
  self.clear = function () {
    loadedScreenshotDataUrl = null;
    loadedLogs = null;
    loadedMetadata = null;
    dataLoaded = false;
  };

  /**
   * Retorna contagem de logs por nível.
   */
  self.getLogCounts = function () {
    var counts = { log: 0, warn: 0, error: 0, info: 0 };
    var logs = loadedLogs || [];
    for (var i = 0; i < logs.length; i++) {
      if (counts[logs[i].level] !== undefined) {
        counts[logs[i].level]++;
      }
    }
    return counts;
  };

  /**
   * Converte data URL para Blob (para upload como anexo).
   */
  self.dataUrlToBlob = function (dataUrl) {
    if (!dataUrl) return null;
    try {
      var parts = dataUrl.split(',');
      var mime = parts[0].match(/:(.*?);/)[1];
      var bstr = atob(parts[1]);
      var n = bstr.length;
      var u8arr = new Uint8Array(n);
      for (var i = 0; i < n; i++) {
        u8arr[i] = bstr.charCodeAt(i);
      }
      return new Blob([u8arr], { type: mime });
    } catch (e) {
      originalConsole.error('[diagnosticCapture] Erro ao converter dataUrl para Blob:', e);
      return null;
    }
  };
});
