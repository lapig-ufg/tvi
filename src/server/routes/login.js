module.exports = function (app) {

	var login = app.controllers.login;
	
	/**
	 * @swagger
	 * /service/login:
	 *   post:
	 *     summary: User login
	 *     tags: [Authentication]
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             required:
	 *               - username
	 *               - password
	 *             properties:
	 *               username:
	 *                 type: string
	 *                 description: User's username
	 *               password:
	 *                 type: string
	 *                 format: password
	 *                 description: User's password
	 *     responses:
	 *       200:
	 *         description: Login successful
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 success:
	 *                   type: boolean
	 *                 user:
	 *                   type: object
	 *                   properties:
	 *                     _id:
	 *                       type: string
	 *                     name:
	 *                       type: string
	 *                     type:
	 *                       type: string
	 *                       enum: [inspector, supervisor, admin]
	 *                     email:
	 *                       type: string
	 *       401:
	 *         description: Invalid credentials
	 *       500:
	 *         description: Server error
	 */
	app.post('/service/login', login.enterTvi);
	
	/**
	 * @swagger
	 * /service/login/user:
	 *   get:
	 *     summary: Get current logged user information
	 *     tags: [Authentication]
	 *     security:
	 *       - sessionAuth: []
	 *     responses:
	 *       200:
	 *         description: User information
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 _id:
	 *                   type: string
	 *                 name:
	 *                   type: string
	 *                 type:
	 *                   type: string
	 *                   enum: [inspector, supervisor, admin]
	 *                 email:
	 *                   type: string
	 *                 campaign:
	 *                   type: string
	 *       401:
	 *         description: Not authenticated
	 */
	app.get('/service/login/user', login.getUser);
	
	/**
	 * @swagger
	 * /service/login/logoff:
	 *   get:
	 *     summary: Logout current user
	 *     tags: [Authentication]
	 *     security:
	 *       - sessionAuth: []
	 *     responses:
	 *       200:
	 *         description: Logout successful
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 success:
	 *                   type: boolean
	 *                 message:
	 *                   type: string
	 *       500:
	 *         description: Server error
	 */
	app.get('/service/login/logoff', login.logoff);

}
