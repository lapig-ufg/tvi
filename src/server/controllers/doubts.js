/*
 * Controller: doubts
 *
 * Implementa o ciclo de vida da subestrutura `doubt` nos documentos da
 * coleção `points`, permitindo que intérpretes registrem dúvidas
 * durante a inspeção e que super-admins leiam/respondam/resolvam o
 * caso. O modelo (comments[] + statusHistory[]) espelha o padrão já
 * consolidado em `controllers/tickets.js`.
 *
 * Rotas registradas em `routes/doubts.js`:
 *   POST /service/points/:pointId/doubt               (intérprete)
 *   GET  /service/points/:pointId/doubt               (intérprete ou admin)
 *   GET  /api/campaigns/:id/doubts                    (super-admin)
 *   GET  /api/campaigns/:id/doubts/summary            (super-admin)
 *   POST /api/campaigns/:id/points/:pointId/doubt/comments  (super-admin)
 *   PUT  /api/points/:pointId/doubt/resolve           (super-admin)
 */
var mongodb = require('mongodb');

module.exports = function (app) {

	var Doubts = {};
	var points = app.repository.collections.points;
	var logger = app.services.logger;

	// Autorização: qualquer inspetor autenticado pode registrar/ler dúvidas
	// sobre pontos da sua própria campanha. O filtro restritivo anterior
	// (exigir que o usuário tivesse avaliado ou estivesse avaliando o
	// ponto) impedia fluxos legítimos — p.ex., registrar dúvida antes de
	// abrir o ponto, ou consultar dúvidas registradas por colegas da
	// mesma campanha. Mantemos apenas o isolamento por campanha, que é a
	// fronteira real de segurança.

	// Validações e regras de negócio
	var VALID_STATUSES = ['ABERTA', 'RESOLVIDA'];
	var MIN_COMMENT_LENGTH = 5;
	var MAX_COMMENT_LENGTH = 2000;
	var MAX_REASON_LENGTH = 500;

	/**
	 * Sanitiza e valida o texto do comentário.
	 * Retorna { ok: boolean, value?: string, error?: string }.
	 */
	function validateCommentText(raw) {
		if (raw === undefined || raw === null) {
			return { ok: false, error: 'Texto do comentário é obrigatório' };
		}
		if (typeof raw !== 'string') {
			return { ok: false, error: 'Texto do comentário deve ser uma string' };
		}
		var trimmed = raw.trim();
		if (trimmed.length < MIN_COMMENT_LENGTH) {
			return { ok: false, error: 'Texto do comentário deve ter ao menos ' + MIN_COMMENT_LENGTH + ' caracteres' };
		}
		if (trimmed.length > MAX_COMMENT_LENGTH) {
			return { ok: false, error: 'Texto do comentário deve ter no máximo ' + MAX_COMMENT_LENGTH + ' caracteres' };
		}
		return { ok: true, value: trimmed };
	}

	function validateYear(raw, campaign) {
		if (raw === undefined || raw === null || raw === '') {
			return { ok: true, value: null };
		}
		var year = parseInt(raw, 10);
		if (isNaN(year)) {
			return { ok: false, error: 'Ano de referência inválido' };
		}
		if (campaign && campaign.initialYear && campaign.finalYear) {
			if (year < campaign.initialYear || year > campaign.finalYear) {
				return { ok: false, error: 'Ano fora do intervalo da campanha' };
			}
		} else {
			// fallback defensivo
			if (year < 1970 || year > 2100) {
				return { ok: false, error: 'Ano de referência inválido' };
			}
		}
		return { ok: true, value: year };
	}

	/**
	 * Identifica o autor a partir da sessão, preservando o padrão usado em
	 * tickets.getAuthorFromSession.
	 */
	function getAuthorFromSession(request) {
		if (request.session && request.session.admin) {
			return {
				name: request.session.admin.username || 'admin',
				role: 'super-admin'
			};
		}
		if (request.session && request.session.user) {
			return {
				name: request.session.user.name,
				role: request.session.user.type || 'inspector'
			};
		}
		return null;
	}

	function isSuperAdmin(request) {
		return !!(request.session && request.session.admin && request.session.admin.superAdmin);
	}

	/**
	 * POST /service/points/:pointId/doubt
	 *
	 * Intérprete registra (ou reabre) a dúvida sobre um ponto. Qualquer
	 * inspetor autenticado pode registrar, desde que o ponto pertença à
	 * sua campanha atual.
	 */
	Doubts.addInspectorComment = async function (request, response) {
		var user = request.session && request.session.user;
		if (!user || !user.campaign || !user.campaign._id) {
			return response.status(401).json({ error: 'Sessão de usuário inválida' });
		}

		var pointId = request.params.pointId;
		if (!pointId || typeof pointId !== 'string') {
			return response.status(400).json({ error: 'ID do ponto inválido' });
		}

		var body = request.body || {};
		var commentCheck = validateCommentText(body.text);
		if (!commentCheck.ok) {
			return response.status(400).json({ error: commentCheck.error });
		}

		var yearCheck = validateYear(body.year, user.campaign);
		if (!yearCheck.ok) {
			return response.status(400).json({ error: yearCheck.error });
		}

		points.findOne({ _id: pointId }, { campaign: 1, doubt: 1 }, async function (err, point) {
			if (err) {
				if (logger) {
					await logger.error('Erro ao buscar ponto para dúvida', {
						module: 'doubts',
						function: 'addInspectorComment',
						metadata: { pointId: pointId, error: err.message }
					});
				}
				return response.status(500).json({ error: 'Erro ao buscar ponto' });
			}
			if (!point) {
				return response.status(404).json({ error: 'Ponto não encontrado' });
			}

			// Isolamento por campanha: impede vazamento cross-campanha.
			if (String(point.campaign) !== String(user.campaign._id)) {
				return response.status(403).json({ error: 'Ponto não pertence à campanha atual' });
			}

			var now = new Date();
			var comment = {
				_id: new mongodb.ObjectID(),
				author: { name: user.name, role: 'inspector' },
				text: commentCheck.value,
				year: yearCheck.value,
				createdAt: now
			};

			var hasExistingDoubt = !!point.doubt;
			var currentStatus = hasExistingDoubt && point.doubt.status ? point.doubt.status : null;

			// Monta operação atômica em um único $set/$push/setOnInsert.
			// Observação: como o documento `points` já existe, `$setOnInsert`
			// não dispara; portanto gravamos openedBy/openedAt condicionalmente
			// usando o resultado do findOne acima, e fazemos o $push em uma
			// única operação findAndModify para preservar ordem cronológica
			// dos comentários (evita read-then-write com múltiplas writes).
			var setFields = {
				'doubt.status': 'ABERTA'
			};
			var historyEntry = {
				from: currentStatus,
				to: 'ABERTA',
				changedBy: user.name,
				reason: null,
				changedAt: now
			};

			if (!hasExistingDoubt) {
				setFields['doubt.openedBy'] = user.name;
				setFields['doubt.openedAt'] = now;
				setFields['doubt.resolvedBy'] = null;
				setFields['doubt.resolvedAt'] = null;
			} else if (currentStatus === 'RESOLVIDA') {
				// Reabertura: registrar limpeza de resolver.
				setFields['doubt.resolvedBy'] = null;
				setFields['doubt.resolvedAt'] = null;
			}

			var update = {
				$set: setFields,
				$push: {
					'doubt.comments': comment,
					'doubt.statusHistory': historyEntry
				}
			};

			// Se é a primeira abertura e o status histórico é vazio, ainda
			// registramos a transição null → ABERTA acima. Em reaberturas,
			// from recebe 'RESOLVIDA' e to 'ABERTA'. Se a dúvida já estava
			// ABERTA, registramos ABERTA → ABERTA para manter rastreabilidade
			// temporal de cada comentário novo sem perder casos de borda.

			points.findAndModify(
				{ _id: pointId },
				[],
				update,
				{ new: true, fields: { doubt: 1 } },
				async function (err, result) {
					if (err) {
						if (logger) {
							await logger.error('Erro ao gravar dúvida', {
								module: 'doubts',
								function: 'addInspectorComment',
								metadata: { pointId: pointId, error: err.message }
							});
						}
						return response.status(500).json({ error: 'Erro ao gravar dúvida' });
					}
					if (!result || !result.value) {
						return response.status(404).json({ error: 'Ponto não encontrado' });
					}

					if (logger) {
						await logger.info('Dúvida registrada pelo intérprete', {
							module: 'doubts',
							function: 'addInspectorComment',
							metadata: {
								pointId: pointId,
								campaignId: user.campaign._id,
								author: user.name,
								reopen: currentStatus === 'RESOLVIDA'
							}
						});
					}

					response.status(201).json({
						success: true,
						comment: comment,
						doubt: result.value.doubt
					});

					// Notificação Telegram (fire-and-forget)
					if (app.services.telegramNotifier) {
						var notifEvent;
						if (!hasExistingDoubt) {
							notifEvent = 'DOUBT_CREATED';
						} else if (currentStatus === 'RESOLVIDA') {
							notifEvent = 'DOUBT_REOPENED';
						} else {
							notifEvent = 'DOUBT_COMMENTED';
						}
						app.services.telegramNotifier.enqueue(notifEvent, {
							pointId: pointId,
							campaignId: String(point.campaign || user.campaign._id),
							author: user.name,
							year: yearCheck.value,
							textPreview: commentCheck.value.substring(0, 150)
						}).catch(function () {});
					}
				}
			);
		});
	};

	/**
	 * GET /service/points/:pointId/doubt
	 *
	 * Permite ler a dúvida de um ponto. O super-admin lê qualquer ponto;
	 * o intérprete lê pontos da sua campanha atual.
	 */
	Doubts.getDoubt = async function (request, response) {
		var pointId = request.params.pointId;
		if (!pointId || typeof pointId !== 'string') {
			return response.status(400).json({ error: 'ID do ponto inválido' });
		}

		var user = request.session && request.session.user;
		var admin = isSuperAdmin(request);
		if (!user && !admin) {
			return response.status(401).json({ error: 'Não autenticado' });
		}

		points.findOne({ _id: pointId }, { campaign: 1, doubt: 1 }, async function (err, point) {
			if (err) {
				return response.status(500).json({ error: 'Erro ao buscar ponto' });
			}
			if (!point) {
				return response.status(404).json({ error: 'Ponto não encontrado' });
			}

			if (!admin) {
				if (!user || !user.campaign || String(point.campaign) !== String(user.campaign._id)) {
					return response.status(403).json({ error: 'Acesso negado' });
				}
			}

			response.json({
				pointId: point._id,
				campaign: point.campaign,
				doubt: point.doubt || null
			});
		});
	};

	/**
	 * GET /api/campaigns/:id/doubts
	 *
	 * Lista pontos com dúvida na campanha (paginação). Restrito a
	 * super-admin pelo middleware da rota.
	 */
	Doubts.listAdmin = async function (request, response) {
		var campaignId = request.params.id;
		if (!campaignId) {
			return response.status(400).json({ error: 'ID da campanha é obrigatório' });
		}

		var q = request.query || {};
		var page = parseInt(q.page, 10) || 1;
		var limit = parseInt(q.limit, 10) || 25;
		if (limit > 200) limit = 200;
		if (page < 1) page = 1;
		var skip = (page - 1) * limit;

		var status = q.status || 'ABERTA';
		var query = { campaign: campaignId };

		if (status === 'ALL') {
			query['doubt'] = { $exists: true };
		} else if (VALID_STATUSES.indexOf(status) !== -1) {
			query['doubt.status'] = status;
		} else {
			return response.status(400).json({ error: 'Status inválido' });
		}

		if (q.user && typeof q.user === 'string' && q.user.trim()) {
			query['doubt.openedBy'] = q.user.trim();
		}

		var projection = {
			_id: 1,
			campaign: 1,
			lat: 1,
			lon: 1,
			uf: 1,
			biome: 1,
			county: 1,
			index: 1,
			userName: 1,
			doubt: 1
		};

		points.count(query, function (err, total) {
			if (err) {
				return response.status(500).json({ error: 'Erro ao contar pontos' });
			}
			points.find(query, projection)
				.sort({ 'doubt.openedAt': -1 })
				.skip(skip)
				.limit(limit)
				.toArray(function (err, docs) {
					if (err) {
						return response.status(500).json({ error: 'Erro ao listar pontos' });
					}
					response.json({
						points: docs,
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
	 * GET /api/campaigns/:id/doubts/summary
	 *
	 * Retorna contagens agregadas (total/abertas/resolvidas) para
	 * alimentar o stat-card do modal administrativo.
	 */
	Doubts.summaryAdmin = function (request, response) {
		var campaignId = request.params.id;
		if (!campaignId) {
			return response.status(400).json({ error: 'ID da campanha é obrigatório' });
		}

		var pipeline = [
			{ $match: { campaign: campaignId, doubt: { $exists: true } } },
			{ $group: { _id: '$doubt.status', count: { $sum: 1 } } }
		];

		points.aggregate(pipeline, function (err, result) {
			if (err) {
				return response.status(500).json({ error: 'Erro ao calcular resumo' });
			}

			var finish = function (arr) {
				var summary = { open: 0, resolved: 0, total: 0 };
				(arr || []).forEach(function (entry) {
					if (entry._id === 'ABERTA') summary.open = entry.count;
					else if (entry._id === 'RESOLVIDA') summary.resolved = entry.count;
					summary.total += entry.count;
				});
				response.json(summary);
			};

			if (Array.isArray(result)) {
				finish(result);
			} else if (result && typeof result.toArray === 'function') {
				result.toArray(function (err, arr) {
					if (err) return response.status(500).json({ error: 'Erro ao processar resumo' });
					finish(arr);
				});
			} else {
				finish([]);
			}
		});
	};

	/**
	 * POST /api/campaigns/:id/points/:pointId/doubt/comments
	 *
	 * Super-admin adiciona uma resposta à dúvida do ponto.
	 */
	Doubts.addAdminComment = async function (request, response) {
		if (!isSuperAdmin(request)) {
			return response.status(401).json({ error: 'Super-admin authentication required' });
		}

		var campaignId = request.params.id;
		var pointId = request.params.pointId;
		if (!campaignId || !pointId) {
			return response.status(400).json({ error: 'IDs obrigatórios' });
		}

		var body = request.body || {};
		var commentCheck = validateCommentText(body.text);
		if (!commentCheck.ok) {
			return response.status(400).json({ error: commentCheck.error });
		}

		var author = getAuthorFromSession(request);
		var now = new Date();
		var comment = {
			_id: new mongodb.ObjectID(),
			author: { name: author ? author.name : 'admin', role: 'super-admin' },
			text: commentCheck.value,
			year: null,
			createdAt: now
		};

		points.findAndModify(
			{ _id: pointId, campaign: campaignId, doubt: { $exists: true } },
			[],
			{ $push: { 'doubt.comments': comment } },
			{ new: true, fields: { doubt: 1 } },
			async function (err, result) {
				if (err) {
					if (logger) {
						await logger.error('Erro ao adicionar comentário admin', {
							module: 'doubts',
							function: 'addAdminComment',
							metadata: { pointId: pointId, error: err.message }
						});
					}
					return response.status(500).json({ error: 'Erro ao adicionar comentário' });
				}
				if (!result || !result.value) {
					return response.status(404).json({ error: 'Ponto ou dúvida não encontrada' });
				}
				response.status(201).json({ success: true, comment: comment, doubt: result.value.doubt });

				// Notificação Telegram (fire-and-forget)
				if (app.services.telegramNotifier) {
					app.services.telegramNotifier.enqueue('DOUBT_ADMIN_COMMENT', {
						pointId: pointId,
						campaignId: String(campaignId),
						author: comment.author.name,
						textPreview: commentCheck.value.substring(0, 150)
					}).catch(function () {});
				}
			}
		);
	};

	/**
	 * PUT /api/points/:pointId/doubt/resolve
	 *
	 * Super-admin transiciona o status da dúvida (ABERTA ↔ RESOLVIDA).
	 * Aceita body: { status: 'RESOLVIDA' | 'ABERTA', reason: string }.
	 */
	Doubts.resolveAdmin = async function (request, response) {
		if (!isSuperAdmin(request)) {
			return response.status(401).json({ error: 'Super-admin authentication required' });
		}

		var pointId = request.params.pointId;
		if (!pointId) {
			return response.status(400).json({ error: 'ID do ponto inválido' });
		}

		var body = request.body || {};
		var targetStatus = body.status;
		if (VALID_STATUSES.indexOf(targetStatus) === -1) {
			return response.status(400).json({ error: 'Status inválido. Valores aceitos: ' + VALID_STATUSES.join(', ') });
		}

		var reasonRaw = body.reason;
		if (!reasonRaw || typeof reasonRaw !== 'string' || !reasonRaw.trim()) {
			return response.status(400).json({ error: 'Motivo da transição é obrigatório' });
		}
		var reason = reasonRaw.trim();
		if (reason.length > MAX_REASON_LENGTH) {
			return response.status(400).json({ error: 'Motivo deve ter no máximo ' + MAX_REASON_LENGTH + ' caracteres' });
		}

		var author = getAuthorFromSession(request);
		var authorName = author ? author.name : 'admin';

		points.findOne({ _id: pointId }, { doubt: 1, campaign: 1 }, async function (err, point) {
			if (err) {
				return response.status(500).json({ error: 'Erro ao buscar ponto' });
			}
			if (!point || !point.doubt) {
				return response.status(404).json({ error: 'Dúvida não encontrada' });
			}
			if (point.doubt.status === targetStatus) {
				return response.status(400).json({ error: 'A dúvida já está no status informado' });
			}

			var now = new Date();
			var setFields = {
				'doubt.status': targetStatus
			};
			if (targetStatus === 'RESOLVIDA') {
				setFields['doubt.resolvedBy'] = authorName;
				setFields['doubt.resolvedAt'] = now;
			} else {
				setFields['doubt.resolvedBy'] = null;
				setFields['doubt.resolvedAt'] = null;
			}

			var historyEntry = {
				from: point.doubt.status,
				to: targetStatus,
				changedBy: authorName,
				reason: reason,
				changedAt: now
			};

			points.findAndModify(
				{ _id: pointId },
				[],
				{
					$set: setFields,
					$push: { 'doubt.statusHistory': historyEntry }
				},
				{ new: true, fields: { doubt: 1, campaign: 1 } },
				async function (err, result) {
					if (err) {
						if (logger) {
							await logger.error('Erro ao resolver dúvida', {
								module: 'doubts',
								function: 'resolveAdmin',
								metadata: { pointId: pointId, error: err.message }
							});
						}
						return response.status(500).json({ error: 'Erro ao resolver dúvida' });
					}
					if (!result || !result.value) {
						return response.status(404).json({ error: 'Ponto não encontrado' });
					}

					if (logger) {
						await logger.info('Dúvida transicionada por admin', {
							module: 'doubts',
							function: 'resolveAdmin',
							metadata: {
								pointId: pointId,
								from: point.doubt.status,
								to: targetStatus,
								changedBy: authorName
							}
						});
					}

					response.json({ success: true, doubt: result.value.doubt });

					// Notificação Telegram (fire-and-forget)
					if (app.services.telegramNotifier) {
						app.services.telegramNotifier.enqueue('DOUBT_RESOLVED', {
							pointId: pointId,
							campaignId: String(result.value.campaign || ''),
							author: authorName,
							fromStatus: point.doubt.status,
							toStatus: targetStatus,
							reason: reason
						}).catch(function () {});
					}
				}
			);
		});
	};

	return Doubts;
};
