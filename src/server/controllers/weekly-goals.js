/**
 * TKT-000009 — CRUD de metas semanais por intérprete.
 *
 * Metas são armazenadas em `users.goals[<campaignId>]` no documento do intérprete,
 * conforme proposta da análise (uma meta por par `(inspector, campaign)`).
 * Esse controller expõe APIs admin para cadastrar/listar/remover metas.
 */

'use strict';

module.exports = function (app) {
	var WeeklyGoals = {};
	var logger = app.services.logger;
	var users = app.repository.collections.users;

	function getEditor(req) {
		if (req.session && req.session.admin && req.session.admin.superAdmin) {
			return req.session.admin.superAdmin.username || 'admin';
		}
		return null;
	}

	/**
	 * GET /api/admin/campaigns/:campaignId/weekly-goals
	 * Lista metas para todos os intérpretes com meta cadastrada na campanha.
	 */
	WeeklyGoals.list = async function (req, res) {
		try {
			var campaignId = req.params.campaignId;
			var goalField = 'goals.' + campaignId;
			var query = {};
			query[goalField] = { $exists: true };
			var projection = { username: 1, name: 1 };
			projection[goalField] = 1;

			users.find(query, projection).toArray(function (err, docs) {
				if (err) return res.status(500).json({ error: 'Erro ao listar metas' });
				var result = (docs || []).map(function (u) {
					var goal = (u.goals && u.goals[campaignId]) || {};
					return {
						userName: u.username || u.name,
						weeklyTarget: goal.weeklyTarget || 0,
						createdAt: goal.createdAt,
						updatedAt: goal.updatedAt,
						updatedBy: goal.updatedBy
					};
				});
				res.json(result);
			});
		} catch (e) {
			await logger.error('weekly-goals.list failed', { module: 'weekly-goals', metadata: { error: e.message } });
			res.status(500).json({ error: 'Erro interno' });
		}
	};

	/**
	 * PUT /api/admin/campaigns/:campaignId/weekly-goals/:userName
	 * Cria/atualiza a meta semanal do intérprete para a campanha.
	 */
	WeeklyGoals.upsert = async function (req, res) {
		try {
			var campaignId = req.params.campaignId;
			var userName = req.params.userName;
			var target = parseInt(req.body.weeklyTarget, 10);

			if (!userName) return res.status(400).json({ error: 'userName é obrigatório' });
			if (!Number.isInteger(target) || target < 0) {
				return res.status(400).json({ error: 'weeklyTarget deve ser um inteiro ≥ 0' });
			}

			var now = new Date();
			var editor = getEditor(req);
			var goalPath = 'goals.' + campaignId;
			var setDoc = {};
			setDoc[goalPath + '.weeklyTarget'] = target;
			setDoc[goalPath + '.updatedAt'] = now;
			setDoc[goalPath + '.updatedBy'] = editor;

			// Usa `username` como identidade canônica (índice único já existe).
			users.findOne({ username: userName }, function (errU, userDoc) {
				if (errU) return res.status(500).json({ error: 'Erro de banco de dados' });
				var existing = userDoc && userDoc.goals && userDoc.goals[campaignId];
				if (!existing) {
					setDoc[goalPath + '.createdAt'] = now;
				}
				users.updateOne(
					{ username: userName },
					{ $set: setDoc },
					{ upsert: false },
					function (errUpd, result) {
						if (errUpd) return res.status(500).json({ error: 'Erro ao salvar meta' });
						if (!result || (result.matchedCount === 0 && result.result && result.result.n === 0)) {
							return res.status(404).json({ error: 'Intérprete não encontrado' });
						}
						res.json({ userName: userName, weeklyTarget: target, updatedAt: now, updatedBy: editor });
					}
				);
			});
		} catch (e) {
			await logger.error('weekly-goals.upsert failed', { module: 'weekly-goals', metadata: { error: e.message } });
			res.status(500).json({ error: 'Erro interno' });
		}
	};

	/**
	 * DELETE /api/admin/campaigns/:campaignId/weekly-goals/:userName
	 */
	WeeklyGoals.remove = async function (req, res) {
		try {
			var campaignId = req.params.campaignId;
			var userName = req.params.userName;
			var unsetDoc = {};
			unsetDoc['goals.' + campaignId] = '';
			users.updateOne({ username: userName }, { $unset: unsetDoc }, function (err) {
				if (err) return res.status(500).json({ error: 'Erro ao remover meta' });
				res.status(204).end();
			});
		} catch (e) {
			res.status(500).json({ error: 'Erro interno' });
		}
	};

	return WeeklyGoals;
};
