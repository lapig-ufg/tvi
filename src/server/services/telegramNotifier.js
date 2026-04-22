/**
 * Serviço de notificações Telegram para o TVI.
 *
 * Responsabilidades:
 * - Enfileirar eventos (tickets, campanhas) em coleção MongoDB
 * - Processar fila com debounce por ticket, rate limit e horário silencioso
 * - Formatar mensagens HTML ricas para o Telegram
 * - Enviar resumo diário
 *
 * Padrão: singleton factory, carregado via express-load em app.services.telegramNotifier
 */
var axios = require('axios');

var TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

// --- Mapa de labels ---
var TYPE_LABELS = {
  'RECLAMACAO': 'Reclamação', 'SUGESTAO': 'Sugestão',
  'DUVIDA': 'Dúvida', 'ELOGIO': 'Elogio'
};
var CATEGORY_LABELS = {
  'INTERFACE': 'Interface', 'DESEMPENHO': 'Desempenho',
  'FUNCIONALIDADE': 'Funcionalidade', 'DADOS': 'Dados', 'OUTRO': 'Outro'
};
var SEVERITY_LABELS = {
  'BAIXA': 'Baixa', 'MEDIA': 'Média', 'ALTA': 'Alta', 'CRITICA': 'Crítica'
};
var SEVERITY_EMOJIS = {
  'BAIXA': '🟢', 'MEDIA': '🟡', 'ALTA': '🟠', 'CRITICA': '🔴'
};
var STATUS_LABELS = {
  'ABERTO': 'Aberto', 'EM_ANALISE': 'Em Análise',
  'EM_DESENVOLVIMENTO': 'Em Desenvolvimento', 'RESOLVIDO': 'Resolvido', 'FECHADO': 'Fechado'
};
var STATUS_EMOJIS = {
  'ABERTO': '⬜', 'EM_ANALISE': '🔍', 'EM_DESENVOLVIMENTO': '🔧',
  'RESOLVIDO': '✅', 'FECHADO': '🔒'
};

// --- Prioridades por evento ---
var EVENT_PRIORITIES = {
  'TICKET_CREATED': 'HIGH',
  'TICKET_UPDATED': 'MEDIUM',
  'TICKET_STATUS_CHANGED': 'HIGH',
  'TICKET_COMMENTED': 'MEDIUM',
  'TICKET_INTERNAL_NOTE': 'LOW',
  'TICKET_VOTE_MILESTONE': 'LOW',
  'TICKET_ATTACHMENT_ADDED': 'MEDIUM',
  'TICKET_ATTACHMENT_REMOVED': 'LOW',
  'CONSOLIDATION_DIVERGENCE': 'CRITICAL',
  'DOUBT_CREATED': 'HIGH',
  'DOUBT_REOPENED': 'MEDIUM',
  'DOUBT_COMMENTED': 'MEDIUM',
  'DOUBT_ADMIN_COMMENT': 'MEDIUM',
  'DOUBT_RESOLVED': 'MEDIUM'
};

// --- Regras de debounce por evento (em ms) ---
var DEBOUNCE_RULES = {
  'TICKET_UPDATED': 60000,
  'TICKET_ATTACHMENT_ADDED': 30000,
  'TICKET_VOTE_MILESTONE': 300000
  // Eventos não listados: sem debounce (cada ocorrência gera uma mensagem)
};

// --- Classe principal ---

