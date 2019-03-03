'use strict';

// Global variables
var stop_record = false
   , is_askme = false
   , is_silence = false
   , is_restart = false
   , is_listen = false
   , speaktobirds = 0
   , max_restart = 0
   , max_mute = 0
   , job
   , record
   , eeToChrome
   , setup
   , credentials
   , Micro = require('./node_modules/lib/listen.js')
   , Chrome
   , Speech = require('@google-cloud/speech')
   , _ = require('underscore')
   , request = require('request')
   , fs = require('fs-extra')
   , Promise = require('q').Promise
   , sox = require('./node_modules/lib/sox.js')
   , cron = require('cron/cron').CronJob
   , clj_fuzzy = require('./node_modules/clj-fuzzy')
   , path = require('path')
   , EventEmitter = require('events').EventEmitter
   , soundex   = require('./soundex.js').soundex;

require('colors');

	
switch (Config.speech.speechToText.toLowerCase()) {
	case 'sox': 
		if (Config.sox.google.credentials.private_key) {
			setup = {
				listenBy : Config.speech.speechToText,
				language: Config.sox.google.language || 'fr_FR',
				verbose: Config.sox.google.verbose || false
			};
			credentials = {
				private_key: Config.sox.google.credentials.private_key
			};
			record = record_Sox;
		}
		if (!record)
			return error ("No configuration for listening by Sox, check properties... exit.".red);
		break;
	case 'chrome' :
		Chrome = require('./node_modules/lib/chrome.js');
		setup = {
				listenBy : Config.speech.speechToText,
				address:  Config.chrome.address,
				port: Config.chrome.port || 5200,
				key:  Config.chrome.key,
				cert:  Config.chrome.cert,
				windows_size:  Config.chrome.windows_size,
				timeout_ready:  Config.chrome.timeout_ready
		};
		Chrome.HTTPSServer(setup, (ee) => {
			eeToChrome = ee;
			Chrome.Navigator(setup, () => { 
				info("HTTPS Chrome Server listening on port", setup.port.toString().yellow);
			});
		});
		record = record_Chrome;
		break;
	case 'windows': 
	default:
	
		if (!Config.windows.credentials.projectId || !Config.windows.credentials.client_email || !Config.windows.credentials.private_key)
				return error ("No configuration for listening by Windows, check properties... exit.".red);
			
		setup = {
			listenBy : Config.speech.speechToText,
			name: Config.windows.name || 'Default',
			proc: __dirname + '/bin/listen.exe',   
			confidence: Config.windows.params.confidence || '0.7',
			language:   Config.windows.params.language || 'fr_FR',
			grammar: __dirname + '/../grammar',
			verbose: Config.windows.params.verbose || false,
			maxAlternate: Config.windows.params.maxAlternate,
			initialSilenceTimeout: Config.windows.params.initialSilenceTimeout,
			babbleTimeout: Config.windows.params.babbleTimeout,
			endSilenceTimeout: Config.windows.params.endSilenceTimeout,
			endSilenceTimeoutAmbiguous: Config.windows.params.endSilenceTimeoutAmbiguous
		};
	
		credentials = {
			projectId: Config.windows.credentials.projectId,
			client_email: Config.windows.credentials.client_email,
			private_key: Config.windows.credentials.private_key
		};
		record = record_Windows;	
}
		


exports.action = function(){
	
	var start = function () {
		
		is_listen = true;
		info('Keyword recognized...'.yellow);
		
		silence()
		.then(() => {
			Avatar.speak(Config.locale[Config.speech.locale].tts_restoreContext, function() { 
				_start_listen();
			});
			}
		)
		.catch(function(err){ 
			error(err.red);
		});
	}
	
	if (Avatar.connected) {
		if (Config.listen.current == true)
			socket.emit('get_current', start);
		else
			start();
	} else {
		info(Config.client, 'is not connected to Avatar Server');
	}
}


