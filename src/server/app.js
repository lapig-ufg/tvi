var express = require('express')
, load = require('express-load')
, path = require('path')
, util    = require('util')
, compression = require('compression')
, requestTimeout = require('express-timeout')
, responseTime = require('response-time')
, buffer = require('buffer')
, events = require('events')
, archiver = require('archiver')
, fs    = require('fs')
, mime = require('mime')
, async = require('async')
, timeout = require('connect-timeout')
, bodyParser = require('body-parser')
, multer = require('multer')
, session = require('express-session')

var app = express();

var parseCookie = require('cookie-parser');
var http = require('http').Server(app);
var io = require('socket.io')(http);
var cookie = parseCookie('LAPIG')

var store = new session.MemoryStore()
var KEY ="cookie"
load('config.js', {'verbose': false})
.then('libs')
.then('middleware')
.into(app);

app.middleware.repository.init(function() {

	
	app.repository = app.middleware.repository;

	app.use(cookie);
	var middlewareSession = session({ store: store,
										secret: 'LAPIG',
										resave: false, 
										saveUninitialized: true, 
										key: 'sid' })

	io.use(function(socket, next){
		middlewareSession(socket.request, socket.request.res, next)
	})
	
	app.use(middlewareSession);
	app.use(compression());
	app.use(express.static(app.config.clientDir));
	app.set('views', __dirname + '/templates');
	app.set('view engine', 'ejs');

	var publicDir = path.join(__dirname, '');

	app.use(requestTimeout({
		'timeout': 1000 * 60 * 30,
		'callback': function(err, options) {
			var response = options.res;
			if (err) {
				util.log('Timeout: ' + err);
			}
			response.end();
		}
	}));

	app.use(responseTime());
	app.use(bodyParser.json());
	app.use(bodyParser.urlencoded({ extended: true }));
	app.use(multer());



	io.on('connection', function(socket){
		console.log('Socket open');
		socket.on('disconnect', function(){
			store.get(socket.request.sessionID, function(error, session) {
				socket.request.session = session;
				console.log('socket close');
				app.emit('socket-disconnect', socket);
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

	http.listen(app.config.port, function() {
		console.log('LAPIG-MAPS Server @ [port %s] [pid %s]', app.config.port, process.pid.toString());
	});

});

process.on('uncaughtException', function (err) {
	console.error(err.stack);
});
