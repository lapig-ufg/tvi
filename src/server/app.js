// require('newrelic');
const express = require('express')
, load = require('express-load')
, path = require('path')
, compression = require('compression')
, responseTime = require('response-time')
, bodyParser = require('body-parser')
, multer = require('multer')
, session = require('express-session')
, parseCookie = require('cookie-parser');

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
	transports: ['websocket']
});
const MongoStore = require('connect-mongo')(session);
const cookie = parseCookie('LAPIG')
const mongoAdapter = require('socket.io-adapter-mongo');
const sharedsession = require("express-socket.io-session");

load('config.js', {'verbose': false})
.then('libs')
.then('middleware')
.then('services')
.into(app);

app.middleware.repository.init(() => {
	app.middleware.repository.initTimeseriesDb(() => {
		const mongodbUrl = 'mongodb://' + app.config.mongo.host + ':' + app.config.mongo.port + '/' + app.config.mongo.dbname;
		app.repository = app.middleware.repository;
		
		// Inicializar o logger após o repository estar pronto
		if (app.services && app.services.logger) {
			// Se o logger já foi carregado pelo express-load mas não foi inicializado
			if (typeof app.services.logger === 'function') {
				app.services.logger = app.services.logger(app);
			}
			// Garantir que o logger seja inicializado com o repository
			if (app.services.logger && !app.services.logger.logCollection && app.repository) {
				app.services.logger.app = app;
				app.services.logger.init();
			}
		}

		// Inicializar o notificador Telegram após o repository estar pronto
		if (app.services && app.services.telegramNotifier) {
			if (typeof app.services.telegramNotifier === 'function') {
				app.services.telegramNotifier = app.services.telegramNotifier(app);
			}
			if (app.services.telegramNotifier && !app.services.telegramNotifier.initialized && app.repository) {
				app.services.telegramNotifier.app = app;
				app.services.telegramNotifier.init();
			}
		}

		const store = new MongoStore({ url: mongodbUrl });
		io.adapter(mongoAdapter( mongodbUrl ));

		app.use(cookie);
		const middlewareSession = session({
			store: store,
			secret: 'LAPIG',
			resave: false,
			saveUninitialized: true,
			key: 'sid',
			cookie: {
				maxAge: 1000 * 60 * 60 * 8, // 8 horas (exemplo)
				httpOnly: true, // previne acesso via JavaScript
				secure: process.env.NODE_ENV === 'production', // HTTPS em produção
				sameSite: 'lax', // permite cookies em navegação mas protege CSRF
				rolling: true // renovar tempo a cada requisição
			}
		})

		app.use(middlewareSession);

		io.use(sharedsession(middlewareSession, {
			autoSave:true
		}));
		
		// Configure CORS to allow credentials
		app.use(function(req, res, next) {
			// Allow requests from the same origin or localhost
			const origin = req.headers.origin;
			if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
				res.header('Access-Control-Allow-Origin', origin);
				res.header('Access-Control-Allow-Credentials', 'true');
				res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
				res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
			}
			
			if (req.method === 'OPTIONS') {
				return res.sendStatus(200);
			}
			next();
		});

		app.use(compression());
		app.use(express.static(app.config.clientDir));
		app.set('views', __dirname + '/templates');
		app.set('view engine', 'ejs');

		app.use(responseTime());
		
		// Enhanced body parser configuration for production
		const jsonParser = bodyParser.json({
			limit: '500mb',
			verify: function(req, res, buf, encoding) {
				// Log large requests in production for debugging
				if (process.env.NODE_ENV === 'prod' && buf.length > 1000000) {
					console.log(`[PROD] Large JSON request: ${buf.length} bytes on ${req.url}`);
				}
			}
		});
		
		const urlencodedParser = bodyParser.urlencoded({
			extended: true,
			limit: '500mb'
		});
		
		// Apply parsers with error handling
		app.use(function(req, res, next) {
			// Skip body parsing for multipart requests
			if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
				return next();
			}
			jsonParser(req, res, next);
		});
		
		app.use(urlencodedParser);
		
		// Log environment and parser status
		console.log(`[${process.env.NODE_ENV || 'dev'}] Body parser configured with 500MB limit`);
		console.log(`[${process.env.NODE_ENV || 'dev'}] Multer disabled globally - use route-specific middleware for file uploads`);

		// Tornar io disponível para outros modules
		app.io = io;

		io.on('connection', function(socket){
			// Join em salas específicas (com verificação de sessão para salas sensíveis)
			socket.on('join', function(room) {
				if (room === 'cache-updates') {
					// Sala de cache requer sessão admin ou super-admin
					var session = socket.handshake.session;
					var isAdmin = session && session.admin && session.admin.superAdmin;
					var isSupervisor = session && session.user && session.user.type === 'supervisor';
					if (!isAdmin && !isSupervisor) {
						return;  // Silenciosamente recusar
					}
				}
				socket.join(room);
			});

			socket.on('leave', function(room) {
				socket.leave(room);
			});

			socket.on('disconnect', function(){
				// Cleanup automático pelo Socket.IO
			});

			// Heartbeat para manter conexão viva
			socket.on('ping', function() {
				socket.emit('pong');
			});
		})

		// Carregar o middleware de erro
		const errorHandler = app.middleware.errorHandler;
		
		// Carregar o middleware de logging
		const logMiddleware = app.middleware.logMiddleware;
		
		// Aplicar o logger de requisições ANTES das rotas
		app.use(logMiddleware.requestLogger);
		
		// Aplicar timeout global de requisições (2 minutos por padrão)
		app.use(errorHandler.requestTimeout(120000));
		
		load('models', {'verbose': false})
			.then('controllers')
			.then('routes')
			.into(app);

		// Inicializar bridge WebSocket (Tiles API) → Socket.IO (Frontend)
		try {
			const { TilesCacheWebSocket } = require('./services/tilesCacheWebSocket');
			app.tilesCacheWs = new TilesCacheWebSocket(app);
			app.tilesCacheWs.start();
			console.log('[TilesCacheWS] Bridge WebSocket → Socket.IO inicializado');
		} catch (err) {
			console.error('[TilesCacheWS] Erro ao inicializar bridge:', err.message);
		}

		// Setup Swagger documentation
		const swaggerMiddleware = app.middleware.swagger;
		swaggerMiddleware.setup();
		
		// IMPORTANTE: Os handlers de erro devem vir DEPOIS das rotas
		// Handler específico para erros de upload
		app.use(errorHandler.uploadErrorHandler);
		
		// Handler global de erros com logging (deve ser o último middleware)
		app.use(logMiddleware.errorLogger);


		const httpServer = http.listen(app.config.port, function () {
			console.log('TVI Server started on port', app.config.port);
			if(process.env.PRIMARY_WORKER) {
				app.middleware.jobs.start();
			}
		});

		httpServer.setTimeout(1000 * 60 * 240);

		// Graceful shutdown — fechar WebSocket bridge e HTTP server
		function gracefulShutdown(signal) {
			console.log(`[Shutdown] Recebido ${signal}, encerrando...`);
			if (app.tilesCacheWs) {
				app.tilesCacheWs.stop();
			}
			httpServer.close(() => {
				console.log('[Shutdown] Servidor encerrado');
				process.exit(0);
			});
			// Forçar saída após 10s
			setTimeout(() => process.exit(1), 10000);
		}

		process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
		process.on('SIGINT', () => gracefulShutdown('SIGINT'));
		process.on('uncaughtException', (e) => {
			console.error('Uncaught Exception:', e);
		});
		process.on('exit', () => {
			if (app.tilesCacheWs) app.tilesCacheWs.stop();
		});
	});
});