function is_grammar(sentence, rules) {
	
	for (var i=0; i < rules.grammar.length; i++){
		if (sentence.toLowerCase() == rules.grammar[i].toLowerCase()) {
			return rules.tags[i];
		}
	}
	
	// dernière chance en distance de Levenshtein
	var sdx = soundex(sentence);
	var score = 0;
	var match;
	for (var i=0; i < rules.grammar.length; i++){
		var sdx_gram = soundex(rules.grammar[i]);
		var levens  = clj_fuzzy.metrics.levenshtein(sdx, sdx_gram);
        levens  = 1 - (levens / sdx_gram.length); 
		if (levens > score && levens >= Config.listen.threashold){
		  info('Levenshtein distance:', levens.toString().yellow, 'grammar:', unicode(rules.grammar[i]) ? rules.grammar[i].yellow : "found".yellow);
		  score = levens;
		  match = rules.tags[i];
		}
	}	
	
	// Prise en compte du générique
	if (!match) {
		for (var i=0; i < rules.grammar.length; i++){
			if (rules.grammar[i] == '*') {
				info('Generic sentence:', unicode(sentence.toLowerCase()) ? sentence.toLowerCase().yellow : "found".yellow);
				match = rules.tags[i] + ':' + sentence.toLowerCase();
				break;
			}
		}
	} 
	
	return match ? match : null;
	
}


function getTag(sentence, rules, resolve, reject ) {
	
	if (!resolve) {
		return new Promise(function (resolve, reject) {
			var tag = is_grammar(sentence, rules);
			if (tag) return resolve (tag);
			
			restart_askme(rules, resolve, reject);
		});
	}
		
	var tag = is_grammar(sentence, rules);
	if (tag) return resolve (tag);
	
	restart_askme(rules, resolve, reject);
		
}


var askme = exports.askme = function(options){
	
	is_askme = true;
	
	if (!options.tts) 
		return warn('Askme:', 'No tts'.yellow);
	
	silence() 
	.then( function() { 
		Avatar.speak(options.tts, function() { 
			start()
			.then(sentence => getTag(sentence, options))
			.then(tag => socket.emit('answer', tag))
			.catch(function(err) { 
				error(err.red);
			})
		});
	})
	.catch(function(err) { 
		error(err.red);
	})	
}


var askme_done = exports.askme_done = function(){
	
	if (eeToChrome) eeToChrome.emit ('stop');
	is_askme = false;
	end(true);
	
}


function restart_askme(rules, resolve, reject){
	
	Avatar.speak(Config.locale[Config.speech.locale].restart , function() {
		if (is_askme) socket.emit('reset_token');
		start()	
		.then(next => getTag(next, rules, resolve, reject ))
		.catch(error => reject(error))
	});
}



function cancel_speech(sentence, answers, tbl_answers) {
	
	var tts;
	
	_.map(answers, function(answer) {
		if (sentence.toLowerCase() == answer.toLowerCase()) 
			tts = tbl_answers.split('|')[Math.floor(Math.random() * tbl_answers.split('|').length)];
	});
	
	if (!tts) {
		// dernière chance en distance de Levenshtein
		var sdx = soundex(sentence);
		var score = 0;
		
		_.map(answers, function(answer) {
			var sdx_gram = soundex(answer);
			var levens  = clj_fuzzy.metrics.levenshtein(sdx, sdx_gram);
			levens  = 1 - (levens / sdx_gram.length); 
			if (levens > score && levens >= Config.listen.threashold) {
			  info('Levenshtein distance:', levens.toString().yellow, 'grammar:', unicode(answer) ? answer.yellow : "answer found".yellow);
			  score = levens;
			  tts = tbl_answers.split('|')[Math.floor(Math.random() * tbl_answers.split('|').length)];
			}
		});
	}
	
	return tts;
	
}



var _start_listen = exports._start_listen = function(){
	
	var tts;
	
	start()
	.then(function(sentence) { 
		
		tts = cancel_speech (sentence, Config.locale[Config.speech.locale].tts_forceMute.split('|'), Config.locale[Config.speech.locale].answers_forceMute);
		
		if (!tts) tts = cancel_speech (sentence, Config.locale[Config.speech.locale].tts_cancel.split('|'), Config.locale[Config.speech.locale].answers_cancel);
		if (!tts) tts = cancel_speech (sentence, Config.locale[Config.speech.locale].tts_thank.split('|'), Config.locale[Config.speech.locale].answers_thank);
		if (tts)
			return Avatar.speak(tts, function() {
				if (Config.windows.addToLocalGrammar)
					addToLocalGrammar(sentence);
				end(true, true);
			});
		
		socket.emit('action', sentence);
		
	})
	.catch(function(err){ 
		warn(err.yellow);
		end(true, true);
	});
	
}


