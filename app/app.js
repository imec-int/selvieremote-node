#!/usr/bin/env node

var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var WebSocket = require('ws');
var WebSocketServer = WebSocket.Server;
var fs = require('fs');
var _ = require('underscore');


var app = express();

app.set('port', process.env.PORT || 3001);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');


//app.use(favicon(__dirname + '/public/favicon.ico')); // uncomment after placing your favicon in /public
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(require('stylus').middleware(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));


app.get('/', function(req, res) {
	var connectedPhonesArray = [];
	for(var client_id in connectedPhones) {
		connectedPhonesArray.push(connectedPhones[client_id].phone);
	}


	res.render('index', { title: 'Selvie Remote', connectedPhones: connectedPhonesArray });
});






// catch 404 and forward to error handler
app.use(function (req, res, next) {
	var err = new Error('Not Found');
	err.status = 404;
	next(err);
});

// error handler:
app.use(function (err, req, res, next) {
	if(!err.status) err.status = 500;

	res.status(err.status);

	if(err.status == 404)
		return res.send(err.toString()); // 404 errors are not worth logging.

	if (app.get('env') === 'production'){
		console.log(err.stack); // log to console
		return res.send("An error occured: " + err.status); // don't log to user
	} else {
		next(err); // log to console and user
	}
});



var webserver = app.listen(app.get('port'), function() {
	console.log('Express server listening on port ' + webserver.address().port);
});

var connectedAdmins = {};
var connectedPhones = {};


var wss = new WebSocketServer({ server: webserver });

wss.on('connection', function connection(ws) {
	console.log('incoming websocket', ws.upgradeReq.url);

	switch(ws.upgradeReq.url) {
		case '/':
		somePhoneConnected(ws);
		break;

		case '/admin':
		adminConnected(ws);
		break;
	}
});

function somePhoneConnected (ws) {
	console.log('phone connected');

	ws.on('message', function (data) {
		try{
			data = JSON.parse(data);
			if(data.message == 'device_registration') {
				registeredPhoneConnected(data, ws);
			}
		}catch(err){}
	});
}

function registeredPhoneConnected(phone, ws) {
	console.log('phone registered:', phone.client_id);
	phone = extractPhoneData(phone); // get's extra data (device name) from phone data

	// save phone for when admin connects:
	connectedPhones[phone.client_id] = {
		phone: phone,
		ws: ws
	};

	// send new connected phone to admin interface
	sendToAdmin(phone);


	// listen for incoming message from that phone:
	ws.on('message', function (data) {
		console.log('incoming data from ' + phone.client_id + ': ', data);

		if(data instanceof Buffer) {
			console.log('incoming binary from ' + phone.client_id + ', assuming preview frame of video');
			var filenameURL = '/data/' + phone.client_id.replace(/:/g, '-') + '_' + Date.now() + '.jpg';
			var	filename = __dirname + '/public' + filenameURL;

			fs.writeFile(filename, data, function (err) {
				if(err) return console.log(err);
				console.log("JPG save. Accessible via " + filenameURL);


				// sending url to admin:
				sendToAdmin({
					message: 'preview_frame',
					url: filenameURL,
					client_id: phone.client_id
				});

			});

			return;
		}

		// sending all other message directly to admin:
		sendToAdmin(data);
	});

	ws.on('close', function (data) {
		console.log('phone socket closed');
		delete connectedPhones[phone.client_id];
		sendToAdmin({
			message: 'disconnect',
			client_id: phone.client_id
		});
	});
}

function adminConnected (ws) {
	// create random id for admin socket:
	var admin_id = Date.now();

	// save admin socket so it can be deleted from the connectedAdmins
	connectedAdmins[admin_id] = ws;

	console.log('admin connected (no of admins connected: ' + _.toArray(connectedAdmins).length + ')');


	ws.on('message', function (rawdata) {
		console.log('data from admin:', rawdata);

		// sending to phone:

		var data = JSON.parse(rawdata);

		var connectedPhone = connectedPhones[data.client_id];
		if(!connectedPhone) return console.log('Phone with client_id "' + data.client_id + '" not connected anymore.');

		console.log('sending rawdata from admin to phone ' + data.client_id);
		connectedPhone.ws.send(rawdata);
	});

	ws.on('close', function (data) {
		console.log('admin socket closed');
		delete connectedAdmins[admin_id];
	});
}

function sendToAdmin (message) {
	// convert message to string if it's an object:
	if(typeof message === 'object') {
		message = JSON.stringify(message);
	}

	// console.log('message to admin', message);

	for (var admin_id in connectedAdmins) {
		// if(connectedAdmins[i].readyState == WebSocket.OPEN)
		connectedAdmins[admin_id].send(message);
	}
}


function extractPhoneData (data) {
	var useragentData = data['user-agent'].split(';');

	var device = useragentData[1].trim();
	data.device = device;


	return data;
}

