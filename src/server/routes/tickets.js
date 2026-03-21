var multer = require('multer');

// Multer 0.1.x: usa inMemory para manter arquivo em buffer (sem gravar em disco)
var uploadMiddleware = multer({
  inMemory: true,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

module.exports = function (app) {

  var tickets = app.controllers.tickets;

  /**
   * @swagger
   * /service/tickets:
   *   get:
   *     summary: Listar tickets com filtros e paginação
   *     tags: [Tickets]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [RECLAMACAO, SUGESTAO, DUVIDA, ELOGIO]
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [ABERTO, EM_ANALISE, EM_DESENVOLVIMENTO, RESOLVIDO, FECHADO]
   *       - in: query
   *         name: category
   *         schema:
   *           type: string
   *           enum: [INTERFACE, DESEMPENHO, FUNCIONALIDADE, DADOS, OUTRO]
   *       - in: query
   *         name: origin
   *         schema:
   *           type: string
   *           enum: [TVI, PLUGIN_FGI]
   *       - in: query
   *         name: mine
   *         schema:
   *           type: string
   *           enum: ['true', 'false']
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 10
   *     responses:
   *       200:
   *         description: Lista de tickets paginada
   *       401:
   *         description: Não autenticado
   */
  app.get('/service/tickets', tickets.list);

  /**
   * @swagger
   * /service/tickets/stats/summary:
   *   get:
   *     summary: Estatísticas resumidas de tickets (somente admin)
   *     tags: [Tickets]
   *     security:
   *       - sessionAuth: []
   *     responses:
   *       200:
   *         description: Estatísticas resumidas
   *       403:
   *         description: Acesso negado
   */
  app.get('/service/tickets/stats/summary', tickets.statsSummary);

  /**
   * @swagger
   * /service/tickets/stats/dashboard:
   *   get:
   *     summary: Dados de dashboard com gráficos (somente admin)
   *     tags: [Tickets]
   *     security:
   *       - sessionAuth: []
   *     responses:
   *       200:
   *         description: Dados para gráficos do dashboard
   *       403:
   *         description: Acesso negado
   */
  app.get('/service/tickets/stats/dashboard', tickets.statsDashboard);

  /**
   * @swagger
   * /service/tickets/{id}:
   *   get:
   *     summary: Detalhe de um ticket
   *     tags: [Tickets]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Ticket encontrado
   *       404:
   *         description: Ticket não encontrado
   */
  app.get('/service/tickets/:id', tickets.getById);

  /**
   * @swagger
   * /service/tickets:
   *   post:
   *     summary: Criar novo ticket
   *     tags: [Tickets]
   *     security:
   *       - sessionAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [title, description, type, category]
   *             properties:
   *               title:
   *                 type: string
   *                 maxLength: 200
   *               description:
   *                 type: string
   *               type:
   *                 type: string
   *                 enum: [RECLAMACAO, SUGESTAO, DUVIDA, ELOGIO]
   *               category:
   *                 type: string
   *                 enum: [INTERFACE, DESEMPENHO, FUNCIONALIDADE, DADOS, OUTRO]
   *               severity:
   *                 type: string
   *                 enum: [BAIXA, MEDIA, ALTA, CRITICA]
   *               origin:
   *                 type: string
   *                 enum: [TVI, PLUGIN_FGI]
   *                 default: TVI
   *     responses:
   *       201:
   *         description: Ticket criado
   *       400:
   *         description: Dados inválidos
   *       401:
   *         description: Não autenticado
   */
  app.post('/service/tickets', tickets.create);

  /**
   * @swagger
   * /service/tickets/{id}:
   *   put:
   *     summary: Editar ticket (somente se ABERTO, pelo autor ou admin)
   *     tags: [Tickets]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               title:
   *                 type: string
   *               description:
   *                 type: string
   *               type:
   *                 type: string
   *               category:
   *                 type: string
   *               severity:
   *                 type: string
   *     responses:
   *       200:
   *         description: Ticket atualizado
   *       400:
   *         description: Dados inválidos ou ticket não editável
   *       403:
   *         description: Sem permissão
   *       404:
   *         description: Ticket não encontrado
   */
  app.put('/service/tickets/:id', tickets.update);

  /**
   * @swagger
   * /service/tickets/{id}/status:
   *   patch:
   *     summary: Alterar status do ticket (somente admin)
   *     tags: [Tickets]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [status, reason]
   *             properties:
   *               status:
   *                 type: string
   *                 enum: [ABERTO, EM_ANALISE, EM_DESENVOLVIMENTO, RESOLVIDO, FECHADO]
   *               reason:
   *                 type: string
   *     responses:
   *       200:
   *         description: Status alterado
   *       400:
   *         description: Transição inválida
   *       403:
   *         description: Acesso negado
   */
  app.patch('/service/tickets/:id/status', tickets.changeStatus);

  /**
   * @swagger
   * /service/tickets/{id}/comments:
   *   post:
   *     summary: Adicionar comentário ao ticket
   *     tags: [Tickets]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [text]
   *             properties:
   *               text:
   *                 type: string
   *               isInternal:
   *                 type: boolean
   *                 default: false
   *     responses:
   *       200:
   *         description: Comentário adicionado
   *       400:
   *         description: Dados inválidos
   *       404:
   *         description: Ticket não encontrado
   */
  app.post('/service/tickets/:id/comments', tickets.addComment);

  /**
   * @swagger
   * /service/tickets/{id}/vote:
   *   post:
   *     summary: Toggle voto no ticket
   *     tags: [Tickets]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Voto registrado/removido
   *       401:
   *         description: Não autenticado
   *       404:
   *         description: Ticket não encontrado
   */
  app.post('/service/tickets/:id/vote', tickets.toggleVote);

  /**
   * @swagger
   * /service/tickets/{id}/attachments:
   *   post:
   *     summary: Upload de imagem ao ticket (PNG/JPG, max 10MB)
   *     tags: [Tickets]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *     responses:
   *       201:
   *         description: Imagem anexada
   *       400:
   *         description: Arquivo inválido
   *       404:
   *         description: Ticket não encontrado
   */
  app.post('/service/tickets/:id/attachments', uploadMiddleware, tickets.uploadAttachment);

  /**
   * @swagger
   * /service/tickets/{id}/attachments/{attachId}:
   *   get:
   *     summary: Servir imagem anexada (descompactada)
   *     tags: [Tickets]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: attachId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Imagem
   *         content:
   *           image/png: {}
   *           image/jpeg: {}
   *       404:
   *         description: Anexo não encontrado
   */
  app.get('/service/tickets/:id/attachments/:attachId', tickets.getAttachment);

  /**
   * @swagger
   * /service/tickets/{id}/attachments/{attachId}:
   *   delete:
   *     summary: Remover anexo (somente admin)
   *     tags: [Tickets]
   *     security:
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: attachId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Anexo removido
   *       403:
   *         description: Acesso negado
   */
  app.delete('/service/tickets/:id/attachments/:attachId', tickets.deleteAttachment);

};