function TelegramNotifier(app) {
  this.app = app;
  this.queue = null; // coleção MongoDB
  this.tickets = null; // coleção de tickets (para queries de resumo)
  this.logger = null;
  this.initialized = false;

  // Configuração via env
  this.enabled = process.env.TELEGRAM_NOTIFICATIONS_ENABLED === 'true';
  this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  this.chatId = process.env.TELEGRAM_CHAT_ID || '';
  this.adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
  this.baseUrl = process.env.TVI_BASE_URL || 'https://tvi.lapig.iesa.ufg.br';
  this.debounceWindowMs = parseInt(process.env.TELEGRAM_DEBOUNCE_WINDOW_MS) || 60000;
  this.voteThreshold = parseInt(process.env.TELEGRAM_VOTE_THRESHOLD) || 3;
  this.silentStart = parseInt(process.env.TELEGRAM_SILENT_START) || 22;
  this.silentEnd = parseInt(process.env.TELEGRAM_SILENT_END) || 7;
  this.timezone = 'America/Sao_Paulo';

  // Axios instance para Telegram API
  this.http = axios.create({
    baseURL: TELEGRAM_API_BASE + this.botToken,
    timeout: 10000,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Inicializa coleção e índices. Chamado após app.repository estar pronto.
 */
TelegramNotifier.prototype.init = async function () {
  if (this.initialized) return;

  try {
    if (!this.app || !this.app.repository || !this.app.repository.db) {
      console.log('[TelegramNotifier] Repository não disponível, adiando inicialização.');
      return;
    }

    this.logger = this.app.services ? this.app.services.logger : null;
    this.tickets = this.app.repository.collections.tickets;
    this.queue = this.app.repository.db.collection('telegram_notification_queue');

    // Índices para queries de processamento
    this.queue.createIndex({ processedAt: 1, silentHold: 1, _processingBatch: 1, createdAt: 1 }, function () {});
    this.queue.createIndex({ ticketId: 1, event: 1, processedAt: 1 }, function () {});

    this.initialized = true;
    console.log('[TelegramNotifier] Inicializado. Habilitado:', this.enabled);
  } catch (err) {
    console.error('[TelegramNotifier] Erro na inicialização:', err.message);
  }
};

// ============================================================
// ENQUEUE — Insere evento na fila (fire-and-forget)
// ============================================================

/**
 * Enfileira um evento para notificação.
 * Nunca lança exceção — erros são logados silenciosamente.
 *
 * @param {string} event - Tipo do evento (ex: 'TICKET_CREATED')
 * @param {Object} data - Payload do evento
 */
TelegramNotifier.prototype.enqueue = async function (event, data) {
  if (!this.enabled || !this.initialized) return;

  try {
    var priority = EVENT_PRIORITIES[event] || 'MEDIUM';
    var silent = this.isSilentHours() && priority !== 'CRITICAL';

    var doc = {
      event: event,
      ticketId: data.ticketNumber || data.ticketId || data.pointId || null,
      data: data,
      priority: priority,
      createdAt: new Date(),
      processedAt: null,
      silentHold: silent
    };

    this.queue.insert(doc, function (err) {
      if (err) {
        console.error('[TelegramNotifier] Erro ao enfileirar:', err.message);
      }
    });
  } catch (err) {
    console.error('[TelegramNotifier] Erro em enqueue:', err.message);
  }
};

// ============================================================
// SEND MESSAGE — Envia para Telegram com retry
// ============================================================

/**
 * Envia mensagem formatada em HTML para o Telegram.
 * Retry com backoff exponencial em caso de rate limit (429).
 *
 * @param {string} chatId - ID do chat/grupo
 * @param {string} html - Mensagem formatada em HTML
 * @param {number} attempt - Tentativa atual (interno)
 */
TelegramNotifier.prototype.sendMessage = async function (chatId, html, attempt) {
  attempt = attempt || 1;
  var MAX_RETRIES = 3;
  var self = this;

  try {
    await this.http.post('/sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  } catch (err) {
    var status = err.response ? err.response.status : 0;

    // Rate limit (429) — retry com backoff
    if (status === 429 && attempt < MAX_RETRIES) {
      var retryAfter = (err.response.data && err.response.data.parameters && err.response.data.parameters.retry_after) || 5;
      await self._sleep(retryAfter * 1000);
      return self.sendMessage(chatId, html, attempt + 1);
    }

    // Logar erro sem propagar (nunca incluir URL/token no log)
    var errorMsg = err.response ? (err.response.data && err.response.data.description) || String(err.response.status) : err.message;
    console.error('[TelegramNotifier] Erro ao enviar (tentativa ' + attempt + '):', errorMsg);

    if (self.logger) {
      self.logger.error('Falha ao enviar notificação Telegram', {
        module: 'telegramNotifier',
        function: 'sendMessage',
        metadata: { status: status, error: errorMsg, attempt: attempt }
      }).catch(function () {});
    }
  }
};

TelegramNotifier.prototype._sleep = function (ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
};

// ============================================================
// PROCESS QUEUE — Drena fila com debounce e rate limit
// ============================================================

/**
 * Processa a fila de notificações pendentes.
 * Chamado pelo cron job a cada 30 segundos no PRIMARY_WORKER.
 */
TelegramNotifier.prototype.processQueue = async function () {
  if (!this.enabled || !this.initialized) return;

  // Lock em memória: impedir ciclos sobrepostos no mesmo worker
  if (this._processing) return;
  this._processing = true;

  var self = this;

  try {
    // Marcar pendentes atomicamente com batch ID usando findAndModify em loop
    // Isso evita race condition entre find e update
    var processingBatchId = new Date().getTime().toString(36) + Math.random().toString(36).substr(2, 4);
    var docs = [];

    for (var claim = 0; claim < 50; claim++) {
      var claimed = await new Promise(function (resolve) {
        self.queue.findAndModify(
          { processedAt: null, silentHold: false, _processingBatch: { $exists: false } },
          [['createdAt', 1]],
          { $set: { _processingBatch: processingBatchId } },
          { new: true },
          function (err, result) {
            if (err || !result || !result.value) return resolve(null);
            resolve(result.value);
          }
        );
      });
      if (!claimed) break;
      docs.push(claimed);
    }

    if (docs.length === 0) { self._processing = false; return; }

    // Agrupar por ticketId + event para debounce
    var groups = {};
    var standalone = [];

    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      var debounceMs = DEBOUNCE_RULES[doc.event];

      if (debounceMs && doc.ticketId) {
        var key = doc.ticketId + '::' + doc.event;
        if (!groups[key]) {
          groups[key] = { docs: [], debounceMs: debounceMs, event: doc.event };
        }
        groups[key].docs.push(doc);
      } else {
        standalone.push(doc);
      }
    }

    var idsToMark = [];
    var messagesToSend = [];

    // Processar grupos com debounce
    var now = Date.now();
    var deferredIds = []; // IDs para devolver à fila (ainda dentro da janela)
    var keys = Object.keys(groups);
    for (var k = 0; k < keys.length; k++) {
      var group = groups[keys[k]];
      var groupDocs = group.docs;
      var lastDoc = groupDocs[groupDocs.length - 1];

      // Se o documento mais recente tem menos que debounceMs de idade,
      // adiar o grupo inteiro para o próximo ciclo (permitir mais coalescência)
      var ageOfLast = now - lastDoc.createdAt.getTime();
      if (ageOfLast < group.debounceMs) {
        // Devolver à fila: remover _processingBatch para que sejam elegíveis no próximo ciclo
        for (var df = 0; df < groupDocs.length; df++) {
          deferredIds.push(groupDocs[df]._id);
        }
        continue;
      }

      // Janela expirada: coalescer e enviar
      if (groupDocs.length > 1) {
        lastDoc.data._coalescedCount = groupDocs.length;
      }
      messagesToSend.push(lastDoc);

      for (var m = 0; m < groupDocs.length; m++) {
        idsToMark.push(groupDocs[m]._id);
      }
    }

    // Devolver documentos adiados à fila (remover marca de batch)
    if (deferredIds.length > 0) {
      self.queue.update(
        { _id: { $in: deferredIds } },
        { $unset: { _processingBatch: '' } },
        { multi: true },
        function () {}
      );
    }

    // Processar standalone (sem debounce)
    for (var s = 0; s < standalone.length; s++) {
      messagesToSend.push(standalone[s]);
      idsToMark.push(standalone[s]._id);
    }

    // Enviar mensagens com rate limiting (50ms entre envios)
    for (var j = 0; j < messagesToSend.length; j++) {
      var msg = messagesToSend[j];
      var html = await self.formatMessage(msg.event, msg.data);

      if (html) {
        // Comentários internos vão para o chat admin (se configurado)
        var targetChat = (msg.event === 'TICKET_INTERNAL_NOTE' && self.adminChatId)
          ? self.adminChatId
          : self.chatId;

        await self.sendMessage(targetChat, html);

        if (j < messagesToSend.length - 1) {
          await self._sleep(50);
        }
      }
    }

    // Marcar todo o batch como processado
    self.queue.update(
      { _processingBatch: processingBatchId },
      { $set: { processedAt: new Date() }, $unset: { _processingBatch: '' } },
      { multi: true },
      function (err) {
        if (err) console.error('[TelegramNotifier] Erro ao marcar processados:', err.message);
      }
    );

    // Limpeza periódica: remover documentos processados há mais de 7 dias
    // Executado de forma oportunística (apenas ~1% dos ciclos, por amostragem)
    if (Math.random() < 0.01) {
      var sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      self.queue.deleteMany(
        { processedAt: { $ne: null, $lt: sevenDaysAgo } },
        function () {}
      );
    }
  } catch (err) {
    console.error('[TelegramNotifier] Erro em processQueue:', err.message);
  } finally {
    self._processing = false;
  }
};

// ============================================================
// FORMAT MESSAGE — Renderiza templates HTML
// ============================================================

/**
 * Formata a mensagem HTML para o Telegram com base no tipo de evento.
 *
 * @param {string} event - Tipo do evento
 * @param {Object} d - Dados do evento
 * @returns {string|null} HTML formatado ou null se não deve ser enviado
 */
TelegramNotifier.prototype.formatMessage = async function (event, d) {
  var self = this;
  var ts = self._formatTimestamp(new Date());

  // Para eventos que recebem ticketId em vez de ticketNumber, resolver
  if (d.ticketId && !d.ticketNumber) {
    var ticketInfo = await self._resolveTicket(d.ticketId);
    if (ticketInfo) {
      d.ticketNumber = ticketInfo.ticketNumber;
      d.title = d.title || ticketInfo.title;
    }
  }

  var ticketLink = '';
  if (d.ticketId) {
    ticketLink = '\n🔗 <a href="' + self.baseUrl + '/#/tickets/' + d.ticketId + '">Abrir ticket</a>';
  }

  switch (event) {
    case 'TICKET_CREATED':
      var severityLine = d.severity
        ? '\n' + (SEVERITY_EMOJIS[d.severity] || '⚪') + ' <b>Severidade:</b> ' + (SEVERITY_LABELS[d.severity] || d.severity)
        : '';
      var campaignLine = d.campaignId ? '\n📋 <b>Campanha:</b> ' + d.campaignId : '';
      var descPreview = d.description ? d.description.substring(0, 150) : '';

      return '🎫 <b>Novo Ticket ' + (d.ticketNumber || '') + '</b>\n'
        + '\n📌 <b>Título:</b> ' + self._esc(d.title || '')
        + '\n🏷️ <b>Tipo:</b> ' + (TYPE_LABELS[d.type] || d.type) + ' | <b>Categoria:</b> ' + (CATEGORY_LABELS[d.category] || d.category)
        + severityLine
        + '\n👤 <b>Criado por:</b> ' + self._esc(d.authorName || '')
        + campaignLine
        + (descPreview ? '\n\n💬 <i>"' + self._esc(descPreview) + '"</i>' : '')
        + ticketLink
        + '\n🕐 ' + ts;

    case 'TICKET_UPDATED':
      var countNote = (d._coalescedCount && d._coalescedCount > 1)
        ? ' <i>(' + d._coalescedCount + ' edições agrupadas)</i>'
        : '';
      return '✏️ <b>Ticket ' + (d.ticketNumber || '') + ' Editado</b>' + countNote + '\n'
        + '\n📌 <b>Título:</b> ' + self._esc(d.title || '')
        + '\n👤 <b>Editado por:</b> ' + self._esc(d.authorName || '')
        + ticketLink
        + '\n🕐 ' + ts;

    case 'TICKET_STATUS_CHANGED':
      var toEmoji = STATUS_EMOJIS[d.toStatus] || '🔄';
      return toEmoji + ' <b>Ticket ' + (d.ticketNumber || '') + ' — Status Alterado</b>\n'
        + '\n📌 <b>Título:</b> ' + self._esc(d.title || '')
        + '\n📊 <b>Status:</b> ' + (STATUS_LABELS[d.fromStatus] || d.fromStatus)
        + ' → <b>' + (STATUS_LABELS[d.toStatus] || d.toStatus) + '</b>'
        + '\n👤 <b>Alterado por:</b> ' + self._esc(d.changedBy || '')
        + (d.reason ? '\n💬 <i>"' + self._esc(d.reason) + '"</i>' : '')
        + ticketLink
        + '\n🕐 ' + ts;

    case 'TICKET_COMMENTED':
      return '💬 <b>Novo Comentário — Ticket ' + (d.ticketNumber || '') + '</b>\n'
        + '\n📌 <b>Título:</b> ' + self._esc(d.title || '')
        + '\n👤 <b>Por:</b> ' + self._esc(d.authorName || '')
        + '\n💬 <i>"' + self._esc((d.textPreview || '').substring(0, 150)) + '"</i>'
        + ticketLink
        + '\n🕐 ' + ts;

    case 'TICKET_INTERNAL_NOTE':
      return '🔒 <b>Nota Interna — Ticket ' + (d.ticketNumber || '') + '</b>\n'
        + '\n📌 <b>Título:</b> ' + self._esc(d.title || '')
        + '\n👤 <b>Por:</b> ' + self._esc(d.authorName || '')
        + '\n📝 <i>"' + self._esc((d.textPreview || '').substring(0, 150)) + '"</i>'
        + '\n🕐 ' + ts;

    case 'TICKET_VOTE_MILESTONE':
      return '👍 <b>Ticket ' + (d.ticketNumber || '') + ' — ' + d.voteCount + ' votos</b>\n'
        + '\n📌 <b>Título:</b> ' + self._esc(d.title || '')
        + '\n⭐ Este ticket está recebendo atenção da equipe.'
        + ticketLink
        + '\n🕐 ' + ts;

    case 'TICKET_ATTACHMENT_ADDED':
      var attachCount = (d._coalescedCount && d._coalescedCount > 1)
        ? ' <i>(' + d._coalescedCount + ' anexos)</i>'
        : '';
      return '📎 <b>Anexo Adicionado — Ticket ' + (d.ticketNumber || '') + '</b>' + attachCount + '\n'
        + '\n📄 <b>Arquivo:</b> ' + self._esc(d.filename || '')
        + '\n👤 <b>Por:</b> ' + self._esc(d.uploadedBy || '')
        + ticketLink
        + '\n🕐 ' + ts;

    case 'TICKET_ATTACHMENT_REMOVED':
      return '🗑️ <b>Anexo Removido — Ticket ' + (d.ticketNumber || '') + '</b>\n'
        + '\n👤 <b>Por:</b> Admin'
        + ticketLink
        + '\n🕐 ' + ts;

    case 'CONSOLIDATION_DIVERGENCE':
      var inspectors = Array.isArray(d.inspectors) ? d.inspectors.join(', ') : (d.inspectors || '');
      return '⚠️ <b>Divergência de Classificação</b>\n'
        + '\n📋 <b>Campanha:</b> ' + self._esc(String(d.campaignId || ''))
        + '\n📍 <b>Ponto:</b> #' + self._esc(String(d.pointId || ''))
        + '\n👥 <b>Inspetores:</b> ' + self._esc(inspectors)
        + '\n⚖️ Não houve consenso na consolidação.'
        + '\n🕐 ' + ts;

    case 'DOUBT_CREATED': {
      var doubtLink = '\n🔗 <a href="' + self.baseUrl + '/#/admin/tickets">Abrir em tickets</a>';
      var doubtPreview = d.textPreview ? d.textPreview.substring(0, 150) : '';
      return '❓ <b>Nova dúvida registrada</b>\n'
        + '\n📍 <b>Ponto:</b> #' + self._esc(String(d.pointId || ''))
        + '\n📋 <b>Campanha:</b> ' + self._esc(String(d.campaignId || ''))
        + '\n👤 <b>Por:</b> ' + self._esc(d.author || '')
        + (d.year ? '\n📅 <b>Ano de referência:</b> ' + d.year : '')
        + (doubtPreview ? '\n\n💬 <i>"' + self._esc(doubtPreview) + '"</i>' : '')
        + doubtLink
        + '\n🕐 ' + ts;
    }

    case 'DOUBT_REOPENED': {
      var reopenLink = '\n🔗 <a href="' + self.baseUrl + '/#/admin/tickets">Abrir em tickets</a>';
      var reopenPreview = d.textPreview ? d.textPreview.substring(0, 150) : '';
      return '🔄 <b>Dúvida reaberta</b>\n'
        + '\n📍 <b>Ponto:</b> #' + self._esc(String(d.pointId || ''))
        + '\n📋 <b>Campanha:</b> ' + self._esc(String(d.campaignId || ''))
        + '\n👤 <b>Por:</b> ' + self._esc(d.author || '')
        + (reopenPreview ? '\n\n💬 <i>"' + self._esc(reopenPreview) + '"</i>' : '')
        + reopenLink
        + '\n🕐 ' + ts;
    }

    case 'DOUBT_COMMENTED': {
      var commentLink = '\n🔗 <a href="' + self.baseUrl + '/#/admin/tickets">Abrir em tickets</a>';
      var commentPreview = d.textPreview ? d.textPreview.substring(0, 150) : '';
      return '💬 <b>Novo comentário em dúvida</b>\n'
        + '\n📍 <b>Ponto:</b> #' + self._esc(String(d.pointId || ''))
        + '\n📋 <b>Campanha:</b> ' + self._esc(String(d.campaignId || ''))
        + '\n👤 <b>Por:</b> ' + self._esc(d.author || '')
        + (commentPreview ? '\n\n💬 <i>"' + self._esc(commentPreview) + '"</i>' : '')
        + commentLink
        + '\n🕐 ' + ts;
    }

    case 'DOUBT_ADMIN_COMMENT': {
      var adminLink = '\n🔗 <a href="' + self.baseUrl + '/#/admin/tickets">Abrir em tickets</a>';
      var adminPreview = d.textPreview ? d.textPreview.substring(0, 150) : '';
      return '🛡️ <b>Resposta da administração em dúvida</b>\n'
        + '\n📍 <b>Ponto:</b> #' + self._esc(String(d.pointId || ''))
        + '\n📋 <b>Campanha:</b> ' + self._esc(String(d.campaignId || ''))
        + '\n👤 <b>Por:</b> ' + self._esc(d.author || '')
        + (adminPreview ? '\n\n💬 <i>"' + self._esc(adminPreview) + '"</i>' : '')
        + adminLink
        + '\n🕐 ' + ts;
    }

    case 'DOUBT_RESOLVED': {
      var resolveLink = '\n🔗 <a href="' + self.baseUrl + '/#/admin/tickets">Abrir em tickets</a>';
      var toLabel = d.toStatus === 'RESOLVIDA' ? '✅ Resolvida' : '🔄 Reaberta';
      return '🛡️ <b>Dúvida transicionada</b>\n'
        + '\n📍 <b>Ponto:</b> #' + self._esc(String(d.pointId || ''))
        + '\n📋 <b>Campanha:</b> ' + self._esc(String(d.campaignId || ''))
        + '\n📊 <b>Status:</b> ' + toLabel
        + '\n👤 <b>Por:</b> ' + self._esc(d.author || '')
        + (d.reason ? '\n💬 <i>"' + self._esc(d.reason) + '"</i>' : '')
        + resolveLink
        + '\n🕐 ' + ts;
    }

    default:
      return null;
  }
};

// ============================================================
// RESUMO DIÁRIO
// ============================================================

/**
 * Gera e envia o resumo diário consolidado de tickets.
 */
TelegramNotifier.prototype.sendDailySummary = async function () {
  if (!this.enabled || !this.initialized || !this.tickets) return;

  var self = this;

  try {
    var now = new Date();
    var brNow = self._brasiliaDate(now);
    var dateKey = brNow.getFullYear() + '-' + String(brNow.getMonth() + 1).padStart(2, '0') + '-' + String(brNow.getDate()).padStart(2, '0');

    // Guarda de idempotência: impedir envio duplicado no mesmo dia via lock atômico
    var lockAcquired = await new Promise(function (resolve) {
      self.queue.findAndModify(
        { _id: '_daily_summary_lock', date: { $ne: dateKey } },
        [],
        { $set: { _id: '_daily_summary_lock', date: dateKey, sentAt: now } },
        { upsert: true, new: true },
        function (err, result) {
          if (err) {
            // Erro de duplicidade (E11000) indica que outro worker já adquiriu o lock
            if (err.code === 11000) return resolve(false);
            console.error('[TelegramNotifier] Erro ao adquirir lock de resumo diário:', err.message);
            return resolve(false);
          }
          resolve(!!result && !!result.value);
        }
      );
    });

    if (!lockAcquired) {
      console.log('[TelegramNotifier] Resumo diário já enviado hoje (' + dateKey + '), ignorando duplicata.');
      return;
    }

    // Meia-noite de Brasília convertida para UTC (adiciona 3h)
    var startOfDay = new Date(Date.UTC(brNow.getFullYear(), brNow.getMonth(), brNow.getDate(), 3, 0, 0));

    // Tickets criados hoje
    var createdToday = await self._count({ createdAt: { $gte: startOfDay } });

    // Tickets resolvidos hoje (via statusHistory)
    var resolvedToday = await self._count({
      'statusHistory': {
        $elemMatch: {
          to: { $in: ['RESOLVIDO', 'FECHADO'] },
          changedAt: { $gte: startOfDay }
        }
      }
    });

    // Comentários adicionados hoje
    var withCommentsToday = await self._count({
      'comments.createdAt': { $gte: startOfDay }
    });

    // Contagem por status (abertos)
    var openStatuses = ['ABERTO', 'EM_ANALISE', 'EM_DESENVOLVIMENTO'];
    var statusCounts = {};
    for (var i = 0; i < openStatuses.length; i++) {
      statusCounts[openStatuses[i]] = await self._count({ status: openStatuses[i] });
    }

    // Tickets críticos abertos
    var criticalOpen = await self._count({
      severity: 'CRITICA',
      status: { $in: openStatuses }
    });

    var date = self._formatDate(now);
    var time = self._formatTime(now);

    var criticalLine = criticalOpen > 0
      ? '\n🔴 <b>Tickets com severidade CRÍTICA abertos:</b> ' + criticalOpen
      : '';

    var html = '📰 <b>Resumo Diário — ' + date + '</b>\n'
      + '\n🎫 <b>Tickets:</b>'
      + '\n   🆕 Criados hoje: ' + createdToday
      + '\n   ✅ Resolvidos hoje: ' + resolvedToday
      + '\n   💬 Com comentários hoje: ' + withCommentsToday
      + '\n'
      + '\n📂 <b>Abertos por status:</b>'
      + '\n   ⬜ Aberto: ' + (statusCounts['ABERTO'] || 0)
      + '\n   🔍 Em Análise: ' + (statusCounts['EM_ANALISE'] || 0)
      + '\n   🔧 Em Desenvolvimento: ' + (statusCounts['EM_DESENVOLVIMENTO'] || 0)
      + criticalLine
      + '\n\n🕐 Gerado às ' + time;

    await self.sendMessage(self.chatId, html);
  } catch (err) {
    console.error('[TelegramNotifier] Erro no resumo diário:', err.message);
  }
};


// ============================================================
// FLUSH SILENT QUEUE
// ============================================================

/**
 * Libera notificações acumuladas durante o horário silencioso.
 * Chamado às 7h pelo cron job.
 */
TelegramNotifier.prototype.flushSilentQueue = async function () {
  if (!this.enabled || !this.initialized) return;

  var self = this;

  try {
    // Contar quantos estão retidos
    var count = await new Promise(function (resolve, reject) {
      self.queue.count({ processedAt: null, silentHold: true }, function (err, n) {
        if (err) return reject(err);
        resolve(n || 0);
      });
    });

    if (count === 0) return;

    // Enviar mensagem informativa
    var html = '🌅 <b>Notificações acumuladas durante horário silencioso</b>\n'
      + '\n📬 ' + count + ' evento(s) pendente(s) serão processados agora.'
      + '\n🕐 ' + self._formatTimestamp(new Date());

    await self.sendMessage(self.chatId, html);

    // Liberar para processamento
    self.queue.update(
      { processedAt: null, silentHold: true },
      { $set: { silentHold: false } },
      { multi: true },
      function (err) {
        if (err) console.error('[TelegramNotifier] Erro ao liberar fila silenciosa:', err.message);
      }
    );
  } catch (err) {
    console.error('[TelegramNotifier] Erro no flush silencioso:', err.message);
  }
};

// ============================================================
// UTILITÁRIOS
// ============================================================

/**
 * Verifica se o horário atual está no período de silêncio.
 */
TelegramNotifier.prototype.isSilentHours = function () {
  var hour = this._brasiliaDate().getHours();

  if (this.silentStart > this.silentEnd) {
    return hour >= this.silentStart || hour < this.silentEnd;
  }
  return hour >= this.silentStart && hour < this.silentEnd;
};

/**
 * Resolve ticketNumber a partir de ticketId (ObjectID string).
 */
TelegramNotifier.prototype._resolveTicket = async function (ticketId) {
  if (!this.tickets) return null;
  var self = this;
  var mongodb = require('mongodb');

  try {
    var id = new mongodb.ObjectID(ticketId);
    return await new Promise(function (resolve) {
      self.tickets.findOne({ _id: id }, { ticketNumber: 1, title: 1 }, function (err, ticket) {
        if (err || !ticket) return resolve(null);
        resolve(ticket);
      });
    });
  } catch (e) {
    return null;
  }
};

/**
 * Wrapper para count com Promise.
 */
TelegramNotifier.prototype._count = function (query) {
  var self = this;
  return new Promise(function (resolve, reject) {
    self.tickets.count(query, function (err, n) {
      if (err) return reject(err);
      resolve(n || 0);
    });
  });
};

/**
 * Escape de caracteres HTML para Telegram.
 */
TelegramNotifier.prototype._esc = function (str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

/**
 * Retorna um objeto Date ajustado para o fuso de Brasília (UTC-3).
 * Independe do timezone configurado no servidor/container.
 */
TelegramNotifier.prototype._brasiliaDate = function (date) {
  var d = date || new Date();
  // Criar nova data deslocada: hora UTC - 3h, representada como local
  var utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utcMs - 3 * 60 * 60000);
};

/**
 * Formata timestamp para exibição (dd/MM/yyyy às HH:mm) em horário de Brasília.
 */
TelegramNotifier.prototype._formatTimestamp = function (date) {
  return this._formatDate(date) + ' às ' + this._formatTime(date);
};

TelegramNotifier.prototype._formatDate = function (date) {
  var br = this._brasiliaDate(date);
  var d = br.getDate().toString().padStart(2, '0');
  var m = (br.getMonth() + 1).toString().padStart(2, '0');
  var y = br.getFullYear();
  return d + '/' + m + '/' + y;
};

TelegramNotifier.prototype._formatTime = function (date) {
  var br = this._brasiliaDate(date);
  var h = br.getHours().toString().padStart(2, '0');
  var min = br.getMinutes().toString().padStart(2, '0');
  return h + ':' + min;
};

/**
 * Gera barra de progresso em texto.
 */
TelegramNotifier.prototype.progressBar = function (percent, length) {
  length = length || 10;
  var filled = Math.round(percent / 100 * length);
  var empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty) + ' ' + percent + '%';
};

// ============================================================
// SINGLETON FACTORY (padrão express-load)
// ============================================================

var instance = null;

module.exports = function (app) {
  if (instance) {
    // Reinicializar se o repository ficou disponível
    if (!instance.initialized && app && app.repository && app.repository.db) {
      instance.app = app;
      instance.init();
    }
    return instance;
  }

  instance = new TelegramNotifier(app);
  return instance;
};
