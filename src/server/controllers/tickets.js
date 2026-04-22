var mongodb = require('mongodb');
var zlib = require('zlib');

module.exports = function (app) {

  var Tickets = {};
  const logger = app.services.logger;

  var tickets = app.repository.collections.tickets;
  var ticketCounters = app.repository.collections.ticket_counters;

  // Configurações de upload
  var MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  var ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg'];

  // Tipos e categorias válidos
  var VALID_TYPES = ['RECLAMACAO', 'SUGESTAO', 'DUVIDA', 'ELOGIO'];
  var VALID_CATEGORIES = ['INTERFACE', 'DESEMPENHO', 'FUNCIONALIDADE', 'DADOS', 'OUTRO'];
  var VALID_SEVERITIES = ['BAIXA', 'MEDIA', 'ALTA', 'CRITICA'];
  var VALID_STATUSES = ['ABERTO', 'EM_ANALISE', 'EM_DESENVOLVIMENTO', 'RESOLVIDO', 'FECHADO'];

  // Máquina de estados: transições válidas
  var STATUS_TRANSITIONS = {
    'ABERTO': ['EM_ANALISE', 'FECHADO'],
    'EM_ANALISE': ['EM_DESENVOLVIMENTO', 'RESOLVIDO', 'ABERTO'],
    'EM_DESENVOLVIMENTO': ['RESOLVIDO', 'EM_ANALISE'],
    'RESOLVIDO': ['FECHADO', 'ABERTO'],
    'FECHADO': []
  };

  /**
   * Extrai informações do autor a partir da sessão
   */
  function getAuthorFromSession(request) {
    if (request.session.admin) {
      return {
        name: request.session.admin.username || 'admin',
        role: 'super-admin',
        campaignId: null
      };
    }
    if (request.session.user) {
      return {
        name: request.session.user.name,
        role: request.session.user.type || 'inspector',
        campaignId: request.session.user.campaign ? request.session.user.campaign._id : null
      };
    }
    return null;
  }

  /**
   * Verifica se o usuário está autenticado (user ou admin)
   */
  function isAuthenticated(request) {
    return !!(request.session.user || request.session.admin);
  }

  /**
   * Verifica se é admin
   */
  function isAdmin(request) {
    return !!(request.session.admin);
  }

  /**
   * Gera número sequencial atômico para tickets
   */
  function getNextTicketNumber(callback) {
    ticketCounters.findAndModify(
      { _id: 'ticketNumber' },
      [],
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
      function (err, result) {
        if (err) return callback(err);
        var seq = result.value ? result.value.seq : 1;
        var ticketNumber = 'TKT-' + String(seq).padStart(6, '0');
        callback(null, ticketNumber);
      }
    );
  }

  /**
   * POST /service/tickets — Criar ticket
   */
  Tickets.create = async function (request, response) {
    if (!isAuthenticated(request)) {
      return response.status(401).json({ error: 'Não autenticado' });
    }

    var body = request.body;

    // Validação de campos obrigatórios
    if (!body.title || !body.title.trim()) {
      return response.status(400).json({ error: 'Título é obrigatório' });
    }
    if (body.title.length > 200) {
      return response.status(400).json({ error: 'Título deve ter no máximo 200 caracteres' });
    }
    if (!body.description || !body.description.trim()) {
      return response.status(400).json({ error: 'Descrição é obrigatória' });
    }
    if (!body.type || VALID_TYPES.indexOf(body.type) === -1) {
      return response.status(400).json({ error: 'Tipo inválido. Valores aceitos: ' + VALID_TYPES.join(', ') });
    }
    if (!body.category || VALID_CATEGORIES.indexOf(body.category) === -1) {
      return response.status(400).json({ error: 'Categoria inválida. Valores aceitos: ' + VALID_CATEGORIES.join(', ') });
    }

    // Severidade obrigatória apenas para RECLAMACAO
    if (body.type === 'RECLAMACAO') {
      if (!body.severity || VALID_SEVERITIES.indexOf(body.severity) === -1) {
        return response.status(400).json({ error: 'Severidade é obrigatória para reclamações. Valores aceitos: ' + VALID_SEVERITIES.join(', ') });
      }
    }

    var origin = body.origin || 'TVI';
    if (['TVI', 'PLUGIN_FGI'].indexOf(origin) === -1) {
      return response.status(400).json({ error: 'Origem inválida. Valores aceitos: TVI, PLUGIN_FGI' });
    }

    var author = getAuthorFromSession(request);

    getNextTicketNumber(async function (err, ticketNumber) {
      if (err) {
        var logId = await logger.error('Erro ao gerar número do ticket', {
          module: 'tickets',
          function: 'create',
          metadata: { error: err.message },
          req: request
        });
        return response.status(500).json({ error: 'Erro interno', logId: logId });
      }

      // Processar dados de diagnóstico (console logs, metadados do navegador)
      var diagnostics = null;
      if (body.diagnostics) {
        // Sanitizar: aceitar apenas campos conhecidos de metadata
        var rawMeta = body.diagnostics.metadata || {};
        var sanitizedMetadata = {};
        var allowedMetaFields = ['userAgent', 'url', 'screenResolution', 'viewportSize', 'capturedAt'];
        for (var i = 0; i < allowedMetaFields.length; i++) {
          var field = allowedMetaFields[i];
          if (rawMeta[field] && typeof rawMeta[field] === 'string') {
            sanitizedMetadata[field] = rawMeta[field].substring(0, 500);
          }
        }

        // Sanitizar logs: aceitar apenas entradas com estrutura válida, limitar a 200
        var rawLogs = Array.isArray(body.diagnostics.consoleLogs)
          ? body.diagnostics.consoleLogs.slice(0, 200)
          : [];
        var sanitizedLogs = [];
        var validLevels = ['log', 'warn', 'error', 'info'];
        for (var j = 0; j < rawLogs.length; j++) {
          var entry = rawLogs[j];
          if (entry && typeof entry.message === 'string' && validLevels.indexOf(entry.level) !== -1) {
            sanitizedLogs.push({
              level: entry.level,
              message: entry.message.substring(0, 2000),
              timestamp: typeof entry.timestamp === 'string' ? entry.timestamp.substring(0, 30) : ''
            });
          }
        }

        diagnostics = {
          consoleLogs: sanitizedLogs,
          metadata: sanitizedMetadata,
          capturedAt: new Date()
        };
      }

      var now = new Date();
      var ticket = {
        ticketNumber: ticketNumber,
        type: body.type,
        category: body.category,
        severity: body.type === 'RECLAMACAO' ? body.severity : null,
        status: 'ABERTO',
        title: body.title.trim(),
        description: body.description.trim(),
        origin: origin,
        author: author,
        diagnostics: diagnostics,
        comments: [],
        statusHistory: [],
        votes: [],
        voteCount: 0,
        attachments: [],
        createdAt: now,
        updatedAt: now,
        closedAt: null
      };

      tickets.insert(ticket, async function (err, result) {
        if (err) {
          var logId = await logger.error('Erro ao criar ticket', {
            module: 'tickets',
            function: 'create',
            metadata: { error: err.message },
            req: request
          });
          return response.status(500).json({ error: 'Erro ao criar ticket', logId: logId });
        }

        await logger.info('Ticket criado', {
          module: 'tickets',
          function: 'create',
          metadata: { ticketNumber: ticketNumber, type: body.type, author: author.name },
          req: request
        });

        var created = Array.isArray(result.ops) ? result.ops[0] : result;
        response.status(201).json(created);

        // Notificação Telegram (fire-and-forget)
        if (app.services.telegramNotifier) {
          app.services.telegramNotifier.enqueue('TICKET_CREATED', {
            ticketNumber: ticketNumber,
            ticketId: created._id ? created._id.toString() : null,
            type: body.type,
            category: body.category,
            severity: body.type === 'RECLAMACAO' ? body.severity : null,
            title: body.title.trim(),
            description: body.description.trim().substring(0, 200),
            authorName: author.name,
            authorRole: author.role,
            campaignId: author.campaignId
          }).catch(function () {});
        }
      });
    });
  };

  /**
   * GET /service/tickets — Listar tickets com filtros e paginação
   */
  Tickets.list = async function (request, response) {
    if (!isAuthenticated(request)) {
      return response.status(401).json({ error: 'Não autenticado' });
    }

    var query = {};
    var q = request.query;

    // Filtros
    if (q.type && VALID_TYPES.indexOf(q.type) !== -1) {
      query.type = q.type;
    }
    if (q.status && VALID_STATUSES.indexOf(q.status) !== -1) {
      query.status = q.status;
    }
    if (q.category && VALID_CATEGORIES.indexOf(q.category) !== -1) {
      query.category = q.category;
    }
    if (q.origin && ['TVI', 'PLUGIN_FGI'].indexOf(q.origin) !== -1) {
      query.origin = q.origin;
    }
    if (q.mine === 'true') {
      var author = getAuthorFromSession(request);
      if (author) {
        query['author.name'] = author.name;
      }
    }
    if (q.search && q.search.trim()) {
      var searchRegex = new RegExp(q.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { title: searchRegex },
        { ticketNumber: searchRegex }
      ];
    }

    // Paginação
    var page = parseInt(q.page) || 1;
    var limit = parseInt(q.limit) || 25;
    if (limit > 200) limit = 200;
    var skip = (page - 1) * limit;

    // Projeção: excluir campos pesados da listagem para performance
    var projection = { 'attachments.data': 0, 'diagnostics.consoleLogs': 0 };

    tickets.count(query, function (err, total) {
      if (err) {
        return response.status(500).json({ error: 'Erro ao contar tickets' });
      }

      tickets.find(query, projection)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(function (err, docs) {
          if (err) {
            return response.status(500).json({ error: 'Erro ao listar tickets' });
          }

          // Se não é admin, filtrar comentários internos
          if (!isAdmin(request)) {
            docs.forEach(function (doc) {
              if (doc.comments) {
                doc.comments = doc.comments.filter(function (c) { return !c.isInternal; });
              }
            });
          }

          response.json({
            data: docs,
            pagination: {
              total: total,
              page: page,
              limit: limit,
              pages: Math.ceil(total / limit)
            }
          });
        });
    });
  };

  /**
   * GET /service/tickets/:id — Detalhe do ticket
   */
  Tickets.getById = async function (request, response) {
    if (!isAuthenticated(request)) {
      return response.status(401).json({ error: 'Não autenticado' });
    }

    var id;
    try {
      id = new mongodb.ObjectID(request.params.id);
    } catch (e) {
      return response.status(400).json({ error: 'ID inválido' });
    }

    // Projeção: excluir attachments.data do detalhe (servidos via endpoint separado)
    tickets.findOne({ _id: id }, { 'attachments.data': 0 }, function (err, ticket) {
      if (err) {
        return response.status(500).json({ error: 'Erro ao buscar ticket' });
      }
      if (!ticket) {
        return response.status(404).json({ error: 'Ticket não encontrado' });
      }

      // Se não é admin, filtrar comentários internos
      if (!isAdmin(request)) {
        if (ticket.comments) {
          ticket.comments = ticket.comments.filter(function (c) { return !c.isInternal; });
        }
      }

      response.json(ticket);
    });
  };

  /**
   * PUT /service/tickets/:id — Editar ticket (somente se ABERTO, pelo autor ou admin)
   */
  Tickets.update = async function (request, response) {
    if (!isAuthenticated(request)) {
      return response.status(401).json({ error: 'Não autenticado' });
    }

    var id;
    try {
      id = new mongodb.ObjectID(request.params.id);
    } catch (e) {
      return response.status(400).json({ error: 'ID inválido' });
    }

    tickets.findOne({ _id: id }, function (err, ticket) {
      if (err) {
        return response.status(500).json({ error: 'Erro ao buscar ticket' });
      }
      if (!ticket) {
        return response.status(404).json({ error: 'Ticket não encontrado' });
      }

      // Somente tickets ABERTOS podem ser editados
      if (ticket.status !== 'ABERTO') {
        return response.status(400).json({ error: 'Somente tickets com status ABERTO podem ser editados' });
      }

      // Somente o autor ou admin pode editar
      var author = getAuthorFromSession(request);
      if (!isAdmin(request) && author && ticket.author.name !== author.name) {
        return response.status(403).json({ error: 'Apenas o autor ou um administrador pode editar este ticket' });
      }

      var body = request.body;
      var update = { updatedAt: new Date() };

      if (body.title !== undefined) {
        if (!body.title.trim()) {
          return response.status(400).json({ error: 'Título não pode ser vazio' });
        }
        if (body.title.length > 200) {
          return response.status(400).json({ error: 'Título deve ter no máximo 200 caracteres' });
        }
        update.title = body.title.trim();
      }
      if (body.description !== undefined) {
        if (!body.description.trim()) {
          return response.status(400).json({ error: 'Descrição não pode ser vazia' });
        }
        update.description = body.description.trim();
      }
      if (body.type !== undefined) {
        if (VALID_TYPES.indexOf(body.type) === -1) {
          return response.status(400).json({ error: 'Tipo inválido' });
        }
        update.type = body.type;
      }
      if (body.category !== undefined) {
        if (VALID_CATEGORIES.indexOf(body.category) === -1) {
          return response.status(400).json({ error: 'Categoria inválida' });
        }
        update.category = body.category;
      }
      if (body.severity !== undefined) {
        var effectiveType = update.type || ticket.type;
        if (effectiveType === 'RECLAMACAO') {
          if (VALID_SEVERITIES.indexOf(body.severity) === -1) {
            return response.status(400).json({ error: 'Severidade inválida' });
          }
          update.severity = body.severity;
        } else {
          update.severity = null;
        }
      }

      tickets.findAndModify(
        { _id: id },
        [],
        { $set: update },
        { new: true },
        function (err, result) {
          if (err) {
            return response.status(500).json({ error: 'Erro ao atualizar ticket' });
          }
          response.json(result.value);

          // Notificação Telegram (fire-and-forget)
          if (app.services.telegramNotifier && result.value) {
            app.services.telegramNotifier.enqueue('TICKET_UPDATED', {
              ticketNumber: result.value.ticketNumber,
              ticketId: id.toString(),
              title: result.value.title,
              authorName: author ? author.name : 'admin'
            }).catch(function () {});
          }
        }
      );
    });
  };

  /**
   * PATCH /service/tickets/:id/status — Alterar status (admin apenas)
   */
  Tickets.changeStatus = async function (request, response) {
    if (!isAdmin(request)) {
      return response.status(403).json({ error: 'Apenas administradores podem alterar o status' });
    }

    var id;
    try {
      id = new mongodb.ObjectID(request.params.id);
    } catch (e) {
      return response.status(400).json({ error: 'ID inválido' });
    }

    var body = request.body;
    if (!body.status || VALID_STATUSES.indexOf(body.status) === -1) {
      return response.status(400).json({ error: 'Status inválido. Valores aceitos: ' + VALID_STATUSES.join(', ') });
    }
    if (!body.reason || !body.reason.trim()) {
      return response.status(400).json({ error: 'Motivo da alteração é obrigatório' });
    }

    tickets.findOne({ _id: id }, async function (err, ticket) {
      if (err) {
        return response.status(500).json({ error: 'Erro ao buscar ticket' });
      }
      if (!ticket) {
        return response.status(404).json({ error: 'Ticket não encontrado' });
      }

      // Validar transição de estado
      var allowedTransitions = STATUS_TRANSITIONS[ticket.status] || [];
      if (allowedTransitions.indexOf(body.status) === -1) {
        return response.status(400).json({
          error: 'Transição inválida de "' + ticket.status + '" para "' + body.status + '". Transições permitidas: ' + (allowedTransitions.join(', ') || 'nenhuma (estado terminal)')
        });
      }

      var now = new Date();
      var author = getAuthorFromSession(request);
      var historyEntry = {
        from: ticket.status,
        to: body.status,
        changedBy: author ? author.name : 'admin',
        reason: body.reason.trim(),
        changedAt: now
      };

      var updateFields = {
        status: body.status,
        updatedAt: now
      };

      if (body.status === 'FECHADO') {
        updateFields.closedAt = now;
      }
      // Ao reabrir, limpar closedAt
      if (body.status === 'ABERTO' && ticket.closedAt) {
        updateFields.closedAt = null;
      }

      tickets.findAndModify(
        { _id: id },
        [],
        {
          $set: updateFields,
          $push: { statusHistory: historyEntry }
        },
        { new: true },
        async function (err, result) {
          if (err) {
            var logId = await logger.error('Erro ao alterar status do ticket', {
              module: 'tickets',
              function: 'changeStatus',
              metadata: { error: err.message, ticketId: id.toString() },
              req: request
            });
            return response.status(500).json({ error: 'Erro ao alterar status', logId: logId });
          }

          await logger.info('Status do ticket alterado', {
            module: 'tickets',
            function: 'changeStatus',
            metadata: {
              ticketNumber: ticket.ticketNumber,
              from: ticket.status,
              to: body.status,
              reason: body.reason.trim()
            },
            req: request
          });

          response.json(result.value);

          // Notificação Telegram (fire-and-forget)
          if (app.services.telegramNotifier) {
            app.services.telegramNotifier.enqueue('TICKET_STATUS_CHANGED', {
              ticketNumber: ticket.ticketNumber,
              ticketId: id.toString(),
              title: ticket.title,
              fromStatus: ticket.status,
              toStatus: body.status,
              reason: body.reason.trim(),
              changedBy: author ? author.name : 'admin'
            }).catch(function () {});
          }
        }
      );
    });
  };

  /**
   * POST /service/tickets/:id/comments — Adicionar comentário
   */
  Tickets.addComment = async function (request, response) {
    if (!isAuthenticated(request)) {
      return response.status(401).json({ error: 'Não autenticado' });
    }

    var id;
    try {
      id = new mongodb.ObjectID(request.params.id);
    } catch (e) {
      return response.status(400).json({ error: 'ID inválido' });
    }

    var body = request.body;
    if (!body.text || !body.text.trim()) {
      return response.status(400).json({ error: 'Texto do comentário é obrigatório' });
    }

    var author = getAuthorFromSession(request);
    var comment = {
      _id: new mongodb.ObjectID(),
      author: {
        name: author ? author.name : 'anônimo',
        role: author ? author.role : 'unknown'
      },
      text: body.text.trim(),
      isInternal: isAdmin(request) && body.isInternal === true,
      createdAt: new Date()
    };

    tickets.findAndModify(
      { _id: id },
      [],
      {
        $push: { comments: comment },
        $set: { updatedAt: new Date() }
      },
      { new: true },
      async function (err, result) {
        if (err) {
          var logId = await logger.error('Erro ao adicionar comentário', {
            module: 'tickets',
            function: 'addComment',
            metadata: { error: err.message, ticketId: id.toString() },
            req: request
          });
          return response.status(500).json({ error: 'Erro ao adicionar comentário', logId: logId });
        }

        if (!result.value) {
          return response.status(404).json({ error: 'Ticket não encontrado' });
        }

        response.json(comment);

        // Notificação Telegram (fire-and-forget)
        if (app.services.telegramNotifier) {
          var notifEvent = comment.isInternal ? 'TICKET_INTERNAL_NOTE' : 'TICKET_COMMENTED';
          app.services.telegramNotifier.enqueue(notifEvent, {
            ticketNumber: result.value.ticketNumber,
            ticketId: id.toString(),
            title: result.value.title,
            authorName: comment.author.name,
            textPreview: comment.text.substring(0, 150)
          }).catch(function () {});
        }
      }
    );
  };

  /**
   * GET /service/tickets/stats/summary — Estatísticas resumidas (admin)
   */
  Tickets.statsSummary = async function (request, response) {
    if (!isAdmin(request)) {
      return response.status(403).json({ error: 'Apenas administradores podem ver estatísticas' });
    }

    try {
      var pipeline = [
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ];

      tickets.aggregate(pipeline, function (err, statusCounts) {
        if (err) {
          return response.status(500).json({ error: 'Erro ao calcular estatísticas' });
        }

        // Converter resultado do aggregate (pode ser cursor ou array)
        var processResults = function (results) {
          var stats = {
            byStatus: {},
            total: 0
          };

          VALID_STATUSES.forEach(function (s) { stats.byStatus[s] = 0; });

          results.forEach(function (r) {
            stats.byStatus[r._id] = r.count;
            stats.total += r.count;
          });

          // Contar por tipo
          tickets.aggregate([
            { $group: { _id: '$type', count: { $sum: 1 } } }
          ], function (err2, typeCounts) {
            if (err2) {
              return response.status(500).json({ error: 'Erro ao calcular estatísticas por tipo' });
            }

            var processTypeResults = function (typeResults) {
              stats.byType = {};
              VALID_TYPES.forEach(function (t) { stats.byType[t] = 0; });
              typeResults.forEach(function (r) {
                stats.byType[r._id] = r.count;
              });

              response.json(stats);
            };

            if (Array.isArray(typeCounts)) {
              processTypeResults(typeCounts);
            } else {
              typeCounts.toArray(function (err3, arr) {
                if (err3) return response.status(500).json({ error: 'Erro ao processar estatísticas' });
                processTypeResults(arr);
              });
            }
          });
        };

        if (Array.isArray(statusCounts)) {
          processResults(statusCounts);
        } else {
          statusCounts.toArray(function (err2, arr) {
            if (err2) return response.status(500).json({ error: 'Erro ao processar estatísticas' });
            processResults(arr);
          });
        }
      });
    } catch (e) {
      var logId = await logger.error('Erro nas estatísticas de tickets', {
        module: 'tickets',
        function: 'statsSummary',
        metadata: { error: e.message },
        req: request
      });
      response.status(500).json({ error: 'Erro interno', logId: logId });
    }
  };

  /**
   * POST /service/tickets/:id/vote — Toggle voto no ticket
   */
  Tickets.toggleVote = async function (request, response) {
    if (!isAuthenticated(request)) {
      return response.status(401).json({ error: 'Não autenticado' });
    }

    var id;
    try {
      id = new mongodb.ObjectID(request.params.id);
    } catch (e) {
      return response.status(400).json({ error: 'ID inválido' });
    }

    var author = getAuthorFromSession(request);
    if (!author) {
      return response.status(401).json({ error: 'Não autenticado' });
    }

    var username = author.name;

    tickets.findOne({ _id: id }, { votes: 1, voteCount: 1 }, function (err, ticket) {
      if (err) {
        return response.status(500).json({ error: 'Erro ao buscar ticket' });
      }
      if (!ticket) {
        return response.status(404).json({ error: 'Ticket não encontrado' });
      }

      var votes = ticket.votes || [];
      var alreadyVoted = votes.indexOf(username) !== -1;

      var updateOp;
      if (alreadyVoted) {
        updateOp = {
          $pull: { votes: username },
          $inc: { voteCount: -1 },
          $set: { updatedAt: new Date() }
        };
      } else {
        updateOp = {
          $addToSet: { votes: username },
          $inc: { voteCount: 1 },
          $set: { updatedAt: new Date() }
        };
      }

      tickets.findAndModify(
        { _id: id },
        [],
        updateOp,
        { new: true, fields: { votes: 1, voteCount: 1 } },
        function (err, result) {
          if (err) {
            return response.status(500).json({ error: 'Erro ao registrar voto' });
          }

          var updated = result.value;
          response.json({
            voted: !alreadyVoted,
            voteCount: updated.voteCount,
            votes: updated.votes
          });

          // Notificação Telegram: apenas ao atingir threshold de votos (fire-and-forget)
          var voteThreshold = parseInt(process.env.TELEGRAM_VOTE_THRESHOLD) || 3;
          if (app.services.telegramNotifier && !alreadyVoted && updated.voteCount >= voteThreshold) {
            app.services.telegramNotifier.enqueue('TICKET_VOTE_MILESTONE', {
              ticketId: id.toString(),
              voteCount: updated.voteCount
            }).catch(function () {});
          }
        }
      );
    });
  };

  /**
   * POST /service/tickets/:id/attachments — Upload de imagem
   * Recebe arquivo via multer (memory storage), compacta com zlib, salva como Binary no MongoDB
   */
  Tickets.uploadAttachment = async function (request, response) {
    if (!isAuthenticated(request)) {
      return response.status(401).json({ error: 'Não autenticado' });
    }

    var id;
    try {
      id = new mongodb.ObjectID(request.params.id);
    } catch (e) {
      return response.status(400).json({ error: 'ID inválido' });
    }

    // Multer 0.1.x: arquivos ficam em req.files (objeto com campo como chave ou array)
    var file = null;
    if (request.files) {
      // Formato objeto: { file: { ... } } ou { file: [{ ... }] }
      var fileField = request.files.file;
      if (Array.isArray(fileField)) {
        file = fileField[0];
      } else if (fileField) {
        file = fileField;
      } else {
        // Pode ser array direto
        var keys = Object.keys(request.files);
        if (keys.length > 0) {
          var first = request.files[keys[0]];
          file = Array.isArray(first) ? first[0] : first;
        }
      }
    }

    if (!file) {
      return response.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    // Validar tipo MIME
    var mimeType = file.mimetype || file.type;
    if (ALLOWED_MIME_TYPES.indexOf(mimeType) === -1) {
      return response.status(400).json({ error: 'Tipo de arquivo não permitido. Apenas PNG e JPG são aceitos.' });
    }

    // Validar tamanho
    if (file.size > MAX_FILE_SIZE) {
      return response.status(400).json({ error: 'Arquivo excede o tamanho máximo de 10 MB.' });
    }

    // Verificar se o ticket existe
    tickets.findOne({ _id: id }, { _id: 1 }, function (err, ticket) {
      if (err) {
        return response.status(500).json({ error: 'Erro ao buscar ticket' });
      }
      if (!ticket) {
        return response.status(404).json({ error: 'Ticket não encontrado' });
      }

      // Compactar com zlib (multer 0.1.x: buffer em file.buffer)
      var fileBuffer = file.buffer;
      var mimeType = file.mimetype || file.type;
      zlib.deflate(fileBuffer, async function (err, compressedData) {
        if (err) {
          var logId = await logger.error('Erro ao compactar imagem', {
            module: 'tickets',
            function: 'uploadAttachment',
            metadata: { error: err.message, ticketId: id.toString() },
            req: request
          });
          return response.status(500).json({ error: 'Erro ao processar imagem', logId: logId });
        }

        var author = getAuthorFromSession(request);
        var attachmentId = new mongodb.ObjectID();
        var attachment = {
          _id: attachmentId,
          filename: file.originalname || file.name,
          mimeType: mimeType,
          originalSize: file.size,
          compressedSize: compressedData.length,
          data: new mongodb.Binary(compressedData),
          uploadedBy: author ? author.name : 'anônimo',
          uploadedAt: new Date()
        };

        tickets.findAndModify(
          { _id: id },
          [],
          {
            $push: { attachments: attachment },
            $set: { updatedAt: new Date() }
          },
          { new: false },
          async function (err) {
            if (err) {
              var logId = await logger.error('Erro ao salvar anexo', {
                module: 'tickets',
                function: 'uploadAttachment',
                metadata: { error: err.message, ticketId: id.toString() },
                req: request
              });
              return response.status(500).json({ error: 'Erro ao salvar anexo', logId: logId });
            }

            await logger.info('Anexo adicionado ao ticket', {
              module: 'tickets',
              function: 'uploadAttachment',
              metadata: {
                ticketId: id.toString(),
                filename: file.originalname,
                originalSize: file.size,
                compressedSize: compressedData.length
              },
              req: request
            });

            // Retornar metadados sem o campo data
            response.status(201).json({
              _id: attachmentId,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              originalSize: attachment.originalSize,
              compressedSize: attachment.compressedSize,
              uploadedBy: attachment.uploadedBy,
              uploadedAt: attachment.uploadedAt
            });

            // Notificação Telegram (fire-and-forget)
            if (app.services.telegramNotifier) {
              app.services.telegramNotifier.enqueue('TICKET_ATTACHMENT_ADDED', {
                ticketId: id.toString(),
                filename: attachment.filename,
                uploadedBy: attachment.uploadedBy
              }).catch(function () {});
            }
          }
        );
      });
    });
  };

  /**
   * GET /service/tickets/:id/attachments/:attachId — Servir imagem descompactada
   */
  Tickets.getAttachment = async function (request, response) {
    if (!isAuthenticated(request)) {
      return response.status(401).json({ error: 'Não autenticado' });
    }

    var id, attachId;
    try {
      id = new mongodb.ObjectID(request.params.id);
      attachId = new mongodb.ObjectID(request.params.attachId);
    } catch (e) {
      return response.status(400).json({ error: 'ID inválido' });
    }

    tickets.findOne(
      { _id: id, 'attachments._id': attachId },
      { 'attachments.$': 1 },
      function (err, ticket) {
        if (err) {
          return response.status(500).json({ error: 'Erro ao buscar anexo' });
        }
        if (!ticket || !ticket.attachments || ticket.attachments.length === 0) {
          return response.status(404).json({ error: 'Anexo não encontrado' });
        }

        var attachment = ticket.attachments[0];
        var compressedBuffer = attachment.data.buffer || attachment.data;

        zlib.inflate(compressedBuffer, function (err, originalData) {
          if (err) {
            return response.status(500).json({ error: 'Erro ao descompactar imagem' });
          }

          response.set('Content-Type', attachment.mimeType);
          response.set('Content-Disposition', 'inline; filename="' + attachment.filename + '"');
          response.set('Content-Length', originalData.length);
          response.set('Cache-Control', 'public, max-age=86400');
          response.send(originalData);
        });
      }
    );
  };

  /**
   * DELETE /service/tickets/:id/attachments/:attachId — Remover anexo (admin)
   */
  Tickets.deleteAttachment = async function (request, response) {
    if (!isAdmin(request)) {
      return response.status(403).json({ error: 'Apenas administradores podem remover anexos' });
    }

    var id, attachId;
    try {
      id = new mongodb.ObjectID(request.params.id);
      attachId = new mongodb.ObjectID(request.params.attachId);
    } catch (e) {
      return response.status(400).json({ error: 'ID inválido' });
    }

    tickets.findAndModify(
      { _id: id },
      [],
      {
        $pull: { attachments: { _id: attachId } },
        $set: { updatedAt: new Date() }
      },
      { new: true },
      async function (err, result) {
        if (err) {
          return response.status(500).json({ error: 'Erro ao remover anexo' });
        }
        if (!result.value) {
          return response.status(404).json({ error: 'Ticket não encontrado' });
        }

        await logger.info('Anexo removido do ticket', {
          module: 'tickets',
          function: 'deleteAttachment',
          metadata: { ticketId: id.toString(), attachmentId: attachId.toString() },
          req: request
        });

        response.json({ success: true });

        // Notificação Telegram (fire-and-forget)
        if (app.services.telegramNotifier) {
          app.services.telegramNotifier.enqueue('TICKET_ATTACHMENT_REMOVED', {
            ticketId: id.toString()
          }).catch(function () {});
        }
      }
    );
  };

  /**
   * GET /service/tickets/stats/dashboard — Aggregation para gráficos do dashboard (admin)
   */
  Tickets.statsDashboard = async function (request, response) {
    if (!isAdmin(request)) {
      return response.status(403).json({ error: 'Apenas administradores podem ver o dashboard' });
    }

    try {
      var now = new Date();
      var twelveWeeksAgo = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);
      var startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Pipeline: distribuição por tipo
      var byTypePipeline = [
        { $group: { _id: '$type', count: { $sum: 1 } } }
      ];

      // Pipeline: tickets por status
      var byStatusPipeline = [
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ];

      // Pipeline: tickets por categoria
      var byCategoryPipeline = [
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ];

      // Pipeline: resolvidos este mês
      var resolvedThisMonthPipeline = [
        {
          $match: {
            status: { $in: ['RESOLVIDO', 'FECHADO'] },
            closedAt: { $gte: startOfMonth }
          }
        },
        { $count: 'count' }
      ];

      // Pipeline: tempo médio de resolução (tickets com closedAt)
      var avgResolutionPipeline = [
        {
          $match: {
            closedAt: { $ne: null }
          }
        },
        {
          $project: {
            resolutionTime: { $subtract: ['$closedAt', '$createdAt'] }
          }
        },
        {
          $group: {
            _id: null,
            avgTime: { $avg: '$resolutionTime' }
          }
        }
      ];

      // Pipeline: tickets criados por semana (últimas 12 semanas)
      var weeklyPipeline = [
        {
          $match: {
            createdAt: { $gte: twelveWeeksAgo }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              week: { $week: '$createdAt' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.week': 1 } }
      ];

      // Função auxiliar para executar aggregate e retornar array
      function runAggregate(pipeline, callback) {
        tickets.aggregate(pipeline, function (err, result) {
          if (err) return callback(err);
          if (Array.isArray(result)) {
            callback(null, result);
          } else {
            result.toArray(callback);
          }
        });
      }

      // Total de tickets abertos
      tickets.count({ status: { $in: ['ABERTO', 'EM_ANALISE', 'EM_DESENVOLVIMENTO'] } }, function (err, openCount) {
        if (err) return response.status(500).json({ error: 'Erro ao calcular estatísticas' });

        runAggregate(byTypePipeline, function (err, byType) {
          if (err) return response.status(500).json({ error: 'Erro ao calcular distribuição por tipo' });

          runAggregate(byStatusPipeline, function (err, byStatus) {
            if (err) return response.status(500).json({ error: 'Erro ao calcular distribuição por status' });

            runAggregate(byCategoryPipeline, function (err, byCategory) {
              if (err) return response.status(500).json({ error: 'Erro ao calcular distribuição por categoria' });

              runAggregate(resolvedThisMonthPipeline, function (err, resolvedThisMonth) {
                if (err) return response.status(500).json({ error: 'Erro ao calcular resolvidos no mês' });

                runAggregate(avgResolutionPipeline, function (err, avgResolution) {
                  if (err) return response.status(500).json({ error: 'Erro ao calcular tempo médio' });

                  runAggregate(weeklyPipeline, function (err, weekly) {
                    if (err) return response.status(500).json({ error: 'Erro ao calcular dados semanais' });

                    // Montar resposta
                    var dashboard = {
                      kpi: {
                        openCount: openCount,
                        resolvedThisMonth: (resolvedThisMonth.length > 0) ? resolvedThisMonth[0].count : 0,
                        avgResolutionMs: (avgResolution.length > 0 && avgResolution[0].avgTime) ? avgResolution[0].avgTime : null
                      },
                      charts: {
                        byType: byType,
                        byStatus: byStatus,
                        byCategory: byCategory,
                        weekly: weekly
                      }
                    };

                    response.json(dashboard);
                  });
                });
              });
            });
          });
        });
      });

    } catch (e) {
      var logId = await logger.error('Erro no dashboard de tickets', {
        module: 'tickets',
        function: 'statsDashboard',
        metadata: { error: e.message },
        req: request
      });
      response.status(500).json({ error: 'Erro interno', logId: logId });
    }
  };

  return Tickets;
};
