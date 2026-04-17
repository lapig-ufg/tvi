/*
 * Rotas: doubts
 *
 * Registra as rotas da subestrutura `doubt` em pontos da campanha:
 *  - intérprete: /service/points/:pointId/doubt (sessão de usuário)
 *  - super-admin: /api/campaigns/:id/doubts* e /api/points/:pointId/doubt/resolve
 *
 * O padrão de autenticação para rotas administrativas espelha o middleware
 * `requireSuperAdmin` presente em `routes/campaignCrud.js`.
 */
module.exports = function (app) {

	var doubts = app.controllers.doubts;
	var logger = app.services && app.services.logger;

	if (logger) {
		logger.info('Loading doubts routes', {
			module: 'routes',
			function: 'doubts'
		});
	}

	// Middleware local de super-admin (cópia mínima do padrão usado em
	// routes/campaignCrud.js para evitar acoplamento entre arquivos de rota).
	var requireSuperAdmin = function (req, res, next) {
		if (req.session && req.session.admin && req.session.admin.superAdmin) {
			return next();
		}
		return res.status(401).json({ error: 'Super admin authentication required' });
	};

	// -------------------------
	// Rotas do intérprete
	// -------------------------
	/**
	 * @swagger
	 * /service/points/{pointId}/doubt:
	 *   post:
	 *     summary: Registra (ou reabre) uma dúvida sobre o ponto
	 *     tags: [Points - Doubts]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: path
	 *         name: pointId
	 *         required: true
	 *         schema: { type: string }
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             required: [text]
	 *             properties:
	 *               text: { type: string, minLength: 5, maxLength: 2000 }
	 *               year: { type: integer }
	 *     responses:
	 *       201: { description: Comentário adicionado }
	 *       400: { description: Entrada inválida }
	 *       401: { description: Não autenticado }
	 *       403: { description: Acesso negado (campanha/inspetor) }
	 *       404: { description: Ponto não encontrado }
	 */
	app.post('/service/points/:pointId/doubt', doubts.addInspectorComment);

	/**
	 * @swagger
	 * /service/points/{pointId}/doubt:
	 *   get:
	 *     summary: Retorna a dúvida do ponto (autor ou admin)
	 *     tags: [Points - Doubts]
	 *     security:
	 *       - sessionAuth: []
	 */
	app.get('/service/points/:pointId/doubt', doubts.getDoubt);

	// -------------------------
	// Rotas do super-admin
	// -------------------------
	/**
	 * @swagger
	 * /api/campaigns/{id}/doubts:
	 *   get:
	 *     summary: Lista pontos com dúvida na campanha
	 *     tags: [Points - Doubts]
	 *     security:
	 *       - sessionAuth: []
	 *     parameters:
	 *       - in: path
	 *         name: id
	 *         required: true
	 *         schema: { type: string }
	 *       - in: query
	 *         name: status
	 *         schema: { type: string, enum: [ABERTA, RESOLVIDA, ALL], default: ABERTA }
	 *       - in: query
	 *         name: user
	 *         schema: { type: string }
	 *       - in: query
	 *         name: page
	 *         schema: { type: integer, default: 1 }
	 *       - in: query
	 *         name: limit
	 *         schema: { type: integer, default: 25, maximum: 200 }
	 */
	app.get('/api/campaigns/:id/doubts', requireSuperAdmin, doubts.listAdmin);

	/**
	 * @swagger
	 * /api/campaigns/{id}/doubts/summary:
	 *   get:
	 *     summary: Resumo agregado (open/resolved/total) das dúvidas da campanha
	 *     tags: [Points - Doubts]
	 *     security:
	 *       - sessionAuth: []
	 */
	app.get('/api/campaigns/:id/doubts/summary', requireSuperAdmin, doubts.summaryAdmin);

	/**
	 * @swagger
	 * /api/campaigns/{id}/points/{pointId}/doubt/comments:
	 *   post:
	 *     summary: Super-admin adiciona comentário à dúvida
	 *     tags: [Points - Doubts]
	 *     security:
	 *       - sessionAuth: []
	 */
	app.post('/api/campaigns/:id/points/:pointId/doubt/comments', requireSuperAdmin, doubts.addAdminComment);

	/**
	 * @swagger
	 * /api/points/{pointId}/doubt/resolve:
	 *   put:
	 *     summary: Transiciona o status da dúvida (ABERTA ↔ RESOLVIDA)
	 *     tags: [Points - Doubts]
	 *     security:
	 *       - sessionAuth: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             required: [status, reason]
	 *             properties:
	 *               status: { type: string, enum: [ABERTA, RESOLVIDA] }
	 *               reason: { type: string }
	 */
	app.put('/api/points/:pointId/doubt/resolve', requireSuperAdmin, doubts.resolveAdmin);
};
