var socket;
var path = require('path');
var fs = require('fs-extra');
var _ = require('underscore');
var CronJob = require('cron/cron').CronJob;

require('colors');

var disconnected;
var cron;
var UDPcron;

var init = function(){
 
  global.Avatar = Avatar;
 
  Avatar.Config = require('./config.js').init();
  Avatar.Listen = require('./listen.js');
  return Avatar;
}


var remote_callback = function (err, response, body){
  if (err || response.statusCode != 200) {
    warn("HTTP Error: ", err, response, body);
    return;
  }
};



var remote = function(qs, cb){
  var url = 'http://' + Config.http.remote.ip + ':' + Config.http.remote.port + '/';
  var querystring = require('querystring');
  url += '?' + querystring.stringify(qs);

  info('Remote: '+ url);

  var request = require('request');
  request({ 'url' : url }, cb || remote_callback);
};


// Ne prend pas en compte le speak si c'est un client mappé
// Pour le mot-déclencheur uniquement
// A faire dans la prochaine release
var speak = function(tts, cb, stopSpeak) {

	tts = tts.replace(/[\n]/gi, "" ).replace(/[\r]/gi, "" );	

	if (tts.indexOf('|') != -1) 
	  tts = tts.split('|')[Math.floor(Math.random() * tts.split('|').length)];

	if (Config.speech.server_speak && !stopSpeak) 
		return socket.emit('server_speak', tts, cb);
	
	var qs = { 'tts' : tts }; 
	if (cb) {
		qs.sync = true;
		
		unicode(tts) ? info("Speak remote: " + tts + " with callback") : info("Speak remote with callback");

		return remote(qs, function() { 
					setTimeout(function(){								
						cb();
					}, Config.speech.timeout);
				});
	}
	
	unicode(tts) ? info("Speak remote: " + tts + " no callback") : info("Speak remote no callback");
	remote(qs);

};



var restart = function () {
	
	if (cron) cron.stop();
	
	var d = new Date();
	var s = d.getMinutes()+Config.lost_connection.restart;
	d.setMinutes(s);
	
	cron = new CronJob(d, function(done) {	
		if (disconnected) {
			execRestart();		  
		}
	}, null, true);
	
}



var execRestart = function () {
	
	if(Config.speech.speechToText.toLowerCase() == 'chrome') {
		//restart chrome
		var qs = {'run': path.resolve(__dirname) + '/nircmd/nircmd', 
				  'runp': 'win activate ititle "chrome"'
				 };
		remote(qs, function() { 
			var qs = {'run': path.resolve(__dirname) + '/nircmd/nircmd', 
				  'runp': 'sendkeypress alt+F4'
			};
			setTimeout(function(){								
				remote(qs, function() { 
					//restart nodejs
					var qs = {
						'cmd': 'run', 
						'run': path.resolve(__dirname) + '/restart/Restart.vbs',
						'sync' : false
					};
					remote(qs);
				});
			}, 2000);
		});
	} else {
		//restart nodejs
		var qs = {
			'cmd': 'run', 
			'run': path.resolve(__dirname) + '/restart/Restart.vbs',
			'sync' : false
		};
		remote(qs);	
	}
}



var connect = function () {
	
	if ((Config.http.server.ip).length == 0) {
		// UDP Connect
		info('No Avatar server in property file. Network scanning...');
		UPDconnect();
	} else {
		info('Searching for Avatar Server. Network scanning...');
		UPDconnect(Config.http.server.ip, function () { 
			// HHTTP Connect
			HTTPconnect();
		});
	}
}