var end = exports.end = function(full,loop) {
	
	if (Config.listen.loop_mode && !loop && is_listen && full != 'end') {
		// loop mode
		setTimeout(function(){ 
			Avatar.speak(Config.locale[Config.speech.locale].tts_restart_restoreContext, function() {
				info('Restarting ...'.yellow);
				_start_listen();
			});
		}, 500);
	} else {
		if (full == 'end') full = true;
		// reset listen
		reset_listen(full);
	}
}


function reset_listen(full) {
	
	if (full) {
		Avatar.remote({'listen' : true});
		// Reinit variables
		is_silence = false;
		is_listen = false;
		is_askme = false;
		is_restart = false;
		stop_record = false;
	}
	
	// remet le son des périphériques
	Avatar.unmute();
	
}


// Démarre l'écoute
function start() {
	
	return new Promise(function (resolve, reject) {

		listen()
		.then(sentence => { 
			unicode(sentence) ? info('Sentence'.bold.green, sentence.yellow , "sent to the server...".bold.green ) : info('Sentence sent to the server...'.bold.green);
			resolve (sentence); 
		})
		.catch(error => reject(error))
		
	});	
	
}


var force_silence = exports.force_silence = function (callback) {
	
	silence()
	.then(() => callback())
	.catch(function(err) { 
		error(err.red);
	})
	
}


function silence() {
	
	return new Promise(function (resolve, reject) {		
		if (!is_silence) {
			// Coupe le son des périphériques
			Avatar.mute();
			// coupe l'écoute du micro
			Avatar.remote({'listen' : false});	
			// Reset microphone volume
			reset_volume(Config.microphone.level_micro);
			is_silence = true;
		}
		resolve();
	});
}



var reset_volume = exports.reset_volume = function(level_micro) {
	
	if (Config.microphone.set_micro) {	
		var qs = {'run': path.resolve(__dirname) + '/nircmd/nircmd', 
		          'runp': 'setsysvolume ' + level_micro.toString() + ' "default_record"'
				 };
		Avatar.remote(qs);
		info("Reset microphone volume to",level_micro.toString().yellow);
	}
	
}



var change_speaker_volume = exports.change_speaker_volume = function(level_speaker) {
	
	var qs = {'run': path.resolve(__dirname) + '/nircmd/nircmd', 
	  'runp': 'setsysvolume ' + level_speaker.toString() + ' ' + level_speaker.toString()
	 };
	Avatar.remote(qs);
		
	info("Change speaker volume to",level_speaker.toString().yellow);
	
}



// Démarre l'enregistrement
function listen () {
	
	return new Promise(function (resolve, reject) {
		max_restart = 0;
		setTimeout(function(){ 
			record(function(sentence) { 
				if (!sentence) return reject("No sentence...");
				
				// reset increase threashold
				speaktobirds = 0;
				
				resolve(sentence);
			});
		}, Config.listen.timeout_record);
	});
	
};



var intercom = exports.intercom = function(to) {
	
	socket.emit('init_intercom', Config.client, to);
	
	var ee = new EventEmitter();
	ee.on('error', (err) => { 
		error(err.red); 
	});
	ee.on('speechBuffer', (buffer) => {
		socket.emit('send_intercom', Config.client, to, 'end');
	})
	
	sox.recordVoice({
	  verbose : true,
	  config : Config.intercom,
	  to : to
	}, ee, true, function() { 
		//end(true, true);
	});
	
}



var timeout_speech = function () {
	
	var d = new Date();
	var s = d.getSeconds()+Config.listen.timeout;
	d.setSeconds(s);

	if (job) job.stop();

	job = new cron(d, function(done) {	
		info('Listen timeout...'.yellow);
		stopListen(true);
		job = null;
		if (is_restart) {is_restart = false; return};
		if (speaktobirds >= Config.hotWord.increased_threashold) {
			update_threashold('+'); 
		} else {
			speaktobirds += 1;
		}
	},null, true);
}


