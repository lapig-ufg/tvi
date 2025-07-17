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
const io = require('socket.io')(http);
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
				sameSite: 'strict', // proteção CSRF
				rolling: true // renovar tempo a cada requisição
			}
		})

		app.use(middlewareSession);

		io.use(sharedsession(middlewareSession, {
			autoSave:true
		}));

		app.use(compression());
		app.use(express.static(app.config.clientDir));
		app.set('views', __dirname + '/templates');
		app.set('view engine', 'ejs');

		app.use(responseTime());
		
		// Enhanced body parser configuration for production
		const jsonParser = bodyParser.json({ 
			limit: '100mb',
			verify: function(req, res, buf, encoding) {
				// Log large requests in production for debugging
				if (process.env.NODE_ENV === 'prod' && buf.length > 1000000) {
					console.log(`[PROD] Large JSON request: ${buf.length} bytes on ${req.url}`);
				}
			}
		});
		
		const urlencodedParser = bodyParser.urlencoded({ 
			extended: true, 
			limit: '100mb' 
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
		console.log(`[${process.env.NODE_ENV || 'dev'}] Body parser configured with 100MB limit`);
		console.log(`[${process.env.NODE_ENV || 'dev'}] Multer disabled globally - use route-specific middleware for file uploads`);

		// Tornar io disponível para outros modules
		app.io = io;

		io.on('connection', function(socket){
			// Cliente conectado via socket
			
			// Join em salas específicas
			socket.on('join', function(room) {
				socket.join(room);
				// Socket entrou na sala
			});
			
			// Join na sala de cache para receber atualizações
			socket.join('cache-updates');
			
			socket.on('disconnect', function(){
				// Cliente desconectado
				// Remover lógica de sessão que pode estar causando o erro
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

		[`exit`, `uncaughtException`].forEach((event) => {
			if (event === 'uncaughtException') {
				process.on(event, (e) => { 
					console.error('Uncaught Exception:', e);
				})
			} else {
				process.on(event, (e) => {
					httpServer.close(() => process.exit())
				})
			}
		})
	});
});