var UPDconnect = function (serverIP, callback) {
	
	var WifiIP = [];
	var scanIP = require('evilscan');
	
	var options = {
		target: ((serverIP && serverIP.toLowerCase() != 'localhost') ? serverIP : Config.udp.target),
		port: Config.http.server.port,
		status:'O' // Timeout, Refused, Open, Unreachable
	};

	var scanner = new scanIP(options);

	scanner.on('result',function(data) {
		WifiIP.push(data);
		//info(data);
	});

	scanner.on('error',function(err) {
		if (err && err.length > 0) 
		  error('Wifi scan error:', err.red); 
		else 
		  error('Wifi scan error'.red);
	});

	scanner.on('done',function() {
		
		if (WifiIP.length > 0) {
			if (!serverIP) {
				if (WifiIP.length > 1)
					info('More than one Avatar Server found on the network. Take the first one...');
				sendPingToServer(WifiIP[0]);
			} else {
				var found;
				for(s in WifiIP) {
					if (WifiIP[s].ip == serverIP) {
						callback();
						found = true;
						break;
					}
				}
				
				if (!found)
					sendPingToServer(WifiIP[0]);
			}
		} else {
			info('No Avatar Server on the network. New test in', Config.udp.restart , 'secs...');
			UDPScanRestart();
		}
	});

	scanner.run();
	
}



var UDPScanRestart = function () {
	
	if (UDPcron) UDPcron.stop();
	
	var d = new Date();
	var s = d.getSeconds()+Config.udp.restart;
	d.setSeconds(s);
	
	UDPcron = new CronJob(d, function(done) {	
		UPDconnect();
	}, null, true);
	
}




var sendPingToServer = function (server) {	

	var udp = require('dgram');
	var client = udp.createSocket('udp4');
	
	client.on('message',function(msg,infos){
		
		var folder = path.normalize(__dirname);
		reWriteProp(folder, '"ip"', infos.address, function () {
			info('Property file updated. New Avatar Server:', (infos.address).yellow);
			HTTPconnect(infos.address.toString());
		});
		
		client.close();
	});
	
	var msg = "AvatarClientPing:fixe:"+Config.client;
	//sending msg
	client.send(msg, 0, msg.length , Config.udp.port, server.ip,function(err){
	  if(err){
			error('Unable to ping Avatar server:', (err) ? err : "");
			client.close();
	  }
	});
	
}



var reWriteProp = function (folder, key, value, callback) {
	
	var file = path.normalize(folder + '/avatar.prop');
	var prop  = fs.readFileSync(file,'utf8');
	var beginProp = prop.substring(0,prop.indexOf(key) + (key).length);

	var toReplace = prop.substring(prop.indexOf(key) + (key).length);
	toReplace = toReplace.substring(0,toReplace.indexOf(',') + (',').length);
	toReplace = toReplace.substring(0,toReplace.indexOf('"') + ('"').length);
	toReplace = toReplace + value + '",'
	
	var endProp = prop.substring(prop.indexOf(key) + (key).length);
	var endProp = endProp.substring(endProp.indexOf(',') + (',').length);
	
	var newProp = beginProp + toReplace + endProp;
	
	fs.writeFileSync(file, newProp, 'utf8');
	
	callback();
	
}



