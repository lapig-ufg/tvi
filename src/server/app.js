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
				maxAge: 1000 * 60 * 60 * 24
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

		const publicDir = path.join(__dirname, '');

		/*
        app.use(requestTimeout({
            'timeout': 1000 * 60 * 30,
            'callback': function(err, options) {
                var response = options.res;
                if (err) {
                    util.log('Timeout: ' + err);
                }
                response.end();
            }
        }));*/

		app.use(responseTime());
		app.use(bodyParser.json({ limit: '100mb' }));
		app.use(bodyParser.urlencoded({ extended: true, limit: '100mb' }));
		app.use(multer());

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

		app.use(function(error, request, response, next) {
			// Handle body parser errors (like payload too large)
			if (error.type === 'entity.too.large') {
				return response.status(413).json({
					error: 'Arquivo muito grande. Limite máximo: 100MB',
					type: 'PAYLOAD_TOO_LARGE'
				});
			}
			
			if (error.type === 'entity.parse.failed') {
				return response.status(400).json({
					error: 'Erro ao processar dados da requisição',
					type: 'PARSE_ERROR'
				});
			}
			
			// Other errors
			console.error('Server Error:', error);
			next();
		});

		load('models', {'verbose': false})
			.then('controllers')
			.then('routes')
			.into(app);


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