var stopListen = exports.stopListen = function (byCron) {
	
	(setup.listenBy == "windows") ?  stopWindowsListen(byCron) : (setup.listenBy == "sox") ? stopSoxListen() : stopChromeListen(byCron);
	
}



function stopSoxListen (){
	stop_record = true;	
	sox.stop();
}


var stopWindowsListen = function(byCron){
	
	Micro.kill(setup.name);
	if (job) job.stop(); job = null; 
	if (byCron) end(true,true);
}



var stopChromeListen = function(byCron){
	
	eeToChrome.emit ('stop');  
	
	if (job) job.stop(); job = null; 

	if (byCron) {
		warn("No sentence...");
		end(true,true);
	} 
}



function record_Chrome (callback) {
	 
	
	if (!is_askme) timeout_speech();
	
	var eeFromChrome = new EventEmitter();
	eeToChrome.emit ('listen', eeFromChrome);
	
	eeFromChrome.on('speechChromeBuffer', (buffer) => {

		if (job) job.stop(); job = null; 
		
		if (buffer && buffer.length > 0) {
			max_mute = 0;
			return callback (buffer);
		}
		
		return restart_record(callback);
				
	});
	
}




var CLIENTS = {};
function record_Windows (callback) {
	
	if (!is_askme) timeout_speech();
	
	var getClient = () => {
		var client  = CLIENTS[credentials.projectId];
		if (client){ return client; }

		client = Speech({
			projectId: credentials.projectId,
			credentials: {
				client_email: credentials.client_email,
				private_key: credentials.private_key.replace(/\\n/g,'\n'),
			}
		});
       
 	    CLIENTS[credentials.projectId] = client;
		return client;
	}
	
	Micro.start(setup.name, setup, (json) => {
      	stopWindowsListen();
	
		if (!json) {
			if (setup.verbose) warn('Enregistrement, Buffer vide'.yellow);
			if (!is_askme) return callback();
		} 
		
		if (!json.google) {
			if (json.text && (json.text).length > 0) {
				max_mute = 0;
				info('Microsoft Speech Engine recognition, confidence:', (json.confidence).toString().yellow);
				return callback (json.text);
			}
			
			if (stop_record) {
				stop_record = false; 
				return callback(); 
			} else {
				return restart_record(callback);
			}
		}
		
		info('Google Cloud Speech recognition...');
		let client  = getClient();
		let config  = { encoding: 'LINEAR16', sampleRateHertz: 16000, languageCode: setup.language };
		let audio   = { content: json.buffer.toString('base64') };
		let request = { audio, config };
		
		client.recognize(request).then((results) => {
			
			const response = results[0];
			const transcript = response.results.map(result =>
				result.alternatives[0].transcript).join('\n');
				
			if (transcript && transcript.length > 0) {
				max_mute = 0;	
				return callback (transcript);
			}

			if (stop_record) {
				stop_record = false; callback(); 
			} else {
				restart_record(callback);
			}
		}).catch((err) => {
			if (err && err.length > 0)
				info('Google Speech',err.red);
			else
				info('Google Speech error. Unable to continue'.red);
			
			if (!is_askme) return callback();
		});
    });
	
}




function record_Sox (callback) {
	
	if (!is_askme) timeout_speech();
	
	var ee = new EventEmitter();
	ee.on('error', (err) => { 
		if (job) job.stop(); job = null; 
		if (setup.verbose) error('Erreur d\'enregistrement Sox'.red, err.red); 
		if (!is_askme) return callback();	
	});
	ee.on('speechBuffer', (buffer) => {
		
		if (!buffer || buffer.length == 0) {
			if (setup.verbose) warn('Enregistrement Sox, Buffer vide'.yellow);
			if (!is_askme) return callback();
		}
	
		request.post({
		  'url'     : 'https://www.google.com/speech-api/v2/recognize?output=json&lang='+setup.language+'&key='+credentials.private_key,
		  'headers' : {
			'Content-Type'  : 'audio/l16;rate=16000'
		  },
		  'body' : buffer
		}, function(err, resp, body){ 
				if (setup.verbose) info(body);
				
				if (job) job.stop(); job = null; 
				
				if (err) { 
					if (setup.verbose) error('Erreur de lecture de Google-speech'.red, err.red); 
					if (!is_askme) return callback();	
				}
				
				if (body && body.indexOf('{"result":[]}\n') != -1) body = body.replace('{"result":[]}\n',"");
				if (body && body.length > 0) {
					
					try {
						body = JSON.parse(body);
					} catch (err) {
						if (setup.verbose) error('Erreur de fichier JSON Google-speech'.red);
						return restart_record(callback);
					} 
					
					if (body.result && _.first(_.first(body.result).alternative).transcript) {
							max_mute = 0;
							var sentence = _.first(_.first(body.result).alternative).transcript;								
							return callback (sentence);
					} 
					
					return restart_record(callback);
				}

				if (stop_record) {
					stop_record = false; callback(); 
				} else {
					restart_record(callback);
				}
		});
	  
	});
	
	sox.recordVoice(  {
					  verbose : setup.verbose,
					  config : Config.sox
					  }, ee);
	
}



