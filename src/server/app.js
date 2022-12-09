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
		app.use(bodyParser.json());
		app.use(bodyParser.urlencoded({ extended: true }));
		app.use(multer());

		io.on('connection', function(socket){
			socket.on('disconnect', function(){
				store.get(socket.handshake.sessionID, function(error, session) {
					app.emit('socket-disconnect', session);
				});
			})
		})

		app.use(function(error, request, response, next) {
			console.log('ServerError: ', error.stack);
			next();
		});

		load('models', {'verbose': false})
			.then('controllers')
			.then('routes')
			.into(app);


		const httpServer = http.listen(app.config.port, function () {
			console.log('%s Server @ [port %s] [pid %s]', 'TVI Server', app.config.port, process.pid.toString());
		});

		httpServer.setTimeout(1000 * 60 * 240);

		[`exit`, `uncaughtException`].forEach((event) => {
			if (event === 'uncaughtException') {
				process.on(event, (e) => { })
			} else {
				process.on(event, (e) => {
					httpServer.close(() => process.exit())
				})
			}
		})
	});
});