var HTTPconnect = function (serverIp) {
	
	if (Config.client.length == 0) 
		return error('Unable to connect to the Avatar server. The client has no name in the property file'.red);

	var io = require('socket.io-client');
	var records = []; 
	
	socket = io.connect('http://' + ((serverIp) ? serverIp : Config.http.server.ip) + ':' + Config.http.server.port, {forceNew: true , autoConnect: true, reconnection: true, reconnectionDelay: 3000})
		.on('connect_error', function(err) {
			warn("Avatar Server not started".red);
		})
		.on('connect', function() {
			socket.emit('client_connect', Config.client, Config.http.remote.ip, Config.http.remote.port, Config.speech.server_speak, Config.listen.loop_mode);
		})
		.on('disconnect', function() {
			warn("Avatar Server gone".red);
		})
		.on('reconnect_attempt', function () { 
			info("Attempting to (re)connect to the Avatar Server...".yellow);
			
			// Démarre un job pour redémarrer le client si la perte vient du client lui-même
			if (!disconnected) {
				disconnected = true;
				restart();
			}
		})
		.on('connected', function() {
			info("Connected to Avatar Server on port", Config.http.server.port.toString().yellow);
			disconnected = false;
			if (cron) { cron.stop(); cron = null;};
		})
		.on('current', function(room, callback) {
			if (!callback) return error('Get current needs a callback function'.red);
			// Si 2 micros sont trop près, pour éviter les interférences
			if (room == Config.client) 
				callback();
			else
				info(room, 'is listening...'.yellow);
		})
		.on('mute', function(qs, callback) {
			Avatar.Listen.force_silence(function() {
				if (qs.sync)
					socket.emit('callback', callback);
			});
		})
		.on('add_grammar', function (sentence) { 
			if (Config.windows.addToLocalGrammar)
				Avatar.Listen.addToLocalGrammar(sentence);
		})
		.on('askme', function(options) {
			Avatar.Listen.askme(options);	
		})
		.on('stop_record', function() {
			Avatar.Listen.stopListen(true);
		})
		.on('askme_done', function() {
			Avatar.Listen.askme_done();
		})
		.on('speak', function(qs, callback) {
			if (qs.sync)
				Avatar.speak( qs.tts, function() { 
					socket.emit('callback', callback);
				});
			else
				Avatar.speak(qs.tts);
		})
		.on('client_speak', function(tts, callback, stopSpeak) {
			Avatar.speak(tts, callback, stopSpeak);
		})
		.on('callback_client_speak', function(callback) {
			if (callback) callback();
		})
		.on('end', function(full) {
			Avatar.Listen.end(full);
		})
		.on('start_listen', function() {
			Avatar.Listen.action();
		})
		.on('listen_again', function() {
			Avatar.Listen._start_listen();
		})
		.on('reset_volume', function(level_micro) {
			if (!level_micro)
				level_micro = Config.microphone.level_micro;
			Avatar.Listen.reset_volume(level_micro);
		}) 
		.on('speaker_volume', function(level_speaker) {
			if (!level_speaker)
				level_speaker = Config.speaker.default;
			Avatar.Listen.change_speaker_volume(level_speaker);
		}) 
		.on('keyPress', function(qs) {
			remote(qs);
		}) 
		.on('keyDown', function(qs) {
			remote(qs);
		})
		.on('keyUp', function(qs) {
			remote(qs);
		})
		.on('keyText', function(qs) {
			remote(qs);
		})
		.on('activate', function(qs) {
			remote(qs);
		})
		.on('pause', function(qs) {
			
		    if(qs.pause.indexOf('%TRANSFERT%') != -1) {
				if (qs.pause.split('/').length > 1) 
					qs.pause = path.resolve(__dirname) + '/transfert/'+_.last(qs.pause.split('/'));
				else
					qs.pause = qs.pause.replace('%TRANSFERT%', path.resolve(__dirname) + '/transfert');
			}
			
			if (qs.pause.indexOf('%CD%') != -1) 
				qs.pause = qs.pause.replace('%CD%', path.resolve(__dirname));
			
			qs.pause = normalize(qs.pause);
			  
			remote(qs);
		})
		.on('restart', function() {
			execRestart();
		})
		.on('play', function(qs, callback) {
			
			if(qs.play.indexOf('%TRANSFERT%') != -1) {
				if (qs.play.split('/').length > 1) 
					qs.play = path.resolve(__dirname) + '/transfert/'+_.last(qs.play.split('/'));
				else
					qs.play = qs.play.replace('%TRANSFERT%', path.resolve(__dirname) + '/transfert');
			}
			
			if (qs.play.indexOf('%CD%') != -1) 
				qs.play = qs.play.replace('%CD%', path.resolve(__dirname));
			
			qs.play = normalize(qs.play)
			
			if (qs.sync)
				remote(qs, function() {
					socket.emit('callback', callback);
				});
			else
				remote(qs);
		})
		.on('run', function(qs, callback) {
			if (qs.run.indexOf('%CD%') != -1)
				qs.run = qs.run.replace('%CD%', path.resolve(__dirname));

			if (qs.sync)
				remote(qs, function() {
					socket.emit('callback', callback);
				});
			else
				remote(qs);
		})
		.on('receive_data', function(qs, callback) {
			receiveStream (qs, function() { 
				if (qs.sync)
					socket.emit('callback', callback);
			}); 
		})
		.on('notts', function(qs) {
			remote(qs);
		})
		.on('listen', function(qs) {
			remote(qs);
		})
		.on('context', function(qs) {
			remote(qs);
		})
		.on('grammar', function(qs) {
			remote(qs);
		})
		.on('intercom', function(to) {
			Avatar.Listen.intercom(to);
		})
		.on('init_intercom', function(from) {
			info('Receive intercom from', from.yellow);
			records = []; 
		})
		.on('send_intercom', function(from, data) {
			if (data === 'end') {
				if (records){ 
					if (!Config.speech.server_speak) {
						var file = get_wavfile(from);
						fs.writeFile(file, toBuffer(records));
						clean_wav(from, function (wav) {
				
							var qs = { 
							'play'  : wav,
							'sync' : true
							};
							remote(qs, function() {
								Avatar.Listen.end(true);
							});    
							
						});
					} else {
						socket.emit('play_intercom', records, from);
					}	
				} else {
					info('no intercom file from', from);
				}
				/*
				// Un test avec les librairies wav et speaker
				// fonctionne bien... mais bon, comme j'ai un ffmpeg de dispo, pas necessaire...
				var file = fs.createReadStream('file');
				var reader = new wav.Reader();
				reader.on('format', function (format) {
				  reader.pipe(new Speaker(format));
				});
				file.pipe(reader);
				*/
			} else {
				records.push(data);
			}
		});
		
	 global.socket = socket;	

}