function restart_record(callback) {
	
	is_restart = true;
	
	if (!is_askme && max_restart == Config.listen.max_restart) {
		
		if (Config.listen.force_mute && max_mute == Config.listen.max_mute) {
			return Avatar.speak(Config.locale[Config.speech.locale].max_mute, function() {
				end(true, true);
				Avatar.remote ({'listen' : false });
				if (eeToChrome) eeToChrome.emit ('stop');
				max_mute = 0;
			});
		} 
		
		max_mute += 1;
		
		return Avatar.speak(Config.locale[Config.speech.locale].max_restart, function() {
			if (eeToChrome) eeToChrome.emit ('stop');
			end(true, true);
		});
	}
	
	max_restart += 1;
	
	warn("Restart listen...".yellow);
	Avatar.speak(Config.locale[Config.speech.locale].restart, function() { 
		restart_record_next (callback);
	});
	
}	



function restart_record_next (callback) {
	
	if (is_askme) {
		socket.emit('reset_token');
	}
	record(callback);
}


var addToLocalGrammar = exports.addToLocalGrammar = function (sentence) {
	
	// rewrite XML
	var XMLfile = __dirname + '/../grammar/grammar.xml';
	var Xml  = fs.readFileSync(XMLfile,'utf8');
	var grammar = '<item>' + sentence + '</item>';
	
	if (Xml.indexOf(grammar) == -1 && Xml.indexOf("</one-of>") != -1) {
		info("Add grammar to Microsoft Speech Engine...".yellow);
		var replaceXml =   Xml.substring(0,Xml.indexOf("</one-of>"))
						  + "\t" + grammar + "\n\t\t"
						  + Xml.substring(Xml.indexOf("</one-of>"));
		
		fs.writeFileSync(XMLfile, replaceXml, 'utf8');
	}
	
}
	


// Mise à jour de la confidence dans le hotword.xml
function update_threashold (operate, defaultvalue, callback) {

	// rewrite XML
	var file = __dirname + '/../hotword/hotword.xml';
	var Xml  = fs.readFileSync(file,'utf8');
	var threashold;
	
	if (defaultvalue) {
		threashold = Config.hotWord.default_threashold.split('.')[1];
	} else {
		var tblfind = Xml.split('"');
		var index = _.lastIndexOf(tblfind, ";out.action._attributes.uri=") - 1;
		if (index < -1) {
			error('Unable to find the threashold in the hotword.xml file')
			 if (callback) return callback(); 
		}
		
		threashold = tblfind[index].toString().split('.')[1];
		if (threashold.length == 2) threashold = threashold + '0'; 
		
		var max_threashold = Config.hotWord.max_threashold.toString().split('.')[1];
		if (max_threashold.length == 2) max_threashold = max_threashold + '0';
		
		threashold = parseInt(threashold);
		max_threashold = parseInt(max_threashold);
		
		var increased = parseInt(Config.hotWord.increased_threasholdBy.toString().split('.')[1]);
		if (operate == '+' || operate == 'auto') {
			if (threashold < max_threashold) {
				threashold += increased;
			} else {
				threashold = 'max';
				info("Maximum threashold value reached.");
			}
		} else
			threashold -= increased; 
	}
	
	if (!threashold || threashold == 'max') {
		 if (callback) callback();
		 return;	
	}
	
	var replaceXml =   Xml.substring(0,Xml.indexOf('out.action._attributes.threashold="') + ('out.action._attributes.threashold=').length + 1)
					  + '0.' + threashold
					  + Xml.substring(Xml.indexOf('out.action._attributes.threashold="') + ('out.action._attributes.threashold=').length + 6);
	
	fs.writeFileSync(file, replaceXml, 'utf8');
	
	if (operate != 'auto')
		Avatar.speak(Config.locale[Config.speech.locale].increase_threashold + ' ' + threashold);
	
	info("Update threashold to:", threashold);
	setTimeout(function(){ 
		if (callback) callback();
	}, 2000);
	
}


