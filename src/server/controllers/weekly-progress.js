/**
 * TKT-000009 — Cálculo e persistência do progresso semanal por intérprete.
 *
 * Modelo da coleção `weekly_progress`:
 *   {
 *     _id: "<userName>__<campaign>__<ISOstart>",
 *     userName, campaign,
 *     weekStart, weekEnd,
 *     targetBase, targetEffective,
 *     completed, carryOut,
 *     closed, closedAt,
 *     goalReachedAt (opcional)
 *   }
 *
 * A função `sync` é idempotente e determinística: pode ser chamada em qualquer
 * requisição do intérprete (custo proporcional ao número de semanas ainda abertas,
 * que em regime estável é 1).
 */

'use strict';

var weeklyBucket = require('../services/weeklyBucket');

module.exports = function (app) {
	var WeeklyProgress = {};
	var logger = app.services.logger;
	var usersCol = app.repository.collections.users;
	var campaignCol = app.repository.collections.campaign;
	var pointsCol = app.repository.collections.points;
	var progressCol = app.repository.collections.weekly_progress;

	function findUser(userName) {
		return new Promise(function (resolve) {
			usersCol.findOne({ username: userName }, function (err, doc) {
				resolve(err ? null : doc);
			});
		});
	}

	function findCampaign(campaignId) {
		return new Promise(function (resolve) {
			campaignCol.findOne({ _id: campaignId }, function (err, doc) {
				resolve(err ? null : doc);
			});
		});
	}

	function getGoal(userDoc, campaignId) {
		if (!userDoc || !userDoc.goals || !userDoc.goals[campaignId]) return 0;
		var v = parseInt(userDoc.goals[campaignId].weeklyTarget, 10);
		return Number.isInteger(v) && v >= 0 ? v : 0;
	}

	/**
	 * Conta inspeções realizadas por `userName` na campanha, cujo `fillDate`
	 * caia na janela `[start, end)`. Usa projection mínima e iteração em memória
	 * (consistente com o estilo já usado em `meanTime`/`agreement`).
	 */
	function countInspections(campaignId, userName, start, end) {
		return new Promise(function (resolve) {
			pointsCol.find(
				{
					campaign: campaignId,
					userName: userName,
					'inspection.fillDate': { $gte: start, $lt: end }
				},
				{ userName: 1, inspection: 1 }
			).toArray(function (err, docs) {
				if (err) return resolve(0);
				var total = 0;
				(docs || []).forEach(function (doc) {
					if (!Array.isArray(doc.userName) || !Array.isArray(doc.inspection)) return;
					for (var i = 0; i < doc.userName.length; i++) {
						if (doc.userName[i] !== userName) continue;
						var insp = doc.inspection[i];
						if (!insp || !insp.fillDate) continue;
						var t = insp.fillDate instanceof Date ? insp.fillDate.getTime() : new Date(insp.fillDate).getTime();
						if (t >= start.getTime() && t < end.getTime()) total++;
					}
				});
				resolve(total);
			});
		});
	}

	function upsertProgress(doc) {
		return new Promise(function (resolve) {
			progressCol.updateOne(
				{ _id: doc._id },
				{ $set: doc },
				{ upsert: true },
				function (err) { resolve(!err); }
			);
		});
	}

	function findProgress(id) {
		return new Promise(function (resolve) {
			progressCol.findOne({ _id: id }, function (err, d) { resolve(err ? null : d); });
		});
	}

	function findLastClosed(userName, campaignId, beforeStart) {
		return new Promise(function (resolve) {
			progressCol.find({
				userName: userName,
				campaign: campaignId,
				closed: true,
				weekEnd: { $lte: beforeStart }
			})
			.sort({ weekEnd: -1 })
			.limit(1)
			.toArray(function (err, docs) {
				resolve((docs && docs[0]) || null);
			});
		});
	}

	/**
	 * Calcula e persiste o progresso da semana corrente de `userName` em `campaignId`,
	 * fechando eventuais semanas vencidas e propagando `carryOut`.
	 */
	WeeklyProgress.sync = async function (userName, campaignId) {
		if (!progressCol) {
			return { error: 'weekly_progress collection not available' };
		}
		var user = await findUser(userName);
		var campaign = await findCampaign(campaignId);
		if (!campaign) return { error: 'Campaign not found' };

		var cfg = weeklyBucket.normalizeConfig(campaign.weeklyGoalConfig);
		var targetBase = getGoal(user, campaignId);
		var now = new Date();
		var currentBounds = weeklyBucket.getWeekBounds(now, cfg);
		var previousEnd = currentBounds.start;

		// 1. Fechar todas as semanas abertas cujo weekEnd já passou.
		var openDocs = await new Promise(function (resolve) {
			progressCol.find({
				userName: userName,
				campaign: campaignId,
				closed: false,
				weekEnd: { $lte: previousEnd }
			}).sort({ weekStart: 1 }).toArray(function (err, docs) {
				resolve(docs || []);
			});
		});

		for (var i = 0; i < openDocs.length; i++) {
			var od = openDocs[i];
			var completed = await countInspections(campaignId, userName, od.weekStart, od.weekEnd);
			var targetEffective = od.targetEffective || od.targetBase || 0;
			var carryOut = Math.max(0, targetEffective - completed);
			await upsertProgress({
				_id: od._id,
				userName: userName,
				campaign: campaignId,
				weekStart: od.weekStart,
				weekEnd: od.weekEnd,
				targetBase: od.targetBase,
				targetEffective: targetEffective,
				completed: completed,
				carryOut: carryOut,
				closed: true,
				closedAt: new Date(),
				goalReachedAt: od.goalReachedAt || (completed >= targetEffective ? new Date() : null)
			});
		}

		// 2. Derivar carry-over total a partir da última semana fechada imediatamente anterior.
		var lastClosed = await findLastClosed(userName, campaignId, currentBounds.start);
		var carryOverIn = lastClosed ? (lastClosed.carryOut || 0) : 0;

		// Cap para evitar carry-over infinito em caso de inatividade prolongada.
		var maxCarry = cfg.maxCarryOverWeeks;
		if (Number.isInteger(maxCarry) && maxCarry > 0 && targetBase > 0) {
			carryOverIn = Math.min(carryOverIn, targetBase * maxCarry);
		}

		var targetEffectiveCurrent = targetBase + carryOverIn;

		// 3. Upsert da semana atual.
		var currentId = weeklyBucket.buildWeekKey(userName, campaignId, currentBounds.start);
		var currentDoc = await findProgress(currentId);
		var completedNow = await countInspections(campaignId, userName, currentBounds.start, currentBounds.end);

		var goalReachedAt = currentDoc && currentDoc.goalReachedAt ? currentDoc.goalReachedAt : null;
		if (!goalReachedAt && targetEffectiveCurrent > 0 && completedNow >= targetEffectiveCurrent) {
			goalReachedAt = new Date();
		}

		var persisted = {
			_id: currentId,
			userName: userName,
			campaign: campaignId,
			weekStart: currentBounds.start,
			weekEnd: currentBounds.end,
			targetBase: targetBase,
			targetEffective: targetEffectiveCurrent,
			completed: completedNow,
			carryOut: Math.max(0, targetEffectiveCurrent - completedNow),
			closed: false,
			goalReachedAt: goalReachedAt
		};
		await upsertProgress(persisted);

		var percent = targetEffectiveCurrent > 0 ? Math.round((completedNow / targetEffectiveCurrent) * 100) : 0;
		if (percent > 100) percent = 100;

		return {
			campaign: campaignId,
			userName: userName,
			weekStart: currentBounds.start.toISOString(),
			weekEnd: currentBounds.end.toISOString(),
			targetBase: targetBase,
			carryOverIn: carryOverIn,
			targetEffective: targetEffectiveCurrent,
			completed: completedNow,
			remaining: Math.max(0, targetEffectiveCurrent - completedNow),
			percent: percent,
			goalReached: !!goalReachedAt,
			achievedAt: goalReachedAt ? new Date(goalReachedAt).toISOString() : null,
			weeklyGoalConfig: cfg
		};
	};

	/**
	 * GET /service/me/weekly-progress — consumo pelo intérprete autenticado.
	 */
	WeeklyProgress.me = async function (req, res) {
		try {
			if (!req.session || !req.session.user || !req.session.user.name || !req.session.user.campaign) {
				return res.status(401).json({ error: 'Sessão inválida' });
			}
			var userName = req.session.user.name;
			var campaignId = req.session.user.campaign._id;
			var result = await WeeklyProgress.sync(userName, campaignId);
			if (result && result.error) {
				return res.status(500).json({ error: result.error });
			}
			res.json(result);
		} catch (e) {
			if (logger) await logger.error('weekly-progress.me failed', { module: 'weekly-progress', metadata: { error: e.message } });
			res.status(500).json({ error: 'Erro interno' });
		}
	};

	/**
	 * GET /api/admin/campaigns/:id/monitoring/weekly-progress
	 * Lista histórico semanal por intérprete (admin).
	 */
	WeeklyProgress.history = async function (req, res) {
		try {
			var campaignId = req.params.id;
			var filterUser = req.query.userName || null;
			var limit = Math.max(1, Math.min(52, parseInt(req.query.limit || '8', 10)));

			var query = { campaign: campaignId };
			if (filterUser) query.userName = filterUser;

			progressCol.find(query)
				.sort({ weekStart: -1 })
				.limit(filterUser ? limit : limit * 20)
				.toArray(function (err, docs) {
					if (err) return res.status(500).json({ error: 'Erro de banco de dados' });
					res.json(docs || []);
				});
		} catch (e) {
			res.status(500).json({ error: 'Erro interno' });
		}
	};

	return WeeklyProgress;
};