function normalize(folder) {
	
	
	return path.normalize(folder)
		.replace(path.parse(folder)
		.root, path.sep)
		.split( path.sep)
		.join('/');
	
}



function get_wavfile(from) {
	
	var dir = path.normalize(__dirname)
				.replace(path.parse(__dirname)
				.root, path.sep)
				.split( path.sep)
				.join('/') + '/intercom';
	fs.ensureDirSync(dir);
	dir += '/intercom-from-'+from+'.wav'
	
	return dir;
		
}



var streamBuffers = require('stream-buffers');
var toBuffer = function(records){
  var osb = new streamBuffers.WritableStreamBuffer({
    initialSize: (100 * 1024),   // start at 100 kilobytes.
    incrementAmount: (10 * 1024) // grow by 10 kilobytes each time buffer overflows.
  });
  for(var i = 0 ; i < records.length ; i++) {
    osb.write(new Buffer(records[i], 'binary'));
  }
  osb.end();
  return osb.getContents();
}



function clean_wav (from, callback) {
	
	var dir = path.normalize(__dirname)
				.replace(path.parse(__dirname)
				.root, path.sep)
				.split( path.sep)
				.join('/') + '/intercom';
	var wav = dir + '/intercom-from-'+from+'.wav'
	var wav_clean = dir + '/intercom-from-'+from+'-clean.wav'
	var webroot = path.resolve(__dirname);
	var cmd = webroot + '/bin/sox -q ' + wav + ' ' + wav_clean;
	var exec = require('child_process').exec;
	var child = exec(cmd, function (err, stdout, stderr) {
		if (err) { 
			error('Sox error:', err.red || 'Unable to start Sox'.red);
		} 
	});
	
	if (child)
		child.stdout.on("close", function() {
			setTimeout(function(){								
				try {
					callback(wav_clean);
				} catch(ex){ 
					error("error: " + ex.message.red); 
				}
			}, 200);
		});
	
}



var receiveStream = function (data, callback) {
	
	var webroot = path.resolve(__dirname);
	fs.ensureDirSync(webroot + '/transfert/');
	
	ss = require('socket.io-stream');
	var stream = ss.createStream(); 
	ss(socket).emit('get_data', data.src, stream); 

	stream.pipe(fs.createOutputStream( webroot + '/transfert/' + data.dest));
	
	stream.on('end', function (data) {
		callback ();
	});
	
}




var routes  = function (req, res, next){

  Avatar.Listen.action();
  if (res){ res.end(); }
  
}


var mute = function () {
	socket.emit('mute');
}


var unmute = function () {
	
	socket.emit('unmute');

}


var isConnected = function (){
	return (!disconnected) ? true : false;
}


var Avatar = {
  'init'      : init,
  'routes'	: routes,
  'connected' : isConnected,
  'remote'    : remote,
  'connect'  : connect,
  'speak'    : speak,
  'mute' : mute,
  'unmute' : unmute
  
}

// Exports Avatar
exports.init = init;