// confidence courante ?
var get_threashold = function () {

	var file = __dirname + '/../hotword/hotword.xml';
	var Xml  = fs.readFileSync(file,'utf8');

	var threashold =  parseFloat(Xml.substring(Xml.indexOf('out.action._attributes.threashold="') + ('out.action._attributes.threashold=').length + 3, Xml.indexOf('out.action._attributes.threashold="') + ('out.action._attributes.threashold=').length + 1 + 5))	
	Avatar.speak(threashold);
	
}



/*
//SpeechToText par AIP Oxford Microsoft supprimé dans la nouvelle version.
function record_Oxford (callback) {

	if (!is_askme) timeout_speech();

	getAccessToken (function(err, accessToken) {
		
		if (err) { error('Oxford token', err.red); return callback()}
		
		var ee = new EventEmitter();
		ee.on('error', (err) => { 
			if (job) job.stop(); job = null; 
			if (setup.verbose) error('Erreur d\'enregistrement Sox'.red, err.red); 
			if (!is_askme) return callback();	
		});
		ee.on('speechBuffer', (buffer) => {
			
			if (!buffer || buffer.length == 0) {
				if (setup.verbose) warn('Enregistrement Sox, Buffer vide'.yellow);
				if (!is_askme) return callback();
			}
			
			request.post({
				'url': 'https://speech.platform.bing.com/recognize/query',
				'qs' : {
					  'scenarios': 'ulm',
					  'appid': 'D4D52672-91D7-4C74-8AD8-42B1D98141A5', // This magic value is required
					  'locale': setup.language,
					  'device.os': 'wp7',
					  'version': '3.0',
					  'format': 'json',
					  'requestid': '1d4b6030-9099-11e0-91e4-0800200c9a66', // can be anything
					  'instanceid': '1d4b6030-9099-11e0-91e4-0800200c9a66' // can be anything
				},
				'headers': {
				  'Authorization': 'Bearer ' + accessToken,
				  'Content-Type': 'audio/wav; samplerate=16000',
				  //'Content-Length' : wavBuffer.length  // Not required
				},
				'body' : buffer
			}, function(err, confidence, body) {
				
			  console.log('body ' + body)
			
			  if (job) job.stop(); job = null; 
			  if (err) { 
				if (setup.verbose) error('Erreur de lecture de Google-speech'.red, err.red); 
				if (!is_askme) return callback();	
			  }			  
			  
			  if (body && body.length > 0) {
			
				try {
					body = JSON.parse(body);
				} catch (err) {
					if (setup.verbose) error('Erreur de fichier JSON Google-speech'.red);
					return restart_record(callback);
				} 
			
				if (body && body.results && body.results[0].lexical) {
					max_mute = 0;					
					return callback (body.results[0].lexical);
				} 
				
				return restart_record(callback);
			
			  }
			  
			  if (stop_record) {
				  stop_record = false; callback();
		      } else 
				 restart_record(callback);
			
			});
		});
		
		sox.recordVoice(  {
					  verbose : setup.verbose,
					  config : Config.sox
					  }, ee);
	});
}




var getAccessToken = function(callback) {
 
 console.log('key ' + credentials.private_key)
 
  request.post({
    url: 'https://api.cognitive.microsoft.com/sts/v1.0/issueToken',
    headers: { 
	  'Ocp-Apim-Subscription-Key': credentials.private_key, 
	  'Content-Length': 0 
    }
  }, function(err, resp, body) {
    if(err) return callback(err);
    try {
	  var accessToken = body;
      if(accessToken) {
        callback(null, accessToken);
      } else   { callback(body); }
    } catch(e) { callback(e);    }
  });
  
}
*/
