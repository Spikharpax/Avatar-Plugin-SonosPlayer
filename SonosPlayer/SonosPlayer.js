const { DeviceDiscovery, Sonos, Helpers} = require('sonos');
const _ = require('underscore');
const fs = require('fs-extra');
const path = require('path');
const soundex  = require('./services/soundex.js').soundex;
const {Graph} = require('cyto-avatar');
const {remote, ipcRenderer} = require('electron');
const {Menu, BrowserWindow, ipcMain} = remote;

let SpotifyRegion = {
  EU: '2311',
  US: '3079'
}

let SpotifyAuthentApi;
let SpotifySearchAPI;
let SpotifyPlaylistsAPI;
let SpotifyAlbumsAPI;
let SonosPlayerAPI;
let backupPreset = {"clients" : []};
let devices = [];

let cyto;
exports.addPluginElements = function(CY){

    // init variable globale module Graph
   cyto = new Graph (CY, __dirname);

    // Chargement des éléments sauvegardés
    cyto.loadAllGraphElements()
    .then(elems => {
      if (!elems || elems.length == 0) {
        addSonosGraph(cyto)
        .then(elem => cyto.onClick(elem, (evt) => {
            showAddTitle();
            //sonosContextMenu(cyto, evt);
        }))
        .catch(err => {
          console.log('err:', err || 'erreur dans la création de l\'élément Sonos');
        })
      } else {
        cyto.onClick(elems[0], (evt) => {
            showAddTitle();
            //sonosContextMenu(cyto, evt);
        });
      }
    })
}

let sonosWindow;
function showAddTitle() {

    if (sonosWindow) {
      sonosWindow.show();
      return;
    }

    let id = ipcRenderer.sendSync('info', 'id');
    let win = BrowserWindow.fromId(id);
    let style = {
      parent: win,
      frame: true,
      movable: true,
      resizable: false,
      show: false,
      width: 295,
      skipTaskbar: false,
      height: 290,
      title: 'Sonos',
      icon: 'resources/core/plugins/SonosPlayer/assets/images/Sonos.png',
    }
    if (fs.existsSync('./resources/core/plugins/SonosPlayer/style.json')) {
      let prop = fs.readJsonSync('./resources/core/plugins/SonosPlayer/style.json', { throws: false });
      if (prop) {
          style.x = prop.x;
          style.y = prop.y;
      }
    }

    sonosWindow = new BrowserWindow(style);
    sonosWindow.loadFile('../core/plugins/SonosPlayer/assets/html/sonos.html');
    //sonosWindow.openDevTools();
    ipcRenderer.sendSync('addPluginWindowID', sonosWindow.id);
    sonosWindow.once('ready-to-show', () => {
        sonosWindow.show();
        if (SpotifyApi) {
          SpotifyAuthentApi.authenticate()
          .then (info => {
              SpotifyApi.setAccessToken(info.access_token);
              //setTimeout(function() {
                SpotifySearchAPI.searchGenres([])
                .then(genres => {
                    ipcRenderer.sendSync('SonosGenre', genres);
                })
          		//}, 1500);
          })
          .catch(err => {
            warn ("Je suis désolé, je n'ai pu me connecter à ton compte Spoti faille.");
          });
        }
    });
    sonosWindow.on('closed', function () {
      ipcMain.removeAllListeners('Sonos');
      ipcMain.removeAllListeners('SonosWindowsID');
      sonosWindow = null;
    });

    ipcMain.on('SonosWindowsID', (event, arg) => {
      event.returnValue = sonosWindow.id;
    });

    ipcMain.on('Sonos', (event, arg) => {
      switch (arg) {
        case 'quit':
          ipcRenderer.sendSync('removePluginWindowID', sonosWindow.id);
          event.returnValue = true;
          sonosWindow.close();
          break;
      }
    })

}


function sonosContextMenu(cyto, elem) {
    let pluginMenu = [
      {
          label: 'Ajouter un titre',
          //icon: "path/monicon.png",
          click: () => {showAddTitle()}
      }
    ];

    // Création du menu
    var handler = function (e) {
      e.preventDefault();
      menu.popup({window: remote.getCurrentWindow()});
      window.removeEventListener('contextmenu', handler, false);
    }
    const menu = Menu.buildFromTemplate(pluginMenu);
    window.addEventListener('contextmenu', handler, false);
}



exports.onAvatarClose = function(callback){

  cyto.saveAllGraphElements("Sonos")
  .then(() => {
    callback();
  })
  .catch(err => {
    console.log('Error saving Elements', err)
    callback();
  })

}


function addSonosGraph(cyto) {

  return new Promise((resolve, reject) => {
    cyto.getGraph()
    .then(cy => cyto.addGraphElement(cy, "Sonos"))
    .then(elem => cyto.addElementClass(elem, "Sonos"))
    .then(elem => cyto.addElementImage(elem, __dirname+"/assets/images/Sonos.png"))
    .then(elem => cyto.addElementSize(elem, 45))
    .then(elem => cyto.addElementRenderedPosition(elem, 100, 100))
    //.then(elem => cyto.addElementName(elem, 'Sonos'))
    .then(elem => {
        resolve(elem);
    })
    .catch(err => {
      reject();
    })
  })

}


exports.mute = function (clientFrom, clientTo) {
		//clientFrom: Le client qui a passé la règle
    //clientTo: Le client courant (clientFrom ou Avatar.currentRoom)

    if (Avatar.isMobile(clientFrom)) {
      return;
    }

		if (Avatar.Socket) {
	    let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
	        return clientTo == num;
	    });

	    if (Avatar.Socket.isServerSpeak(clientFrom) || serverSpeak)
	      return;
		}

    let player =  _.find(devices, function(num){
        return num.id == clientTo;
    });

    if (player) {
        if (player.muted) return;

				player.device.getCurrentState().then((state) => {
					let wasPlaying = (state === 'playing' || state === 'transitioning');
        	player.device.avTransportService().CurrentTrack().then(mediaInfo => {
              player.device.getMuted().then(muted => {
                player.device.getVolume().then(volume => {
                    backupPreset.clients.push({"players": [{"roomName": clientTo}],
                      "state": wasPlaying,
                      "mediaInfo" : mediaInfo,
                      "volume": volume,
                      "muted": muted,
                      "UDN": player.UDN
                    });
                    if (mediaInfo && mediaInfo.uri && mediaInfo.uri.indexOf('x-sonos-htastream:') == -1 && wasPlaying) {
                      player.device.pause();
                    } else if (wasPlaying) {
                        player.device.setMuted(true);
                    }
                })
              })
        	})
          .catch(err => {
              player.device.getMuted().then(muted => {
                player.device.getVolume().then(volume => {
                        backupPreset.clients.push({"players": [{"roomName": clientTo}],
                          "state": false,
                          "mediaInfo" : null,
                          "volume": volume,
                          "muted": muted,
                          "UDN": player.UDN
                        });
                        if (mediaInfo.uri.indexOf('x-sonos-htastream:') == -1 && wasPlaying)
                          player.device.pause();
                        else if (wasPlaying)
                          player.device.setMuted(true);
                  });
              });
          });
					player.muted = true;
				});
    } else if (Avatar.Socket) {
        console.log('Sonos mute', 'Le Player '+clientTo+' n\'existe pas');
    }
}


exports.unmute = function (clientFrom, clientTo) {
	//clientFrom: Le client qui a passé la règle (client réel)
	//clientTo: Le client courant (clientFrom ou client mappé (avec Avatar.currentRoom))
  if (Avatar.isMobile(clientFrom) && !Avatar.Socket.isServerSpeak(clientFrom)) {
    return;
  }

	if (Avatar.Socket) {

    if (Avatar.isMobile(clientFrom))
        clientTo = Avatar.currentRoom ? Avatar.currentRoom : Config.default.client;

		let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
				return clientTo == num;
		});

    let mapped = _.find(Config.default.mapping, function(num){
      return clientTo == num.split(',')[0];
    });

    if (mapped && !serverSpeak)
        clientTo = mapped.split(',')[1];

    let player =  _.find(devices, function(num){
        return num.id == clientTo;
    });
    if (player)
      player.muted = false;
    else
      console.log('Sonos unmute', 'Le Player '+clientTo+' n\'existe pas');

    transportClosure(clientTo);
	}

}


// appliqué uniquement si un Avatar.speak.end() a un callback
// pour appliquer un timeout avant d'exécuter le callback
// ex: Avatar.speak.end( function() { //Do stuff })
// sinon ignoré
exports.timeoutCallbackEnd = function(clientFrom, clientTo) {
	//clientFrom: Le client qui a passé la règle
	//clientTo: Le client courant (clientFrom ou Avatar.currentRoom)

	let timeout = Config.modules.SonosPlayer.speech.add_timeout_callback_end * 1000;
	info('Sonos timeout:', timeout.toString(), "ms");
	return timeout;

}


// Fonction de subclassing de Avatar.speak
// Initialisé au chargement d'Avatar
exports.subclassSpeak = function() {
    subClassSpeak();
}



// Fonction de subclassing de Avatar.Play
// Initialisé au chargement d'Avatar
exports.subclassPlay = function() {
    subClassPlay();
}


// Retourne le path du plugin si la fonction Play est surclassé dans le plugin
// La fonction crée un répertoire intercom dans le path+'/tts' du plugin
exports.getPluginPath = function() {
  	return path.resolve(__dirname);
}


exports.init = function(){

	DeviceDiscovery((device, model) => {
      device.deviceDescription()
      .then (function (info) {
          let player =  _.find(devices, function(num){
          				return num.id == info.roomName;
          });

          if (!player) {
              devices.push({id: info.roomName, type: info.displayName, UDN: info.UDN, host: device.host, port: device.port, device: device});
              //console.log('ajouté', info.roomName, 'type', info.displayName, 'host', device.host)
          } else if (player.type != 'Playbar' && info.displayName == 'Playbar') {
              //console.log('supprimé', player.id, 'host', player.host)
              if (devices.length != 0)
                  devices = _.filter(devices, function(num){
                    return num.id != player.id;
                  });
              devices.push({id: info.roomName, type: info.displayName, UDN: info.UDN, host: device.host, port: device.port, device: device});
              //console.log('ajouté', info.roomName, 'type', info.displayName, 'host', device.host)
          }
      }).catch(err => {
          error('La recherche des players Sonos a échouée', err || null);
      });
	});

  const {SonosAPI} = require('./services/SonosAPI.js');
  SonosPlayerAPI = new SonosAPI(Config.modules.SonosPlayer.tts_lexic, Config.modules.SonosPlayer.search_lexic);

  if (Config.modules.SonosPlayer.Spotify.account.port && Config.modules.SonosPlayer.Spotify.account.client_id && Config.modules.SonosPlayer.Spotify.account.client_secret) {

      let SpotifyWebApi = require('spotify-web-api-node');
      SpotifyApi = new SpotifyWebApi();

      const {Spotify} = require('./services/Authentication.js');
      SpotifyAuthentApi = new Spotify (Config.modules.SonosPlayer.Spotify.account.port, {
        client_id:  Config.modules.SonosPlayer.Spotify.account.client_id,
        client_secret: Config.modules.SonosPlayer.Spotify.account.client_secret
      });

      const {SpotifySearch} = require('./services/SpotifySearch.js');
      SpotifySearchAPI = new SpotifySearch(SpotifyApi);

      const {SpotifyPlaylists} = require('./services/SpotifyPlaylists.js');
      SpotifyPlaylistsAPI = new SpotifyPlaylists(SpotifyApi);

      const {SpotifyAlbums} = require('./services/SpotifyAlbums.js');
      SpotifyAlbumsAPI = new SpotifyAlbums(SpotifyApi);
  } else {
    warn("SonosPlayer: Le compte Spotify n'est pas configuré. Les règles pour Spotify ne pourront pas être utilisées.");
  }

}


// Surclasse la fonction speak
function subClassSpeak () {

    let defaultSpeak = Avatar.speak;

    Avatar.speak = function() {
        let tts = arguments[0] !== 'string' && arguments.length < 2 ? null : arguments[0];
        let client = arguments.length >= 2 && typeof arguments[1] !== 'string' ? null : arguments[1];
        let callback = arguments.length >= 3 && typeof arguments[2] !== 'function' ? null : arguments[2];
        let end;
        if (callback)
            end = arguments.length == 4 && typeof arguments[3] === 'boolean' ? arguments[3] : false;
        else
            end = arguments.length == 3 && typeof arguments[2] === 'boolean' ? arguments[2] : false;

        if (!client)
            return warn('Sonos speak: Paramètre client manquant');

        if (!tts)
            return warn('Sonos speak: Paramètre tts manquant');

        if (Avatar.isMobile(client)) {
          if (!Avatar.Socket.isServerSpeak(client)) {
                return defaultSpeak(tts,client,callback);
          } else {
            client = Avatar.currentRoom ? Avatar.currentRoom : Config.default.client;
          }
        }

				let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
            return client == num;
        });

        let logClient = client;
        let mapped = _.find(Config.default.mapping, function(num){
          return client == num.split(',')[0];
        });

        if (mapped && !serverSpeak) {
            client = mapped.split(',')[1];
        }

        if (!Avatar.Socket.isServerSpeak(client) && !serverSpeak)
            return defaultSpeak(tts,client,callback);

        if (Config.interface)
            Avatar.Interface.logSpeak(logClient, 1, tts, Config.interfaceSpeak_timer, ((mapped) ? true : false));

        let client_backupPreset;
        if (backupPreset.clients && backupPreset.clients.length > 0) {
      	  client_backupPreset  = _.filter(backupPreset.clients, function(cl){
      			return cl.players[0].roomName == client;
      		});
        }

        tts = tts.replace(/[\n]/gi, "" ).replace(/[\r]/gi, "" );
        if (tts.indexOf('|') != -1)
            tts = tts.split('|')[Math.floor(Math.random() * tts.split('|').length)];

        let player =  _.find(devices, function(num){
                return num.id == client;
        });

        if (player) {
              player.device.getCurrentState().then((state) => {
                  let wasPlaying = (state === 'playing' || state === 'transitioning')
                  player.device.avTransportService().CurrentTrack().then(mediaInfo => {
                      if (mediaInfo.uri.indexOf("speech") == -1 && (!client_backupPreset || client_backupPreset.length == 0)) {
                        player.device.getMuted()
                        .then(muted => {
                            player.device.setMuted(false)
                            .then(() => player.device.getVolume())
                            .then(volume => {
                                  backupPreset.clients.push({"players": [{"roomName": client}],
                                    "state": wasPlaying,
                                    "mediaInfo" : mediaInfo,
                                    "volume": volume,
                                    "muted": muted,
                                    "UDN": player.UDN
                                  });
                                  speak(player, client, tts, end, callback);
                              });
                            });
                          } else {
                        player.device.setMuted(false)
                        .then(() => {
                            speak(player, client, tts, end, callback);
                        })
                      }
                  })
                  .catch(err => {
                      if (!client_backupPreset || client_backupPreset.length == 0) {
                          player.device.getMuted()
                          .then(muted => {
                            player.device.setMuted(false)
                            .then(() => player.device.getVolume())
                            .then(volume => {
                                backupPreset.clients.push({"players": [{"roomName": client}],
                                  "state": false,
                                  "mediaInfo" : null,
                                  "volume": volume,
                                  "muted": muted,
                                  "UDN": player.UDN
                                });
                                speak(player, client, tts, end, callback);
                            });
                          });
                      } else
                        player.device.setMuted(false)
                        .then(() => {
                          speak(player, client, tts, end, callback);
                        });
                  });
      		     });
        } else {
            error('Sonos: Le client', client, "n'existe pas comme Player Sonos");
           if (callback) callback();
        }
    }
}


function speak(player, client, tts, end, callback) {

    ttsToWav (client, tts, (filename) => {
        speak_states (client, filename, (timeout) => {
            if (!timeout) {
                timeout = Config.modules.SonosPlayer.speech.default_length * 1000;
                warn('Set default timeout Sonos speak:', (timeout.toString() + 's'));
            }

            console.log ('Timeout Sonos speak:', (parseInt((((timeout * Config.modules.SonosPlayer.speech.add_timeout) / 100) + timeout) * 1000).toString() + 'ms'));
            let ttsDir = (client.indexOf(' ') != -1) ? client.replace(/ /g,"_") : client;
            let options = {
                uri: 'x-file-cifs://'+Config.modules.SonosPlayer.speech.ttsPartage+'/tts/speech/'+ttsDir+'/speech.wav',
                onlyWhenPlaying: false, // It will query the state anyway, don't play the notification if the speaker is currently off.
                volume: ((Config.modules.SonosPlayer.speech.volume[client]) ? Config.modules.SonosPlayer.speech.volume[client] : Config.modules.SonosPlayer.speech.default_volume)// Change the volume for the notification, and revert back afterwards.
            };

            player.device.setAVTransportURI(options).then((state) => {
                player.device.setVolume(options.volume).then(() => {
                    setTimeout(function(){
                        if (end == true) {
                            transportClosure(client, function() {
                                if (callback) callback();
                            });
                        } else {
                            if (callback) callback();
                        }
                  	}, parseInt((((timeout * Config.modules.SonosPlayer.speech.add_timeout) / 100) + timeout ) * 1000));
                });
             }).catch(err => {
                error(((err) ? "Sonos: " + err : "Impossible de lire le fichier speech"));
                if (end == true) {
                    transportClosure(client, function() {
                        if (callback) callback();
                    });
                } else {
									if (callback) callback();
								}
            });
        });
    });
}



function transportClosure (client, callback) {

	if (backupPreset.clients && backupPreset.clients.length > 0 && client) {
		let client_backupPreset  = _.filter(backupPreset.clients, function(cl){
			return cl.players[0].roomName == client;
		});

		if (client_backupPreset.length > 0) {
        let player =  _.find(devices, function(num){
            return num.id == client;
        });

        let mediaInfo = client_backupPreset[0].mediaInfo;
        player.device.setVolume(client_backupPreset[0].volume)
        .then(() => player.device.setAVTransportURI({ uri: mediaInfo ? mediaInfo.uri : null, metadata: mediaInfo, onlySetUri: !client_backupPreset[0].state }))
        .then(() => {
            if (mediaInfo && mediaInfo.uri && mediaInfo.uri.indexOf('x-sonos-htastream:') == -1 && mediaInfo.uri.indexOf('mp3radio:') == -1) {
              player.device.getQueue().then((list) => {
                  if (list && ((list.items && list.items.length > 0) || list.length > 0)) {
                      player.device.selectQueue()
                      .then(() => player.device.selectTrack(mediaInfo.queuePosition))
                      .then(state => player.device.seek(mediaInfo.position))
                      .then(() => player.device.setMuted(client_backupPreset[0].muted))
                      .then(() => {
                            if (!client_backupPreset[0].state) {
                                player.device.pause().then(() => {
                                  removeClientFromPreset(client, () => {
                                    if (callback) callback();
                                  });
                                });
                            } else {
                              removeClientFromPreset(client, () => {
                                if (callback) callback();
                              });
                            }
                        }).catch((err) => {
                              removeClientFromPreset(client);
                              console.log('erreur dans le transportClosure', err);
                              if (callback) callback();
                        });

                    } else {
                      player.device.setMuted(client_backupPreset[0].muted)
                      .then(() => {
                          if (!client_backupPreset[0].state) {
                              player.device.pause().then(() => {
                                removeClientFromPreset(client, () => {
                                  if (callback) callback();
                                });
                              });
                          } else {
                            removeClientFromPreset(client, () => {
                              if (callback) callback();
                            });
                          }
                      }).catch((err) => {
                            removeClientFromPreset(client);
                            console.log('erreur dans le transportClosure', err);
                            if (callback) callback();
                      });
                    }
                  });
                } else if (mediaInfo && mediaInfo.uri && (mediaInfo.uri.indexOf('x-sonos-htastream:') != -1 || mediaInfo.uri.indexOf('mp3radio:') != -1) && !client_backupPreset[0].muted) {
                    player.device.setMuted(false).then(() => {
                      removeClientFromPreset(client, () => {
                        if (callback) callback();
                      });
                    });
                } else {
                    removeClientFromPreset(client);
                    if (callback) callback();
                }
            }).catch((err) => {
                removeClientFromPreset(client);
                console.log('erreur dans le transportClosure', err);
                if (callback) callback();
            });
		} else  if (callback) callback();
	} else  if (callback) callback();

}



function removeClientFromPreset(client, callback) {

  if (backupPreset.clients) {
    backupPreset  = _.filter(backupPreset.clients, function(cl){
        return cl.players[0].roomName != client;
    });

    if (backupPreset.length == 0) // reinit
        backupPreset = {"clients" : []};

    if (callback) callback();
  } else {
    if (callback) callback();
  }

}



// Surclasse la fonction play
function subClassPlay() {

    let defaultplay = Avatar.play;

    Avatar.play = function() {
        let playfile = arguments[0] !== 'string' && arguments.length < 2 ? null : arguments[0];
        let client = arguments.length >= 2 && typeof arguments[1] !== 'string' ? null : arguments[1];
        let callback = arguments.length >= 3 && typeof arguments[2] !== 'function' ? null : arguments[2];
        let end;
        if (callback)
           end = arguments.length == 4 && typeof arguments[3] === 'boolean' ? arguments[3] : false;
        else
           end = arguments.length == 3 && typeof arguments[2] === 'boolean' ? arguments[2] : false;

        if (!client)
            return warn('Sonos Play: Paramètre client manquant');

        if (!playfile)
            return warn('Sonos Play: Paramètre file manquant');

        if (Avatar.isMobile(client)) {
          if (!Avatar.Socket.isServerSpeak(client)) {
                return defaultSpeak(tts,client,callback);
          } else {
            client = Avatar.currentRoom ? Avatar.currentRoom : Config.default.client;
          }
        }

        let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
            return client == num;
        });

        let logClient = client;
        let mapped = _.find(Config.default.mapping, function(num){
          return client == num.split(',')[0];
        });

        if (mapped && !serverSpeak) {
            client = mapped.split(',')[1];
        }

        if (!Avatar.Socket.isServerSpeak(client) && !serverSpeak)
            return defaultplay(playfile,client,callback);

        let fullpathfile;
        if (playfile.indexOf('@@') != -1) {
          fullpathfile = playfile.split('@@')[0]+playfile.split('@@')[1];
          playfile = '//'+Config.modules.SonosPlayer.speech.ttsPartage+playfile.split('@@')[1];
        }

        let client_backupPreset;
        if (backupPreset.clients && backupPreset.clients.length > 0) {
      	  client_backupPreset  = _.filter(backupPreset.clients, function(cl){
      			return cl.players[0].roomName == client;
      		});
        }

        let player =  _.find(devices, function(num){
                return num.id == client;
        });

        if (player) {
            player.device.getCurrentState().then((state) => {
                let wasPlaying = (state === 'playing' || state === 'transitioning')
                player.device.avTransportService().CurrentTrack().then(mediaInfo => {
                    if (mediaInfo.uri.indexOf("speech") == -1 && (!client_backupPreset || client_backupPreset.length == 0)) {
                      player.device.getMuted()
                      .then(muted => {
                        player.device.setMuted(false)
                        .then(() => player.device.getVolume())
                        .then(volume => {
                            backupPreset.clients.push({"players": [{"roomName": client}],
                              "state": wasPlaying,
                              "mediaInfo" : mediaInfo,
                              "volume": volume,
                              "muted": muted,
                              "UDN": player.UDN
                            });
                            play(player, client, fullpathfile, playfile, end, callback);
                          });
                        })
                    } else {
                      player.device.setMuted(false)
                      .then(() => {
                        play(player, client, fullpathfile, playfile, end, callback);
                      });
                    }
                })
                .catch(err => {
                  if (!client_backupPreset || client_backupPreset.length == 0) {
                    player.device.getMuted()
                    .then(muted => {
                      player.device.setMuted(false)
                      .then(() => player.device.getVolume())
                      .then(volume => {
                          backupPreset.clients.push({"players": [{"roomName": client}],
                            "state": false,
                            "mediaInfo" : null,
                            "volume": volume,
                            "muted": muted,
                            "UDN": player.UDN
                          });
                          play(player, client, fullpathfile, playfile, end, callback);
                      });
                    });
                  } else {
                    player.device.setMuted(false)
                    .then(() => {
                      play(player, client, fullpathfile, playfile, end, callback);
                    });
                  }
                });
             });
        } else {
            error('Sonos: Le client', client, "n'existe pas comme Player Sonos");
            if (callback) callback();
        }
    }
}


function test (data, client) {

  Avatar.copyfile('plugins/timer/sound/rencontre_du_troisieme_type.wav', client, function() {
    Avatar.play('%TRANSFERT%/rencontre_du_troisieme_type.wav', client, function(){
        Avatar.speak("musique terminé", client, function() {
            Avatar.call('SonosPlayer', {action : {command: 'speak_closure'}, client: client});
            // ou
            // transportClosure(client)
        });
    });
  })

  /*Avatar.play('//HOME-PORTABLE/sound/rencontre_du_troisieme_type.wav', client, function(){
      Avatar.call('SonosPlayer', {action : {command: 'speak_closure'}, client: client});
  })*/
}


function play(player, client, fullpathfile, playfile, end, callback) {

    speak_states (client, fullpathfile, function(timeout) {
      if (!timeout) {
        timeout = Config.modules.SonosPlayer.speech.default_length * 1000;
        warn('Set default timeout Sonos play:', (timeout.toString() + 's'));
      }

      console.log ('Timeout Sonos play:', (parseInt((((timeout * Config.modules.SonosPlayer.speech.add_timeout) / 100) + timeout) * 1000).toString() + 'ms'));

      let options = {
          uri: 'x-file-cifs:'+playfile,
          onlyWhenPlaying: false, // It will query the state anyway, don't play the notification if the speaker is currently off.
          volume: ((Config.modules.SonosPlayer.speech.volume[client]) ? Config.modules.SonosPlayer.speech.volume[client] : Config.modules.SonosPlayer.speech.default_volume) // Change the volume for the notification, and revert back afterwards.
      };

      player.device.setAVTransportURI(options).then((state) => {
          player.device.setVolume(options.volume).then(() => {
              setTimeout(function(){
                  if (end == true) {
                      transportClosure(client, function() {
                          if (callback) callback();
                      });
                  } else {
                      if (callback) callback();
                  }
              }, parseInt((((timeout * Config.modules.SonosPlayer.speech.add_timeout) / 100) + timeout ) * 1000));
          });
       }).catch(err => {
          error(((err) ? "Sonos: " + err : "Impossible de lire le fichier"));
          if (end == true) {
              transportClosure(client, function() {
                  if (callback) callback();
              });
          } else {
            if (callback) callback();
          }
        });
    });
}



exports.action = function(data, callback){

	// Tableau d'actions
	var tblCommand = {
      spotify: function() { if (SpotifyApi) {
                                  startSpotify(data, client, askForSpotify);
                            } else {
                              getBackupPreset(data.client)
                              .then(() => {
                                Avatar.speak("il n'y a aucun compte Spotify configuré.", data.client, () => {
                                    Avatar.Speech.end(data.client);
                                });
                              })
                            }
                          },
      addAlbumToSpotifylib: function() { if (SpotifyApi) {
                                  startSpotify(data, client, addAlbumToSpotifyLibrary);
                            } else {
                              getBackupPreset(data.client)
                              .then(() => {
                                Avatar.speak("il n'y a aucun compte Spotify configuré.", data.client, () => {
                                    Avatar.Speech.end(data.client);
                                });
                              })
                            }
                          },
      searchMusic : function() {askForMusic (data, client, "Music");},
      searchRadio : function() { askForMusic (data, client, "Radio"); },
      volumeLowUp : function() { volumeUp (data, client, 5); },
      volumeLowDown: function() { volumeDown (data, client, 5); },
      volumeUp : function() { volumeUp (data, client, 20); },
      volumeDown: function() { volumeDown (data, client, 20); },
      activateTvSound: function() { tvSound (data, client); },
      currentTrack: function() {currentTrack(data, client)},
      playMusic: function() { playList (data, client);},
      stopMusic: function() { stopList (data, client);},
      muteMusicOn : function() { muteMusic (data, client, false);},
      muteMusicOff : function() { muteMusic (data, client, true);},
      previousMusic : function() { previousMusic (data, client); },
      nextMusic : function() { nextMusic (data, client); },
      wakeup_random_music : function() {wakeUpMusic(data, client, data.action.searchType, data.action.searchTerm, callback);},
      wakeup_volume : function() { wakeUpVolumeUp (client, data.action.value); },
      speak_closure: function() { transportClosure(client);}
	};

	let client = setClient(data);

	// Info console
	info("SonosPlayer:", data.action.command, "From:", data.client, "To:", client);
  // action
	tblCommand[data.action.command]();

  if (data.action.command != 'wakeup_random_music')
	   callback();

}



function startSpotify (data, client, next) {

  let player =  _.find(devices, function(num){
      return num.id == client;
  });

  if (player) {
      SpotifyAuthentApi.authenticate()
      .then (info => {
            SpotifyApi.setAccessToken(info.access_token);
             next (data, client, player);
      })
      .catch(err => {
          Avatar.speak("Je suis désolé, je n'ai pas pu me connecter à ton compte Spoti faille.", data.client, function(){
              Avatar.Speech.end(data.client);
          });
      })
  } else {
      Avatar.speak("Je suis désolé, je n'ai pas trouvé de player "+client, data.client, function(){
          Avatar.Speech.end(data.client);
      });
  }
}


function askForSpotify (data, client, player) {

    Avatar.askme("Menu Spoti faille. Quelle source ?|Menu Spoti faille. Tu veux quoi ?", data.client,
        {
            "*": "generic",
            "qu'est ce que je peux dire": "sommaire",
            "terminer": "done"
        }, 0, function (answer, end) {

            // Test si la réponse contient "generic"
            if (answer && answer.indexOf('generic') != -1) {
                end(data.client);
                answer = answer.split(':')[1];
                // mes albums
                if (answer.toLowerCase().indexOf('album') != -1) {
                  return askSpotifyAlbums(data, client, player);
                }
                // mes playlists
                if (answer.toLowerCase().indexOf('playlist') != -1) {
                  return askSpotifyPlaylist(data, client, player);
                }
                // recherche
                if (answer.toLowerCase().indexOf('recherche') != -1) {
                  if (answer.toLowerCase().indexOf('par titre') != -1)
                      return askSpotifySearch('titre', data, client, player);
                  else  if (answer.toLowerCase().indexOf('par genre') != -1)
                      return askSpotifySearch('genre', data, client, player);
                  else  if (answer.toLowerCase().indexOf('par artiste') != -1)
                      return askSpotifySearch('artiste', data, client, player);
                  else
                      return askSpotifySearch(null, data, client, player);
                }

                Avatar.speak("Je suis désolé, je n'ai pas compris.", data.client, function(){
                  askForSpotify (data, client, player);
                });
                return;
            }
            // Grammaire fixe
            switch(answer) {
                case "sommaire":
                  end(data.client);
                  Avatar.speak("Tu peux dire:", data.client, function(){
                      Avatar.speak("Album. Playlist. Recherche. Recherche par genre. Recherche par titre. Recherche par artiste. Ou terminé.", data.client, function(){
                          askForSpotify (data, client, player);
                      });
                  });
                  break;
                case "done":
                default:
                  Avatar.speak("Terminé", data.client, function(){
                      end(data.client, true);
                  });
           }
        }
    );

}



function askSpotifySearch(type, data, client, player) {

  if (type) {
    switch(type) {
      case 'genre':
            spotifySearchGenre(data, client, player);
            break;
      case 'titre':
            spotifySearchTitre(data, client, player);
            break;
      case 'artiste':
            spotifySearchArtist(data, client, player);
            break;
    }
    return;
  }

  Avatar.askme("Par genre, par artiste ou par titre ?", data.client,
      {
          "*": "generic",
          "terminer": "done"
      }, 0, function (answer, end) {

          if (answer && answer.indexOf('generic') != -1) {
              end(data.client);
              answer = answer.split(':')[1];

              if (answer.indexOf('genre') != -1) {
                return spotifySearchGenre(data, client, player);
              }

              if (answer.indexOf('titre') != -1) {
                return spotifySearchTitre(data, client, player);
              }

              if (answer.indexOf('artiste') != -1 || answer.indexOf('nom') != -1) {
                return spotifySearchArtist(data, client, player);
              }

              return Avatar.speak("Je suis désolé, je n'ai pas compris.", data.client, function(){
                  askSpotifySearch(data, client, player)
              });
          }

          // Grammaire fixe
          switch(answer) {
            case "done":
            default:
                Avatar.speak("Terminé", data.client, function(){
                    end(data.client, true);
                });
         }
      })
}



function spotifySearchGenre(data, client, player) {

  let category;
  askSpotifySearchGenre(data, client, player)
  .then(genre => {
      return new Promise((resolve, reject) => {
        category = genre;
        if (!genre || genre.length > 1 || genre.length == 0) return resolve(false);
        SpotifySearchAPI.searchPlaylistsByCategory(genre)
        .then(albums => {
            resolve(albums);
        })
      })
  })
  .then(albums => {
      return new Promise((resolve, reject) => {
          if (!albums || albums.length == 0)
            return resolve(0);

          if (sonosWindow) {
              let understood = ipcRenderer.sendSync('SonosUnderstand');
              if (category[0].name.toLowerCase() != understood.toLowerCase())
                ipcRenderer.sendSync('SonosUnderstand', category[0].name);
          }

          let answered = SonosPlayerAPI.getLexic(category[0].name);
          if (sonosWindow)
              answered = ipcRenderer.sendSync('SonosSay', answered);

          Avatar.speak('J\'ai trouvé '+albums.length+' playlist dans le genre '+answered, data.client, () => {
            searchForMultipleAlbums (data, albums, 0, null, (item) => {
               resolve(item);
            });
          })
      })
  })
  .then(item => playMusic(data, client, player.device, item, true))
  .then(state => {
    if (state && typeof state === 'boolean') {
        if (Avatar.isMobile(data.client))
            Avatar.Socket.getClientSocket(data.client).emit('askme_done');
        else
            Avatar.Speech.end(data.client);
    } else {
      let tts = "Je suis désolé, ce genre n'existe pas";
      if (category && category.length == 1)
        tts = "Je suis désolé, je n'ai rien trouvé pour le genre "+category[0].name;
      else if (category && category.length > 1)
        tts = "Je suis désolé, j'ai trouvé plusieurs genres avec ce que tu as demandé. Essayes d'être plus précis";

      Avatar.speak(tts, data.client, function(){
        if (Avatar.isMobile(data.client))
            Avatar.Socket.getClientSocket(data.client).emit('askme_done');
        else
            Avatar.Speech.end(data.client);
      });
    }
  })
  .catch(err => {
    let tts = "Je suis désolé, j'ai rencontré une erreur."
    Avatar.speak(tts, data.client, function(){
    if (Avatar.isMobile(data.client))
        Avatar.Socket.getClientSocket(data.client).emit('askme_done');
    else
      Avatar.Speech.end(data.client);
    });
    console.log('Spotify Search genre:', err);
  });

}


function askSpotifySearchGenre(data, client, player) {

  return new Promise((resolve, reject) => {

    if (sonosWindow) {
      let value = ipcRenderer.sendSync('SonosGetGenre');
      if (value) {
        let genre = [];
        value = value.split('@@');
        genre.push({name: value[0], id: value[1]})
        resolve(genre);
        return;
      }
    }

    Avatar.askme("Quel genre?", data.client,
        {
            "*": "generic",
            "terminer": "done"
        }, 0, function (answer, end) {

            if (answer && answer.indexOf('generic') != -1) {
                end(data.client);
                let genres = [];
                answer = answer.split(':')[1];
                if (sonosWindow)
                  ipcRenderer.sendSync('SonosSpeech', answer);

                answer = SonosPlayerAPI.getSearchLexic(answer);
                if (sonosWindow)
                  answer = ipcRenderer.sendSync('SonosUnderstand', answer);

                SpotifySearchAPI.searchGenres(genres)
                .then(genres => {
                    if (genres.length == 0) {
                      console.log('Sonos searchGenres', 'Aucun genres trouvés')
                      resolve(false);
                    }
                    let genreMatched = [];
                    let sdx = soundex(answer);
                    let score = 0;
                    genres.forEach(genre => {
                      if (SonosPlayerAPI.getLevenshteinDistance(sdx, genre.name, score))
                          genreMatched.push (genre);
                    });
                    resolve(genreMatched);
                })
                .catch(err => {
                    resolve(false);
                })
                return;
            }

            // Grammaire fixe
            switch(answer) {
              case "done":
              default:
                  Avatar.speak("Terminé", data.client, function(){
                      end(data.client, true);
                  });
           }
        })
    })
}


function spotifySearchTitre (data, client, player) {

    let titre;
    askSpotifySearchTitre(data, client, player)
    .then(retval => {
        return new Promise((resolve, reject) => {

            if (!retval || !retval.titres || !retval.titres[0] || !retval.titres[0].uri)
              return resolve(0);

            let answer = retval.answer;
            retval = retval.titres;
            if (retval.length == 1) {
              titre = SonosPlayerAPI.getLexic(retval.name);
              let artist = (retval.artists && retval.artists[0]) ? SonosPlayerAPI.getLexic(retval.artists[0].name) : null;
              let speech = (artist) ? 'Je met '+titre+' de l\'artiste '+artist : 'Je met '+titre;
              if (sonosWindow)
                    titre = ipcRenderer.sendSync('SonosSay', titre);

              Avatar.speak(speech, data.client, () => {
                  resolve(retval);
              });
              return;
            }

            answer = SonosPlayerAPI.getLexic(answer);
            if (sonosWindow)
                  answer = ipcRenderer.sendSync('SonosSay', answer);
            Avatar.speak('J\'ai trouvé '+retval.length+' titres pour '+answer, data.client, () => {
              searchForMultipleAlbums (data, retval, 0, null, (item) => {
                 resolve(item);
              });
            })
        })
    })
    .then(item => playMusic(data, client, player.device, item, true))
    .then(state => {
      if (state && typeof state === 'boolean') {
         if (Avatar.isMobile(data.client))
              Avatar.Socket.getClientSocket(data.client).emit('askme_done');
          else
              Avatar.Speech.end(data.client);
      } else {
        let tts = (!titre)
        ? "Je suis désolé, ce titre n'existe pas"
        : "Je suis désolé, je n'ai rien trouvé pour le titre "+titre;

        Avatar.speak(tts, data.client, function(){
          if (Avatar.isMobile(data.client))
              Avatar.Socket.getClientSocket(data.client).emit('askme_done');
          else
              Avatar.Speech.end(data.client);
        });
      }
    })
    .catch(err => {
        let tts = "Je suis désolé, j'ai rencontré une erreur."
        Avatar.speak(tts, data.client, function(){
            if (Avatar.isMobile(data.client))
                Avatar.Socket.getClientSocket(data.client).emit('askme_done');
            else
              Avatar.Speech.end(data.client);
        });
        console.log('Spotify Search Titre', err)
    });
}



function askSpotifySearchTitre (data, client, player) {

  return new Promise((resolve, reject) => {

    function returnTitre(answer) {
      let artist;
      let title;

      if (sonosWindow)
        ipcRenderer.sendSync('SonosSpeech', answer);

      answer = SonosPlayerAPI.getSearchLexic(answer);
      if (sonosWindow)
        answer = ipcRenderer.sendSync('SonosUnderstand', answer);

      if (answer.toLowerCase().indexOf(' de l\'artiste ') != -1 ) {
          artist = answer.split(' de l\'artiste ')[1];
          title = answer.split(' de l\'artiste ')[0];
      } else if (answer.toLowerCase().indexOf(' de ') != -1 ){
          artist = answer.split(' de ')[1];
          title = answer.split(' de ')[0];
      } else if (answer.toLowerCase().indexOf(',') != -1 ){
          artist = answer.split(',')[1];
          title = answer.split(',')[0];
      }

      return {title: title, artist: artist};
    }

    if (sonosWindow) {
      let title = ipcRenderer.sendSync('SonosUnderstand');
      if (title) {
        let val = returnTitre(title);
        SpotifySearchAPI.searchTitre(val.title, val.artist)
        .then(titres => {
            resolve({answer: val.title, titres: titres});
        })
        .catch(err => {
            resolve(0);
        })
        return;
      }
    }

    Avatar.askme("Quel titre ?", data.client,
        {
            "*": "generic",
            "terminer": "done"
        }, 0, function (answer, end) {

            if (answer && answer.indexOf('generic') != -1) {
                end(data.client);
                answer = answer.split(':')[1];
                let val = returnTitre(answer);
                SpotifySearchAPI.searchTitre(val.title, val.artist)
                .then(titres => {
                    resolve({answer: val.title, titres: titres});
                })
                .catch(err => {
                    resolve(0);
                })
                return;
            }

            // Grammaire fixe
            switch(answer) {
              case "done":
              default:
                Avatar.speak("Terminé", data.client, function(){
                    end(data.client, true);
                });
           }
        })
    })

}


function spotifySearchArtist(data, client, player) {

  let artist;
  askSpotifySearchArtist(data, client, player)
  .then(retval => {
      return new Promise((resolve, reject) => {

          if (!retval || !retval.names || !retval.names[0] || !retval.names[0].uri)
            return resolve(0);

          artist = retval.artist;
          let albums = retval.names;

          artist = SonosPlayerAPI.getLexic(artist);
          if (sonosWindow)
                artist = ipcRenderer.sendSync('SonosSay', artist);

          if (albums.length == 1) {
            Avatar.speak('Je met '+ artist, data.client, () => {
                return resolve(albums[0]);
            })
          }

          Avatar.speak('J\'ai trouvé '+albums.length+' albums pour l\'artiste '+artist, data.client, () => {
            searchForMultipleAlbums (data, albums, 0, null, (item) => {
               resolve(item);
            });
          })
      })
  })
  .then(item => playMusic(data, client, player.device, item, true))
  .then(state => {
    if (state && typeof state === 'boolean') {
       if (Avatar.isMobile(data.client))
            Avatar.Socket.getClientSocket(data.client).emit('askme_done');
        else
            Avatar.Speech.end(data.client);
    } else {
      let tts = (!artist)
      ? "Je suis désolé. Cet artiste n'existe pas"
      : "Je suis désolé, je n'ai rien trouvé pour l'artiste "+artist;

      Avatar.speak(tts, data.client, function(){
        if (Avatar.isMobile(data.client))
            Avatar.Socket.getClientSocket(data.client).emit('askme_done');
        else
            Avatar.Speech.end(data.client);
      });
    }
  })
  .catch(err => {
      let tts = "Je suis désolé, j'ai rencontré une erreur."
      Avatar.speak(tts, data.client, function(){
          if (Avatar.isMobile(data.client))
              Avatar.Socket.getClientSocket(data.client).emit('askme_done');
          else
            Avatar.Speech.end(data.client);
      });
      console.log('Spotify Search Artists', err)
  });
}



function askSpotifySearchArtist (data, client, player) {

  return new Promise((resolve, reject) => {

    function returnArtist(answer) {
      if (sonosWindow)
        ipcRenderer.sendSync('SonosSpeech', answer);

      answer = SonosPlayerAPI.getSearchLexic(answer);
      if (sonosWindow)
        answer = ipcRenderer.sendSync('SonosUnderstand', answer);

      return answer;
    }

    if (sonosWindow) {
      let artist = ipcRenderer.sendSync('SonosUnderstand');
      if (artist) {
        artist = returnArtist(artist);
        SpotifySearchAPI.searchArtist(artist)
        .then(names => {
            resolve({artist: artist, names: names});
        })
        .catch(err => {
            resolve(0);
        })

        return;
      }
    }


    Avatar.askme("Quel artiste ?", data.client,
        {
            "*": "generic",
            "terminer": "done"
        }, 0, function (answer, end) {

            if (answer && answer.indexOf('generic') != -1) {
                end(data.client);
                // Plus facile de comprendre le nom en donnant le context
                answer = answer.split(':')[1].toLowerCase().replace('l\'artiste ','').replace('la chanteuse ','').replace('le chanteur ','').replace('le groupe ','');

                answer = returnArtist(answer);
                SpotifySearchAPI.searchArtist(answer)
                .then(names => {
                    resolve({artist: answer, names: names});
                })
                .catch(err => {
                    resolve(0);
                })
                return;
            }

            // Grammaire fixe
            switch(answer) {
              case "done":
              default:
                Avatar.speak("Terminé", data.client, function(){
                    end(data.client, true);
                });
           }
        })
    })

}



function askSpotifyPlaylist(data, client, player) {

  if (sonosWindow) {
    let title = ipcRenderer.sendSync('SonosUnderstand');
    if (title) {
      spotifyPlaylist(data, client, player, title);
      return;
    }
  }

  Avatar.askme("Qu'est ce que tu veux écouter ?|Tu veux quoi comme play list ?|Quel play list ?|Je mets quoi?|Je mets quel play list ?", data.client,
      {
          "*": "generic",
          "qu'est ce que je peux dire": "sommaire",
          "donnes-moi la liste": "list",
          "comme tu veux": "doit",
          "fais-toi plaisir": "doit",
          "terminer": "done"
      }, 0, function (answer, end) {

          if (answer && answer.indexOf('generic') != -1) {
              end(data.client);
              answer = answer.split(':')[1];

              if (sonosWindow)
                ipcRenderer.sendSync('SonosSpeech', answer);

              answer = SonosPlayerAPI.getSearchLexic(answer);
              if (sonosWindow)
                answer = ipcRenderer.sendSync('SonosUnderstand', answer);

              spotifyPlaylist(data, client, player, answer);
              return;
          }

          // Grammaire fixe
          switch(answer) {
            case "sommaire":
              end(data.client);
              Avatar.speak("Tu peux dire:", data.client, function(){
                Avatar.speak("Le nom d'une de tes play liste.", data.client, function(){
                  Avatar.speak("Donnes-moi la liste.", data.client, function(){
                    Avatar.speak("Comme tu veux ou fais toi plaisir.", data.client, function(){
                      Avatar.speak("ou terminé.", data.client, function(){
                        askSpotifyPlaylist(data, client, player);
                      });
                    });
                  });
                });
              });
              break;
            case "list":
              end(data.client);
              spotifyPlaylist(data, client, player, "list");
              break;
            case "doit":
              end(data.client);
              spotifyPlaylist(data, client, player, true);
              break;
            case "done":
            default:
                Avatar.speak("Terminé", data.client, function(){
                    end(data.client, true);
                });
         }
      })
}



function spotifyPlaylist(data, client, player, answered) {

    let albumsMatched = [];
    SpotifyPlaylistsAPI.searchUserPlaylists()
    .then(albums => SonosPlayerAPI.searchSpotifyAlbumByName (albums, answered, albumsMatched))
    .then(albums => {
        return new Promise((resolve, reject) => {
            if (typeof answered === 'boolean' && answered == true && albums.length > 0) {
              let pos = Math.floor(Math.random() * albums.length);
              answered = SonosPlayerAPI.getLexic(albums[pos].name || albums[pos].title);
              if (sonosWindow)
                  answered = ipcRenderer.sendSync('SonosSay', answered);
              Avatar.speak('Je mets '+answered, data.client, function() {
                  resolve(albums[pos]);
              });
              return;
            }

            let list;
            if (typeof answered === 'string' && answered == 'list' && albums.length > 0) {
              list = true;
              albumsMatched = albums;
            }

            if (albumsMatched.length == 0)
              return resolve(0);

            albumsMatched = _.uniq(albumsMatched);

            if (albumsMatched.length > 1)  {
              let tts = 'J\'ai trouvé '+albumsMatched.length+' playlist';
              if (answered != 'list') {
                answered = SonosPlayerAPI.getLexic(answered);
                if (sonosWindow)
                      answered = ipcRenderer.sendSync('SonosSay', answered);
                tts += ' pour '+answered;
              }
              Avatar.speak(tts, data.client, () => {
                searchForMultipleAlbums (data, albumsMatched, 0, list, (item) => {
                   resolve(item);
                });
              });
              return;
            }

            if (sonosWindow
                && ((albumsMatched[0].name && albumsMatched[0].name.toLowerCase() != answered.toLowerCase())
                || (albumsMatched[0].title && albumsMatched[0].title.toLowerCase() != answered.toLowerCase()))) {
                answered = ipcRenderer.sendSync('SonosUnderstand', albumsMatched[0].name || albumsMatched[0].title);
            }

            answered = SonosPlayerAPI.getLexic(answered);
            if (sonosWindow)
                answered = ipcRenderer.sendSync('SonosSay', answered);

            Avatar.speak('Je mets '+answered, data.client, function() {
                resolve(albumsMatched[0]);
            });
        })
    })
    .then(item => playMusic(data, client, player.device, item, true))
    .then(state => {
        if (state && typeof state === 'boolean') {
            if (Avatar.isMobile(data.client))
                Avatar.Socket.getClientSocket(data.client).emit('askme_done');
            else
                Avatar.Speech.end(data.client);
        } else {
            Avatar.speak("Je suis désolé, je n'ai pas trouvé ce que tu demandes", data.client, function(){
              if (Avatar.isMobile(data.client))
                  Avatar.Socket.getClientSocket(data.client).emit('askme_done');
              else
                  Avatar.Speech.end(data.client);
            });
        }
    })
    .catch(err => {
        let tts = "Je suis désolé, j'ai rencontré une erreur."
        Avatar.speak(tts, data.client, function(){
          if (Avatar.isMobile(data.client))
              Avatar.Socket.getClientSocket(data.client).emit('askme_done');
          else
            Avatar.Speech.end(data.client);
        });
        console.log('Spotify Playlists:', err);
    });
}



function askSpotifyAlbums(data, client, player) {

  if (sonosWindow) {
    let title = ipcRenderer.sendSync('SonosUnderstand');
    if (title) {
      spotifyAlbums(data, client, player, title);
      return;
    }
  }

  Avatar.askme("Qu'est ce que tu veux écouter ?|Tu veux quoi comme album ?|Quel album ?|Je mets quoi?|Je mets quel album ?", data.client,
      {
          "*": "generic",
          "qu'est ce que je peux dire":  "sommaire",
          "donnes-moi la liste": "list",
          "comme tu veux": "doit",
          "fais-toi plaisir": "doit",
          "terminer": "done"
      }, 0, function (answer, end) {

          if (answer && answer.indexOf('generic') != -1) {
              end(data.client);
              answer = answer.split(':')[1];

              if (sonosWindow)
                ipcRenderer.sendSync('SonosSpeech', answer);

              answer = SonosPlayerAPI.getSearchLexic(answer);
              if (sonosWindow)
                answer = ipcRenderer.sendSync('SonosUnderstand', answer);

              spotifyAlbums(data, client, player, answer);
              return;
          }

          // Grammaire fixe
          switch(answer) {
            case "sommaire":
              end(data.client);
              Avatar.speak("Tu peux dire:", data.client, function(){
                Avatar.speak("Le nom d'une de tes play liste.", data.client, function(){
                  Avatar.speak("Donnes-moi la liste.", data.client, function(){
                    Avatar.speak("Comme tu veux ou fais toi plaisir.", data.client, function(){
                      Avatar.speak("ou terminé.", data.client, function(){
                        askSpotifyAlbums(data, client, player);
                      });
                    });
                  });
                });
              });
              break;
            case "list":
              end(data.client);
              spotifyAlbums(data, client, player, "list");
              break;
            case "doit":
              end(data.client);
              spotifyAlbums(data, client, player, true);
              break;
            case "done":
            default:
                Avatar.speak("Terminé", data.client, function(){
                    end(data.client, true);
                });
         }

      })

}



function spotifyAlbums(data, client, player, answered) {

    let albumsMatched = [];
    SpotifyAlbumsAPI.searchUserAlbums()
    .then(albums => SonosPlayerAPI.searchSpotifyAlbumByName (albums, answered, albumsMatched))
    .then(albums => SonosPlayerAPI.searchSpotifyAlbumByArtist (albums, answered, albumsMatched))
    .then(albums => {
        return new Promise((resolve, reject) => {

            if (typeof answered === 'boolean' && answered == true && albums.length > 0) {
              let pos = Math.floor(Math.random() * albums.length);
              answered = SonosPlayerAPI.getLexic(albums[pos].name || albums[pos].title);
              if (sonosWindow)
                  answered = ipcRenderer.sendSync('SonosSay', answered);
              Avatar.speak('Je mets '+answered, data.client, function() {
                  resolve(albums[pos]);
              });
              return;
            }

            let list;
            if (typeof answered === 'string' && answered == 'list' && albums.length > 0) {
              list = true;
              albumsMatched = albums;
            }

            if (albumsMatched.length == 0)
              return resolve(0);

            albumsMatched = _.uniq(albumsMatched);

            if (albumsMatched.length > 1)  {
              let tts = 'J\'ai trouvé '+albumsMatched.length+' albums.';
              if (answered != 'list') {
                answered = SonosPlayerAPI.getLexic(answered);
                if (sonosWindow)
                      answered = ipcRenderer.sendSync('SonosSay', answered);
                tts += ' pour '+answered;
              }

              Avatar.speak(tts, data.client, () => {
                searchForMultipleAlbums (data, albumsMatched, 0, list, (item) => {
                   resolve(item);
                });
              });
              return;
            }

            if (sonosWindow
                && ((albumsMatched[0].name && albumsMatched[0].name.toLowerCase() != answered.toLowerCase())
                || (albumsMatched[0].title && albumsMatched[0].title.toLowerCase() != answered.toLowerCase()))) {
                answered = ipcRenderer.sendSync('SonosUnderstand', albumsMatched[0].name || albumsMatched[0].title);
            }

            answered = SonosPlayerAPI.getLexic(answered);
            if (sonosWindow)
                answered = ipcRenderer.sendSync('SonosSay', answered);

            Avatar.speak('Je mets '+answered, data.client, function() {
                resolve(albumsMatched[0]);
            });
        })
    })
    .then(item => playMusic(data, client, player.device, item, true))
    .then(state => {
        if (state && typeof state === 'boolean') {
            if (Avatar.isMobile(data.client))
                Avatar.Socket.getClientSocket(data.client).emit('askme_done');
            else
                Avatar.Speech.end(data.client);
        } else {
            Avatar.speak("Je suis désolé, je n'ai pas trouvé ce que tu demandes", data.client, function(){
              if (Avatar.isMobile(data.client))
                  Avatar.Socket.getClientSocket(data.client).emit('askme_done');
              else
                  Avatar.Speech.end(data.client);
            });
        }
    })
    .catch(err => {
        let tts = "Je suis désolé, j'ai rencontré une erreur."
        Avatar.speak(tts, data.client, function(){
          if (Avatar.isMobile(data.client))
              Avatar.Socket.getClientSocket(data.client).emit('askme_done');
          else
            Avatar.Speech.end(data.client);
        });
        console.log("Spotyfy Albums:", err);
    });
}



function searchForMultipleAlbums (data, albums, pos, list, callback) {

  if (pos == albums.length)
    return Avatar.speak('j\'ai atteint la fin de la liste.', data.client, function() {
      searchForMultipleAlbums (data, albums, --pos, list, callback);
    });

  if (pos < 0)
    return Avatar.speak('j\'ai atteint le début de la liste.', data.client, function() {
      searchForMultipleAlbums (data, albums, ++pos, list, callback);
    });

  let name = SonosPlayerAPI.getLexic(albums[pos].name || albums[pos].title || 'Sans nom');
  let artiste;
  if (list && albums[pos].artists && albums[pos].artists[0])
    artiste = SonosPlayerAPI.getLexic(albums[pos].artists[0].name);
  else
    list = null;

  let tts = !list ? name : name+" de "+artiste;
  Avatar.askme(tts, data.client,
      {
          "suivant": "next",
          "précédent": "previous",
          "vas à la fin": "end",
          "vas au milieu": "middle",
          "vas au début": "begin",
          "retourne au début": "begin",
          "mets-le": "putit",
          "c'est bon": "putit",
          "ok": "putit",
          "vas-y mets-le": "putit",
          "comme tu veux": "doit",
          "fais-toi plaisir": "doit",
          "terminer": "done"
      }, 0, function (answer, end) {

          switch(answer) {
            case "sommaire":
              end(data.client);
              Avatar.speak("Tu peux dire:", data.client, function(){
                Avatar.speak("Suivant ou Précédent.", data.client, function(){
                  Avatar.speak("Vas au début, au milieu ou à la fin.", data.client, function(){
                    Avatar.speak("Mets-le, c'est bon ou ok.", data.client, function(){
                      Avatar.speak("Comme tu veux ou fais toi plaisir.", data.client, function(){
                        Avatar.speak("ou terminé.", data.client, function(){
                          searchForMultipleAlbums (data, albums, pos, list, callback);
                        });
                      });
                    });
                  });
                });
              });
              break;
            case "next":
              end(data.client);
              searchForMultipleAlbums (data, albums, ++pos, list, callback);
              break;
            case "previous":
              end(data.client);
              searchForMultipleAlbums (data, albums, --pos, list, callback);
              break;
            case "end":
              end(data.client);
              searchForMultipleAlbums (data, albums, (albums.length - 1), list, callback);
              break;
            case "begin":
              end(data.client);
              searchForMultipleAlbums (data, albums, 0, list, callback);
              break;
            case "middle":
              end(data.client);
              searchForMultipleAlbums (data, albums, (Math.floor(albums.length / 2)), list, callback);
              break;
            case "putit":
              end(data.client);
              answer = SonosPlayerAPI.getLexic(albums[pos].name || albums[pos].title);
              Avatar.speak('Je mets '+answer, data.client, function() {
                  callback(albums[pos]);
              });
              break;
            case "doit":
              end(data.client);
              pos = Math.floor(Math.random() * albums.length);
              answer = SonosPlayerAPI.getLexic(albums[pos].name || albums[pos].title);
              Avatar.speak('Je mets '+answer, data.client, function() {
                  callback(albums[pos]);
              });
              break;
            case "done":
            default:
                Avatar.speak("Terminé", data.client, function(){
                    end(data.client, true);
                });
         }
      });
}




function wakeUpMusic (data, client, searchType, searchTerm, callback) {

  let player =  _.find(devices, function(num){
      return num.id == client;
  });

  if (player) {
      // searchType = artists, albumArtists, albums, genres, composers, tracks, playlists
      // searchTerm = 'null' pour tout ou un critère
      switch (searchType) {
        case 'radio':
              player.device.getFavoritesRadioStations().then(list => {
                  if (!list || !list.items || list.returned == 0)
                      return callback ? callback() : null;

                  list.items = _.filter(list.items, (num) => {
                      return num.title.toLowerCase() == searchTerm.toLowerCase();
                  });
                  list.returned = list.items.length;

                  if (list.returned == 0)
                      return callback ? callback() : null;

                  playMusic(data, client, player.device, list.items[0])
                  .then (state =>  {
                    transportClosure(client, function() {
                        if (callback) callback();
                    });
                  })
                  .catch (err => {
                    if (callback) callback();
                  });
                }).catch(err => {
                   if (callback) callback();
                });
                break;
          default:
                player.device.searchMusicLibrary(searchType, ((searchTerm != 'null') ? searchTerm : null)).then(list => {
                  if (!list || !list.items)
                    return callback ? callback() : null;

                  playMusic(data, client, player.device, list.items[Math.floor(Math.random() * list.items.length)])
                  .then (state =>  {
                    transportClosure(client, function() {
                        if (callback) callback();
                    });
                  })
                  .catch (err => {
                    if (callback) callback();
                  });
                }).catch(err => {
                   if (callback) callback();
                });
                break;
      }
  }

}




function getRandomMusicLibrary (data, device, type) {

    return new Promise((resolve, reject) => {
      device.getMusicLibrary(type).then(list => {
          if (!list || !list.items || list.returned == 0)
              return resolve(0);

          let item = list.items[Math.floor(Math.random() * list.items.length)];
          let answered;
          if (sonosWindow)
              answered = ipcRenderer.sendSync('SonosUnderstand', item.name || item.title);

          answered = SonosPlayerAPI.getLexic(item.name || item.title);
          if (sonosWindow)
              answered = ipcRenderer.sendSync('SonosSay', answered);

          Avatar.speak('Je met ' + answered, data.client, () => {
              resolve(item);
          });
      }).catch(err => {
          reject (err);
      });
    });
}



function getMusicLibrary (device, searchTerm) {

    return new Promise((resolve, reject) => {
        device.getMusicLibrary('sonos_playlists').then(list => {
            if (!list || !list.items || list.returned == 0)
                return resolve(0);

            list.items = SonosPlayerAPI.matchTerm(list.items, searchTerm);
            list.returned = list.items.length;

            if (list.returned == 0)
                return resolve(0);

            resolve(list.items);
        }).catch(err => {
            reject(err);
        });
    });

}



function searchFavorites(item, device, searchTerm) {

  return new Promise((resolve, reject) => {

      if (typeof item === 'number' && item == 0) {
        device.getFavorites().then(list => {
            if (!list || !list.items || list.returned == 0)
                return resolve(0);

            list.items = SonosPlayerAPI.matchTerm(list.items, searchTerm);
            list.returned = list.items.length;

            if (list.returned == 0)
                return resolve(0);

            resolve(list.items);
        }).catch(err => {
            reject (err);
        });

      } else {
          resolve(item);
      }
  });


}




function searchMusicLibraries (item, device, searchPos, searchTerm) {
    return new Promise((resolve, reject) => {
        if (typeof item === 'number' && item == 0) {
            searchMusicLibrary(device, 0, searchTerm, (item) => {

                if (item == null || (item && (typeof item === 'object' &&  item.length > 0 && !item[0].uri)))
                    return reject(item);

                resolve (item);
            });
        } else {
            resolve(item);
        }
    });
}


function searchMusicLibrary (device, searchPos, searchTerm, callback) {

    let searchTypes = Config.modules.SonosPlayer.musicTypes.search;
    if (searchPos == searchTypes.length)
        return callback(0);

    device.searchMusicLibrary(searchTypes[searchPos], searchTerm, {}).then( list => {

        if (!list || (!list.items && list.length == 0) || (list.items && list.items.length == 0))
            return searchMusicLibrary (device, ++searchPos, searchTerm, callback);

        list.items = SonosPlayerAPI.matchTerm(list.items || list, searchTerm);
        list.returned = list.items.length;
        if (list.returned == 0)
            return searchMusicLibrary (device, ++searchPos, searchTerm, callback);

        return callback(list.items || list);
    }).catch(err => {
        return callback(err);
    });

}



function previousMusic (data, client) {

  let player =  _.find(devices, function(num){
      return num.id == client;
  });

  if (!player) {
    Avatar.speak("je suis désolé, je ne trouve pas de playeur " + client, data.client, function() {
      Avatar.Speech.end(data.client);
    });
    return;
  }

  let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
      return client == num;
  });

  let mapped = _.find(Config.default.mapping, function(num){
    return client == num.split(',')[0];
  });

  if ((data.client == client && !mapped) || (data.client == client && mapped && serverSpeak) || (data.client == client && Avatar.isMobile(data.client) && Avatar.Socket.isServerSpeak(data.client))) {
      getBackupPreset (data.client)
      .then (clientBackupPreset => {
        if (!clientBackupPreset) {
          Avatar.speak("je n'ai pas pu récupérer la liste de lecture.", data.client, function() {
              Avatar.Speech.end(data.client);
          });
          return;
        }

        if (clientBackupPreset.mediaInfo.uri.indexOf('x-sonos-htastream:') == -1 && clientBackupPreset.mediaInfo.uri.indexOf('mp3radio:') == -1) {
            player.device.getQueue().then((list) => {
                if (!list || !list.items || list.items.length == 0) {
                  Avatar.speak("La liste de lecture est vide.", data.client, function() {
                      Avatar.Speech.end(data.client);
                  });
                  return;
                }

                if (clientBackupPreset.mediaInfo.queuePosition > 1) {
                  clientBackupPreset.mediaInfo.uri = list.items[clientBackupPreset.mediaInfo.queuePosition -1].uri;
                  clientBackupPreset.mediaInfo.queuePosition -= 1;
                  clientBackupPreset.mediaInfo.position = 0;
                  Avatar.speak("C'est fait", data.client, function() {
                      Avatar.Speech.end(data.client);
                  });
                  return;
                }

                Avatar.speak("Il n'y a pas de musique précédente.", data.client, function() {
                    Avatar.Speech.end(data.client);
                });
            })
        } else {
          Avatar.speak("Pardon mais depuis quand je peux mettre une musique précédente sur la " + (clientBackupPreset.mediaInfo.uri.indexOf('x-sonos-htastream:') != -1 ? " télévision ?" : " radio ?"), data.client, function() {
              Avatar.Speech.end(data.client);
          });
        }
    })
  } else {
    player.device.getCurrentState()
    .then((state) => {
        if (state === 'playing' || state === 'transitioning') {
          player.device.avTransportService().CurrentTrack().then((mediaInfo) => {
              if (mediaInfo.uri.indexOf('x-sonos-htastream:') == -1 && mediaInfo.uri.indexOf('mp3radio:') == -1) {
                player.device.getQueue().then((list) => {
                    if (!list || !list.items || list.items.length == 0) {
                      Avatar.speak("La liste de lecture est vide.", data.client, function() {
                          Avatar.Speech.end(data.client);
                      });
                      return;
                    }

                    if (mediaInfo.queuePosition > 1) {
                       player.device.previous();
                       Avatar.speak("C'est fait", data.client, function() {
                           Avatar.Speech.end(data.client);
                       });
                       return;
                     }

                     Avatar.speak("Il n'y a pas de musique précédente.", data.client, function() {
                         Avatar.Speech.end(data.client);
                     });

                  })
              } else {
                Avatar.speak("Pardon mais depuis quand je peux mettre une musique précédente sur la " + (clientBackupPreset.mediaInfo.uri.indexOf('x-sonos-htastream:') != -1 ? " télévision ?" : " radio ?"), data.client, function() {
                    Avatar.Speech.end(data.client);
                });
              }
          });
        } else {
            Avatar.speak("Il n'y a pas de musique en cours de lecture dans la pièce "+client, data.client, function() {
                Avatar.Speech.end(data.client);
            });
        }
    });
  }

}



function nextMusic (data, client) {

  let player =  _.find(devices, function(num){
      return num.id == client;
  });

  if (!player) {
    Avatar.speak("je suis désolé, je ne trouve pas de playeur " + client, data.client, function() {
      Avatar.Speech.end(data.client);
    });
    return;
  }

  let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
      return client == num;
  });

  let mapped = _.find(Config.default.mapping, function(num){
    return client == num.split(',')[0];
  });

  if ((data.client == client && !mapped) || (data.client == client && mapped && serverSpeak) || (data.client == client && Avatar.isMobile(data.client) && Avatar.Socket.isServerSpeak(data.client))) {
      getBackupPreset (data.client).then (clientBackupPreset => {
        if (!clientBackupPreset) {
          Avatar.speak("je n'ai pas pu récupérer la liste de lecture.", data.client, function() {
              Avatar.Speech.end(data.client);
          });
          return;
        }

        if (clientBackupPreset.mediaInfo.uri.indexOf('x-sonos-htastream:') == -1 && clientBackupPreset.mediaInfo.uri.indexOf('mp3radio:') == -1) {
            player.device.getQueue().then((list) => {
                if (!list || !list.items || list.items.length == 0) {
                  Avatar.speak("La liste de lecture est vide.", data.client, function() {
                      Avatar.Speech.end(data.client);
                  });
                  return;
                }

                if (clientBackupPreset.mediaInfo.queuePosition < list.items.length) {
                  clientBackupPreset.mediaInfo.uri = list.items[clientBackupPreset.mediaInfo.queuePosition + 1].uri;
                  clientBackupPreset.mediaInfo.queuePosition += 1;
                  clientBackupPreset.mediaInfo.position = 0;
                  Avatar.speak("C'est fait", data.client, function() {
                      Avatar.Speech.end(data.client);
                  });
                  return;
                }

                Avatar.speak("Il n'y a pas de musique suivante.", data.client, function() {
                    Avatar.Speech.end(data.client);
                });
            })
        } else {
          Avatar.speak("Pardon mais depuis quand je peux mettre une musique suivante sur la " + (clientBackupPreset.mediaInfo.uri.indexOf('x-sonos-htastream:') != -1 ? " télévision ?" : " radio ?"), data.client, function() {
              Avatar.Speech.end(data.client);
          });
        }
    })
  } else {
    player.device.getCurrentState()
    .then((state) => {
        if (state === 'playing' || state === 'transitioning') {
          player.device.avTransportService().CurrentTrack().then((mediaInfo) => {
              if (mediaInfo.uri.indexOf('x-sonos-htastream:') == -1 && mediaInfo.uri.indexOf('mp3radio:') == -1) {
                player.device.getQueue().then((list) => {
                    if (!list || !list.items || list.items.length == 0) {
                      Avatar.speak("La liste de lecture est vide.", data.client, function() {
                          Avatar.Speech.end(data.client);
                      });
                      return;
                    }

                    if (mediaInfo.queuePosition < list.items.length) {
                       player.device.next();
                       Avatar.speak("C'est fait", data.client, function() {
                           Avatar.Speech.end(data.client);
                       });
                       return;
                     }

                     Avatar.speak("Il n'y a pas de musique suivante.", data.client, function() {
                         Avatar.Speech.end(data.client);
                     });

                  })
              } else {
                Avatar.speak("Pardon mais depuis quand je peux mettre une musique suivante sur la " + (mediaInfo.uri.indexOf('x-sonos-htastream:') != -1 ? " télévision ?" : " radio ?"), data.client, function() {
                    Avatar.Speech.end(data.client);
                });
              }
          });
        } else {
            Avatar.speak("Il n'y a pas de musique en cours de lecture dans la pièce "+client, data.client, function() {
                Avatar.Speech.end(data.client);
            });
        }
    });
  }
}



function playList (data, client) {

  let player =  _.find(devices, function(num){
      return num.id == client;
  });

  if (!player) {
    Avatar.speak("je suis désolé, je ne trouve pas de playeur " + client, data.client, function() {
      Avatar.Speech.end(data.client);
    });
    return;
  }

  let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
      return client == num;
  });

  let mapped = _.find(Config.default.mapping, function(num){
    return client == num.split(',')[0];
  });

  if ((data.client == client && !mapped) || (data.client == client && mapped && serverSpeak) || (data.client == client && Avatar.isMobile(data.client) && Avatar.Socket.isServerSpeak(data.client))) {
      getBackupPreset (data.client)
      .then (clientBackupPreset => {
        if (!clientBackupPreset) {
          Avatar.speak("je n'ai pas pu récupérer la liste de lecture.", data.client, function() {
              Avatar.Speech.end(data.client);
          });
          return;
        }

        player.device.getQueue().then((list) => {
            if (!list || !list.items || list.items.length == 0) {
              Avatar.speak("La liste de lecture est vide.", data.client, function() {
                  Avatar.Speech.end(data.client);
              });
              return;
            }

            clientBackupPreset.mediaInfo.uri = list.items[0].uri;
            clientBackupPreset.mediaInfo.queuePosition = 1;
            clientBackupPreset.mediaInfo.position = 0;
            clientBackupPreset.state = true;
            clientBackupPreset.muted = false;

            Avatar.speak("C'est fait", data.client, function() {
                Avatar.Speech.end(data.client);
            });
        })
      })
    } else {
        player.device.getQueue()
        .then((list) => {
          if (!list || !list.items || list.items.length == 0) {
            Avatar.speak("La liste de lecture est vide.", data.client, function() {
                Avatar.Speech.end(data.client);
            });
            return;
          }

          player.device.selectQueue().then((state) => {
              player.device.play()
              .then(() => {
                Avatar.speak("C'est fait", data.client, function() {
                  Avatar.Speech.end(data.client);
                });
              })
              .catch(err => {
              	 console.log('Sonos PlayList error:', err);
                  Avatar.speak("je suis désolé. j'ai rencontré une erreur.", data.client, function() {
                    Avatar.Speech.end(data.client);
                  });
          	  });
          }).catch(err => {
              console.log('Sonos PlayList error:', err);
              Avatar.speak("je suis désolé. j'ai rencontré une erreur.", data.client, function() {
                Avatar.Speech.end(data.client);
              });
          });
        })
    }

}



function isServerSpeak(client) {
    Avatar.Socket.isServerSpeak(client)
}



function tvSound (data, client) {

  let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
      return client == num;
  });

  let mapped = _.find(Config.default.mapping, function(num){
    return client == num.split(',')[0];
  });

  if ((data.client == client && !mapped) || (data.client == client && mapped && serverSpeak) || (data.client == client && Avatar.isMobile(data.client) && Avatar.Socket.isServerSpeak(data.client))) {
      getBackupPreset (data.client)
      .then (clientBackupPreset => {
        if (!clientBackupPreset) {
          Avatar.speak("je n'ai pas pu récupérer la liste de lecture.", data.client, function() {
              Avatar.Speech.end(data.client);
          });
          return;
        }

        let player =  _.find(devices, function(num){
            return num.id == clientBackupPreset.players[0].roomName && num.type == 'Playbar';
        });

        if (player) {
            if (clientBackupPreset.mediaInfo.uri && clientBackupPreset.mediaInfo.uri.indexOf('x-sonos-htastream:') == -1) {
                let uri = clientBackupPreset.UDN.replace("uuid","x-sonos-htastream");
                uri = uri+":spdif";

                clientBackupPreset.mediaInfo.uri = uri;
                clientBackupPreset.state = true;
                clientBackupPreset.muted = false;

                Avatar.speak("C'est fait", data.client, function() {
                  Avatar.Speech.end(data.client);
                });
            } else {
              Avatar.speak("La télé est déjà sur la play bar", data.client, function() {
                Avatar.Speech.end(data.client);
              })
            }
        } else {
            Avatar.speak("Je suis désolé mais tu ne dois pas donner la bonne pièce pour la télé", data.client, function() {
                  Avatar.Speech.end(data.client);
            })
        }
      })
      .catch(() => {
          console.log('Sonos tvSound:', err);
          Avatar.speak("je suis désolé. j'ai rencontré une erreur.", data.client, function() {
            Avatar.Speech.end(data.client);
          });
      });
    } else {
      let player =  _.find(devices, function(num){
          return num.id == client && num.type == 'Playbar';
      });

      if (player) {
        player.device.avTransportService().CurrentTrack().then((mediaInfo) => {
            if (mediaInfo.uri && mediaInfo.uri.indexOf('x-sonos-htastream:') == -1) {
                let uri = player.UDN.replace("uuid","x-sonos-htastream");
                uri = uri+":spdif";
                player.device.setAVTransportURI({ uri: uri})
                .then(() => {
                  Avatar.speak("C'est fait", data.client, function() {
                    Avatar.Speech.end(data.client);
                  });
                })
                .catch(err => {
                    console.log('Sonos tvSound:', err);
                    Avatar.speak("je suis désolé. j'ai rencontré une erreur.", data.client, function() {
                      Avatar.Speech.end(data.client);
                    });
                });
            } else {
              Avatar.speak("La télé est déjà sur la play bar", data.client, function() {
                Avatar.Speech.end(data.client);
              })
            }
          })
      } else {
        Avatar.speak("Je suis désolé mais tu ne dois pas donner la bonne pièce pour la télé", data.client, function() {
              Avatar.Speech.end(data.client);
        })
      }
    }

}





function addAlbumToSpotifyLibrary (data, client, player) {

  let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
      return client == num;
  });

  let mapped = _.find(Config.default.mapping, function(num){
    return client == num.split(',')[0];
  });

  if ((data.client == client && !mapped) || (data.client == client && mapped && serverSpeak) || (data.client == client && Avatar.isMobile(data.client) && Avatar.Socket.isServerSpeak(data.client))) {
      getBackupPreset (data.client)
      .then (clientBackupPreset => {
        if (!clientBackupPreset) {
          Avatar.speak("je n'ai pas pu récupérer la liste de lecture.", data.client, function() {
              Avatar.Speech.end(data.client);
          });
          return;
        }

        if (clientBackupPreset.mediaInfo.uri && clientBackupPreset.mediaInfo.uri.indexOf('x-sonos-spotify') != -1) {
          if (clientBackupPreset.mediaInfo.artist && clientBackupPreset.mediaInfo.album) {
            SpotifySearchAPI.addAlbumToLibrary(clientBackupPreset.mediaInfo.artist, clientBackupPreset.mediaInfo.album)
            .then(state => {
                let tts = (state)
                ? "J'ai ajouté l'album "+SonosPlayerAPI.getLexic(clientBackupPreset.mediaInfo.album)+" dans tes albums Spoti faille."
                : "J'ai rencontré une erreur, je n'ai pas pu ajouter "+SonosPlayerAPI.getLexic(clientBackupPreset.mediaInfo.album)+" dans tes albums Spoti faille."

                Avatar.speak(tts, data.client, function() {
                  Avatar.Speech.end(data.client);
                });
            })
          } else {
            Avatar.speak("Je suis désolé. Il me manque l'artiste pour pouvoir l'ajouter.", data.client, function() {
              Avatar.Speech.end(data.client);
            });
          }
        } else {
          Avatar.speak("Je suis désolé, je ne peux ajouter que des albums spoti faille.", data.client, function() {
            Avatar.Speech.end(data.client);
          });
        }
      })
    } else {
      player.device.currentTrack()
      .then((infos) => {
        if (infos.uri && infos.uri.indexOf('x-sonos-spotify') != -1) {
          if (infos.artist && infos.album) {
              SpotifySearchAPI.addAlbumToLibrary(infos.artist, infos.album)
              .then(state => {
                  let tts = (state)
                  ? "J'ai ajouté l'album "+SonosPlayerAPI.getLexic(infos.album)+" dans tes albums Spoti faille."
                  : "J'ai rencontré une erreur, je n'ai pas pu ajouter "+SonosPlayerAPI.getLexic(infos.album)+" dans tes albums Spoti faille."

                  Avatar.speak(tts, data.client, function() {
                    Avatar.Speech.end(data.client);
                  });
              })
            } else {
              Avatar.speak("Je suis désolé. Il me manque l'artiste pour pouvoir l'ajouter.", data.client, function() {
                Avatar.Speech.end(data.client);
              });
            }
        } else {
          Avatar.speak("Je suis désolé, je ne peux ajouter que des albums spoti faille.", data.client, function() {
            Avatar.Speech.end(data.client);
          });
        }
      })
      .catch(err => {
        console.log('Sonos addAlbumToSpotifyLibrary', err);
        Avatar.speak("je suis désolé. j'ai rencontré une erreur.", data.client, function() {
            Avatar.Speech.end(data.client);
        });
      });
    }
}


function currentTrack (data, client) {

  let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
      return client == num;
  });

  let mapped = _.find(Config.default.mapping, function(num){
    return client == num.split(',')[0];
  });

  if ((data.client == client && !mapped) || (data.client == client && mapped && serverSpeak) || (data.client == client && Avatar.isMobile(data.client) && Avatar.Socket.isServerSpeak(data.client))) {
      getBackupPreset (data.client)
      .then (clientBackupPreset => {
        if (!clientBackupPreset) {
          Avatar.speak("je n'ai pas pu récupérer la liste de lecture.", data.client, function() {
              Avatar.Speech.end(data.client);
          });
          return;
        }
        let tts="Rien du tout";
        if (clientBackupPreset.mediaInfo.uri.indexOf('x-sonos-htastream:') != -1) {
          tts="La télé";
        } else if (clientBackupPreset.mediaInfo.uri.indexOf('x-sonos-spotify:') != -1) {
          tts="Un striming alors je ne peux pas te dire.";
        } else if (clientBackupPreset.mediaInfo.uri.indexOf('mp3radio:') != -1) {
          tts="La radio";
        } else {
          if (clientBackupPreset.mediaInfo.title)
            tts = SonosPlayerAPI.getLexic(clientBackupPreset.mediaInfo.title);
          if (clientBackupPreset.mediaInfo.album) {
            tts += (clientBackupPreset.mediaInfo.queuePosition)
            ? '. Titre numéro '+clientBackupPreset.mediaInfo.queuePosition+' de l\'Album: '+SonosPlayerAPI.getLexic(clientBackupPreset.mediaInfo.album)
            : '. Album: ' + SonosPlayerAPI.getLexic(clientBackupPreset.mediaInfo.album);
          }
          if (clientBackupPreset.mediaInfo.artist)
            tts += '. Artiste: ' + SonosPlayerAPI.getLexic(clientBackupPreset.mediaInfo.artist);
        }
        Avatar.speak(tts, data.client, function() {
          Avatar.Speech.end(data.client);
        });
      })
      .catch(() => {
        console.log('Sonos error currentTrack');
        Avatar.speak("je suis désolé. Je ne sais pas.", data.client, function() {
          Avatar.Speech.end(data.client);
        });
      })

    } else {
      let player =  _.find(devices, function(num){
          return num.id == client;
      });

      if (player) {
        player.device.currentTrack()
        .then((infos) => {
            let tts="Rien du tout";
            if (infos.uri && infos.uri.indexOf('x-sonos-htastream') != -1) {
              tts="La télé"
            } else if (infos.uri.indexOf('x-sonos-spotify:') != -1) {
              tts="Un striming alors je ne peux pas te dire.";
            } else if (infos.uri.indexOf('mp3radio:') != -1) {
              tts="La radio";
            } else if (infos.uri) {
              if (infos.title)
                tts=SonosPlayerAPI.getLexic(infos.title);
              if (infos.album) {
                tts += (infos.queuePosition)
                ? '. Titre numéro '+infos.queuePosition+' de l\'Album: '+SonosPlayerAPI.getLexic(infos.album)
                : '. Album: '+SonosPlayerAPI.getLexic(infos.album);
              }
              if (infos.artist)
                tts += '. Artiste: '+SonosPlayerAPI.getLexic(infos.artist);
            }
            Avatar.speak(tts, data.client, function() {
              Avatar.Speech.end(data.client);
            });
          })
          .catch(err => {
            console.log('Sonos currentTrack', err);
            Avatar.speak("je suis désolé. Je ne sais pas.", data.client, function() {
              Avatar.Speech.end(data.client);
            });
          })
      } else {
        Avatar.speak("je suis désolé, je ne trouve pas de playeur " + client, data.client, function() {
            Avatar.Speech.end(data.client);
        });
      }
    }
}


function volumeDown (data, client, value) {

  let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
      return client == num;
  });

  let mapped = _.find(Config.default.mapping, function(num){
    return client == num.split(',')[0];
  });

  if ((data.client == client && !mapped) || (data.client == client && mapped && serverSpeak) || (data.client == client && Avatar.isMobile(data.client) && Avatar.Socket.isServerSpeak(data.client))) {
      getBackupPreset (data.client)
      .then (clientBackupPreset => {
        if (!clientBackupPreset) {
          Avatar.speak("je n'ai pas pu récupérer la liste de lecture.", data.client, function() {
              Avatar.Speech.end(data.client);
          });
          return;
        }

        clientBackupPreset.volume -= value;
        Avatar.speak("C'est fait", data.client, function() {
          Avatar.Speech.end(data.client);
        });
      })
    } else {

      let player =  _.find(devices, function(num){
          return num.id == client;
      });

      if (player) {
        player.device.getVolume()
        .then((volume) => {
          volume -= value;
          player.device.setVolume(volume)
          .then(() => {
            Avatar.speak("C'est fait", data.client, function() {
              Avatar.Speech.end(data.client);
            });
          })
          .catch(err => {
              console.log('Sonos volumeDown:', err);
              Avatar.speak("je suis désolé. j'ai rencontré une erreur.", data.client, function() {
                Avatar.Speech.end(data.client);
              });
          });
        });
      } else {
        Avatar.speak("je suis désolé, je ne trouve pas de playeur " + client, data.client, function() {
            Avatar.Speech.end(data.client);
        });
      }
    }
}



function volumeUp (data, client, value) {

  let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
      return client == num;
  });

  let mapped = _.find(Config.default.mapping, function(num){
    return client == num.split(',')[0];
  });

  if ((data.client == client && !mapped) || (data.client == client && mapped && serverSpeak) || (data.client == client && Avatar.isMobile(data.client) && Avatar.Socket.isServerSpeak(data.client))) {
      getBackupPreset (data.client)
      .then (clientBackupPreset => {
        if (!clientBackupPreset) {
          Avatar.speak("je n'ai pas pu récupérer la liste de lecture.", data.client, function() {
              Avatar.Speech.end(data.client);
          });
          return;
        }

        clientBackupPreset.volume += value;
        Avatar.speak("C'est fait", data.client, function() {
          Avatar.Speech.end(data.client);
        });
      })
    } else {

      let player =  _.find(devices, function(num){
          return num.id == client;
      });

      if (player) {
        player.device.getVolume()
        .then((volume) => {
          volume += value;
          player.device.setVolume(volume)
          .then(() => {
            Avatar.speak("C'est fait", data.client, function() {
              Avatar.Speech.end(data.client);
            });
          })
          .catch(err => {
              console.log('Sonos volumeUp:', err);
              Avatar.speak("je suis désolé. j'ai rencontré une erreur.", data.client, function() {
                Avatar.Speech.end(data.client);
              });
          });
        });
      } else {
        Avatar.speak("je suis désolé, je ne trouve pas de playeur " + client, data.client, function() {
            Avatar.Speech.end(data.client);
        });
      }
    }

}



function muteMusic (data, client, muted) {

  let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
      return client == num;
  });

  let mapped = _.find(Config.default.mapping, function(num){
    return client == num.split(',')[0];
  });

  if ((data.client == client && !mapped) || (data.client == client && mapped && serverSpeak) || (data.client == client && Avatar.isMobile(data.client) && Avatar.Socket.isServerSpeak(data.client))) {
        getBackupPreset (data.client)
        .then(clientBackupPreset => setBackupPresetMuted(clientBackupPreset, muted))
        .then((clientBackupPreset) => {
            if (!clientBackupPreset) {
              console.log('Sonos mute error', 'Pas de client');
              return Avatar.speak("Il n'y a pas de client " + data.client, data.client, function() {
                Avatar.Speech.end(data.client);
              });
            }
            Avatar.speak("C'est fait", data.client, function() {
              Avatar.Speech.end(data.client);
            });
        })
        .catch(() => {
          console.log('Sonos error muteMusic');
          Avatar.speak("je suis désolé. j'ai rencontré une erreur.", data.client, function() {
            Avatar.Speech.end(data.client);
          });
        })
    } else {
      let player =  _.find(devices, function(num){
          return num.id == client;
      });

      if (player) {
        player.device.getCurrentState()
        .then((state) => {
           if (state === 'playing' || state === 'transitioning')
              player.device.setMuted(muted)
              .catch(err => {
                console.log('Sonos mute error', err);
              })
              .then(() => {
                Avatar.speak("C'est fait", data.client, function() {
                  Avatar.Speech.end(data.client);
                });
              })
        })
      } else {
        Avatar.speak("je suis désolé, je ne trouve pas de playeur " + client, data.client, function() {
            Avatar.Speech.end(data.client);
        });
      }
    }

}




function getBackupPreset (client) {

  return new Promise((resolve, reject) => {

    let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
        return client == num;
    });

    if ((Avatar.isMobile(client) && !Avatar.Socket.isServerSpeak(client)) || (!Avatar.isMobile(client) && !serverSpeak)) {
        if (backupPreset.clients && backupPreset.clients.length > 0) {
          let client_backupPreset  = _.filter(backupPreset.clients, function(cl){
            return cl.players[0].roomName == client;
          });
          if (client_backupPreset.length > 0) {
            return resolve(client_backupPreset[0]);
          }
        } else
          return resolve();
    }

    client = Avatar.currentRoom ? Avatar.currentRoom : Config.default.client;

    if (backupPreset.clients && backupPreset.clients.length > 0) {
      let client_backupPreset  = _.filter(backupPreset.clients, function(cl){
        return cl.players[0].roomName == client;
      });

      if (client_backupPreset.length > 0) {
        return resolve(client_backupPreset[0]);
      }
    }

    let player =  _.find(devices, function(num){
        return num.id == client;
    });

    if (player) {
      player.device.getCurrentState().then((state) => {
        let wasPlaying = (state === 'playing' || state === 'transitioning');
        player.device.avTransportService().CurrentTrack().then(mediaInfo => {
            if (mediaInfo && mediaInfo.uri && mediaInfo.uri.indexOf("speech") == -1) {
              player.device.getMuted().then(muted => {
                player.device.getVolume().then(volume => {
                    backupPreset.clients.push({"players": [{"roomName": client}],
                      "state": wasPlaying,
                      "mediaInfo" : mediaInfo,
                      "volume": volume,
                      "muted": muted,
                      "UDN": player.UDN
                    });
                    let client_backupPreset  = _.filter(backupPreset.clients, function(cl){
                      return cl.players[0].roomName == client;
                    });
                    resolve(client_backupPreset[0]);
                })
              })
            } else {
              resolve();
            }
        })
        .catch(err => {
            player.device.getMuted().then(muted => {
              player.device.getVolume().then(volume => {
                      backupPreset.clients.push({"players": [{"roomName": client}],
                        "state": false,
                        "mediaInfo" : null,
                        "volume": volume,
                        "muted": muted,
                        "UDN": player.UDN
                      });
                      let client_backupPreset  = _.filter(backupPreset.clients, function(cl){
                        return cl.players[0].roomName == client;
                      });
                      resolve(client_backupPreset[0]);
                });
            });
        });
      });
    } else {
        resolve();
    }
  })
}



function setBackupPresetState (clientBackupPreset, state) {
  return new Promise((resolve, reject) => {
  		if (clientBackupPreset && clientBackupPreset.mediaInfo.uri.indexOf('x-sonos-htastream:') == -1) {
        clientBackupPreset.state = state;
      }
      resolve(clientBackupPreset);
  })
}


function setBackupPresetMuted (clientBackupPreset, state) {
  return new Promise((resolve, reject) => {
  		if (clientBackupPreset) {
        clientBackupPreset.muted = state;
      }
      resolve(clientBackupPreset);
  })
}



function stopList (data, client) {

  let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
      return client == num;
  });

  let mapped = _.find(Config.default.mapping, function(num){
    return client == num.split(',')[0];
  });

  if (!data.action.wakup && ((data.client == client && !mapped) || (data.client == client && mapped && serverSpeak) || (data.client == client && Avatar.isMobile(data.client) && Avatar.Socket.isServerSpeak(data.client)))) {
        getBackupPreset (data.client)
        .then(clientBackupPreset => setBackupPresetState(clientBackupPreset, false))
        .then((clientBackupPreset) => {
            if (!clientBackupPreset)
              console.log('Sonos pause error', 'Pas de client');

            if (!data.action.wakup)
              Avatar.speak("C'est fait", data.client, function() {
                  Avatar.Speech.end(data.client);
              });
        })
        .catch(() => {
          console.log('Sonos error stopList');
          if (!data.action.wakup)
            Avatar.speak("je suis désolé. j'ai rencontré une erreur.", data.client, function() {
              Avatar.Speech.end(data.client);
            });
        })
    } else {
      let player =  _.find(devices, function(num){
          return num.id == client;
      });

      if (player) {
        player.device.getCurrentState()
        .then((state) => {
           if (state === 'playing' || state === 'transitioning')
            player.device.pause()
            .catch(err => {
              console.log('Sonos pause error', err);
            })
            .then(() => {
              if (!data.action.wakup)
                Avatar.speak("C'est fait", data.client, function() {
                    Avatar.Speech.end(data.client);
                });
            })
        })
      } else {
          if (!data.action.wakup)
            Avatar.speak("je suis désolé, je ne trouve pas de playeur " + client, data.client, function() {
              Avatar.Speech.end(data.client);
            });
      }
    }

}



function wakeUpVolumeUp (client, volume) {

  let player =  _.find(devices, function(num){
      return num.id == client;
  });

  if (player) {
      player.device.setVolume(volume)
      .catch(err => {
          console.log('wakeUpVolumeUp:', err)
      });
  }
}



function askForMusic (data, client, type) {

    let player =  _.find(devices, function(num){
        return num.id == client;
    });

    if (player) {

        if (sonosWindow) {
          let title = ipcRenderer.sendSync('SonosUnderstand');
          if (title) {
            if (type == 'Music')
              searchMusic(data, client, player, title);
            else
              searchRadio(data, client, player, title);
            return;
          }
        }

        Avatar.askme("Qu'est ce que tu veux écouter ?|Tu veux quoi ?", data.client,
            {
                "*": "generic",
                "qu'est ce que je peux dire": "sommaire",
                "comme tu veux": "doit",
                "fais-toi plaisir": "doit",
                "terminer": "done"
            }, 0, function (answer, end) {

                // Test si la réponse contient "generic"
                if (answer && answer.indexOf('generic') != -1) {
                    end(data.client);
                    answer = answer.split(':')[1];
                    if (sonosWindow)
                      ipcRenderer.sendSync('SonosSpeech', answer);

                    answer = SonosPlayerAPI.getSearchLexic(answer);
                    if (sonosWindow)
                      answer = ipcRenderer.sendSync('SonosUnderstand', answer);

                    if (type == 'Music')
                      searchMusic(data, client, player, answer);
                    else
                      searchRadio(data, client, player, answer);
                    return;
                }
                // Grammaire fixe
                switch(answer) {
                  case "sommaire":
                      end(data.client);
                      Avatar.speak("Tu peux dire:", data.client, function(){
                        Avatar.speak("Un nom de play liste ou d'albums.", data.client, function(){
                          Avatar.speak("Comme tu veux ou fais-toi plaisir.", data.client, function(){
                            Avatar.speak("Ou terminé.", data.client, function(){
                              askForMusic (data, client, type);
                            });
                          });
                        });
                      });
                    break;
                    case "doit":
                      end(data.client);
                      if (type == 'Music') {
                        asYouWant(data, client, player);
                      } else {
                        Avatar.speak("tu le sais bien. C'est comme je veux uniquement pour la musique.", data.client, function(){
                          askForMusic (data, client, type);
                        });
                      }
                      break;
                    case "done":
                    default:
                        Avatar.speak("Terminé", data.client, function(){
                            end(data.client, true);
                        });
               }
            }
        );
    } else {
         Avatar.speak("Je suis désolé, je n'ai pas trouvé de player "+client, data.client, function(){
            Avatar.Speech.end(data.client);
        });
    }

}


function getRadioLibrary (data, client, device, searchTerm) {

    return new Promise((resolve, reject) => {
        device.getFavoritesRadioStations().then(list => {
            if (!list || !list.items || list.returned == 0)
                return resolve(0);

            list.items = SonosPlayerAPI.matchTerm(list.items, searchTerm);
            list.returned = list.items.length;

            if (list.returned == 0)
                return resolve(0);

            resolve(list.items);
        }).catch(err => {
            reject (err);
        });
    });

}



function asYouWant (data, client, player) {

    let choice = Config.modules.SonosPlayer.musicTypes.random[Math.floor(Math.random() * Config.modules.SonosPlayer.musicTypes.random.length)];

    getRandomMusicLibrary(data, player.device, choice)
    .then(item => playMusic(data, client, player.device, item))
    .then(state => {
        if (state && typeof state === 'boolean') {
            if (Avatar.isMobile(data.client))
                Avatar.Socket.getClientSocket(data.client).emit('askme_done');
            else
                Avatar.Speech.end(data.client);
        } else {
            let tts =  "Je suis désolé, je n'ai pas trouvé de musique";
            Avatar.speak(tts, data.client, function() {
              if (Avatar.isMobile(data.client))
                  Avatar.Socket.getClientSocket(data.client).emit('askme_done');
              else
                  Avatar.Speech.end(data.client);
            });
        }
    })
    .catch(err => {
        let tts = "Je suis désolé, j'ai rencontré une erreur."
        Avatar.speak(tts, data.client, function(){
          if (Avatar.isMobile(data.client))
              Avatar.Socket.getClientSocket(data.client).emit('askme_done');
          else
            Avatar.Speech.end(data.client);
        });
        console.log('Sonos As You Want:', err);
    });

}



function searchRadio (data, client, player, answered) {

  getRadioLibrary(data, client, player.device, answered)
  .then(items => {
      return new Promise((resolve, reject) => {
          if (typeof items === 'number' || (typeof items === 'object' && items.length == 0))
            return resolve(0);

            if (items.length > 1)  {
              answered = SonosPlayerAPI.getLexic(answered);
              if (sonosWindow)
                    answered = ipcRenderer.sendSync('SonosSay', answered);
              Avatar.speak('J\'ai trouvé '+items.length+' radios pour '+answered, data.client, () => {
                searchForMultipleAlbums (data, items, 0, null, (item) => {
                   resolve(item);
                });
              });
              return;
            }

            if (sonosWindow
                && ((items[0].title && items[0].title.toLowerCase() != answered.toLowerCase())
                || (items[0].name && items[0].name.toLowerCase() != answered.toLowerCase()))) {
                answered = ipcRenderer.sendSync('SonosUnderstand', items[0].title || items[0].name);
            }

            answered = SonosPlayerAPI.getLexic(answered);
            if (sonosWindow)
                answered = ipcRenderer.sendSync('SonosSay', answered);

            Avatar.speak('Je mets '+answered, data.client, function() {
                resolve(items[0]);
            });
      })
  })
  .then(item => playMusic(data, client, player.device, item))
  .then(state => {
      if (state && typeof state === 'boolean') {
          if (Avatar.isMobile(data.client))
              Avatar.Socket.getClientSocket(data.client).emit('askme_done');
          else
              Avatar.Speech.end(data.client);
      } else {
          let tts = "Je suis désolé, je n'ai pas trouvé ce que tu demandes";
          Avatar.speak(tts, data.client, function(){
            if (Avatar.isMobile(data.client))
                Avatar.Socket.getClientSocket(data.client).emit('askme_done');
            else
                Avatar.Speech.end(data.client);
          });
      }
  })
  .catch(err => {
      let tts = "Je suis désolé, j'ai rencontré une erreur"
      Avatar.speak(tts, data.client, function(){
        if (Avatar.isMobile(data.client))
            Avatar.Socket.getClientSocket(data.client).emit('askme_done');
        else
          Avatar.Speech.end(data.client);
      });
      console.log('Sonos Radio:', err);
  });
}



function searchMusic (data, client, player, answered) {

    getMusicLibrary(player.device, answered)
    .then(item => searchFavorites(item, player.device, answered))
    .then(item => searchMusicLibraries(item, player.device, 0, answered))
    .then(items => {
        return new Promise((resolve, reject) => {

            if (typeof items === 'number' || (typeof items === 'object' && items.length == 0))
              return resolve(0);

            if (items.length > 1)  {
              answered = SonosPlayerAPI.getLexic(answered);
              if (sonosWindow)
                  answered = ipcRenderer.sendSync('SonosSay', answered);
              Avatar.speak('J\'ai trouvé '+items.length+' albums pour '+answered, data.client, () => {
                searchForMultipleAlbums (data, items, 0, null, (item) => {
                   resolve(item);
                });
              });
              return;
            }

            if (sonosWindow
                && ((items[0].title && items[0].title.toLowerCase() != answered.toLowerCase())
                || (items[0].name && items[0].name.toLowerCase() != answered.toLowerCase()))) {
                answered = ipcRenderer.sendSync('SonosUnderstand', items[0].title || items[0].name);
            }
            answered = SonosPlayerAPI.getLexic(answered);
            if (sonosWindow)
                answered = ipcRenderer.sendSync('SonosSay', answered);

            Avatar.speak('Je mets '+answered, data.client, function() {
                resolve(items[0]);
            });
        })
    })
    .then(item => playMusic(data, client, player.device, item))
    .then(state => {
        if (state && typeof state === 'boolean') {
              if (Avatar.isMobile(data.client))
                Avatar.Socket.getClientSocket(data.client).emit('askme_done');
              else
                  Avatar.Speech.end(data.client);
        } else {
            let tts = "Je suis désolé, je n'ai pas trouvé ce que tu demandes";
            Avatar.speak(tts, data.client, () => {
              if (Avatar.isMobile(data.client))
                  Avatar.Socket.getClientSocket(data.client).emit('askme_done');
              else
                  Avatar.Speech.end(data.client);
            });
        }
    })
    .catch(err => {
        let tts = "Je suis désolé, j'ai rencontré une erreur";
        Avatar.speak(tts, data.client, function(){
          if (Avatar.isMobile(data.client))
              Avatar.Socket.getClientSocket(data.client).emit('askme_done');
          else
            Avatar.Speech.end(data.client);
        });
        console.log('Sonos:', err);
    });

}


function playMusic(data, client, device, item, spotify) {

  return new Promise((resolve, reject) => {

    if (typeof item !== 'object' || !item.uri)
      return resolve(item);

    // needed by spotify
    if (spotify)
      device.setSpotifyRegion(SpotifyRegion[Config.modules.SonosPlayer.Spotify.region]);

    // FIX
    // Ca fonctionnait avant avec juste spotify:playlist... bizarre
    if (item.uri.indexOf('spotify:user:spotify:playlist:') == -1 && item.uri.indexOf('spotify:playlist:') != -1)
          item.uri = 'spotify:user:'+item.uri;

    let serverSpeak = _.find(Config.modules.SonosPlayer.mapped_client_speak, function(num){
        return client == num;
    });

    let mapped = _.find(Config.default.mapping, function(num){
      return client == num.split(',')[0];
    });

    if ((data.client == client && !mapped) || (data.client == client && mapped && serverSpeak) || (data.client == client && Avatar.isMobile(data.client) && Avatar.Socket.isServerSpeak(data.client))) {
        getBackupPreset (data.client)
        .then (clientBackupPreset => {
          let flagNew;
          if (!clientBackupPreset) {
            clientBackupPreset = {
              "players": [{"roomName": data.client}],
              "volume": 15,
              "UDN": device.UDN,
              "mediaInfo" : {}
            };
            flagNew = true;
          }
          let flagRadio = (item.uri.indexOf("x-sonosapi-stream") != -1) ? true : false;

          device.getQueue()
          .then(list => {
              if (!list || !list.items || list.items.length == 0) {
                device.queue(item.uri)
                .then(state => device.getQueue())
                .then(list => {
                    clientBackupPreset.mediaInfo.uri = list.items[0].uri;
                    clientBackupPreset.mediaInfo.queuePosition = 1;
                    clientBackupPreset.mediaInfo.position = 0;
                    clientBackupPreset.state = true;
                    clientBackupPreset.muted = false;
                    if (flagNew) backupPreset.clients.push(clientBackupPreset);
                    if (flagRadio) {
                        device.selectQueue()
                        .then(state => device.flush())
                        .then(() => resolve(true))
                    } else
                        resolve(true);
                })
                .catch(err => {
                    reject(err);
                })

              } else {
                  device.selectQueue()
                  .then(state => device.flush())
                  .then(data => device.queue(item.uri))
                  .then(state => device.getQueue())
                  .then(list => {
                      clientBackupPreset.mediaInfo.uri = list.items[0].uri;
                      clientBackupPreset.mediaInfo.queuePosition = 1;
                      clientBackupPreset.mediaInfo.position = 0;
                      clientBackupPreset.state = true;
                      clientBackupPreset.muted = false;
                      if (flagNew) backupPreset.clients.push(clientBackupPreset);
                      if (flagRadio) {
                          device.selectQueue()
                          .then(state => device.flush())
                          .then(() => resolve(true))
                      } else
                          resolve(true);
                  })
                  .catch(err => {
                      reject(err);
                  })
              }
          })
          .catch(err => {
              reject(err);
          })

        });
    } else {
        device.getQueue()
        .then(list => {
            if (!list || !list.items || list.items.length == 0) {
              device.play(item.uri)
              .then(() => resolve(true))
              .catch(err => {
                  reject(err);
              })
            } else {
              device.selectQueue()
              .then(state => device.flush())
              .then(data => device.play(item.uri))
              .then(() => resolve(true))
              .catch(err => {
                  reject(err);
              })
            }
        })
        .catch(err => {
            reject(err);
        })
    }
  })
}



// Méthode de recherche du client où l'action doit être exécutée.
function setClient (data) {

	var client = data.client;

	if (data.action.room)
		client = (data.action.room != 'current') ? data.action.room : (Avatar.currentRoom) ? Avatar.currentRoom : Config.default.client;

	if (data.action.setRoom)
		client = data.action.setRoom;

	return client;
}



function speak_states (client, filename, callback) {

	var exec = require('child_process').exec
	, child;

	if (client.indexOf(' ') != -1) client = client.replace(/ /g,"_");

	// Construct a filesystem neutral filename
	var webroot = path.resolve(__dirname);

	if (!filename.endsWith('speech.mp3')) {
		var cmd = webroot + '/sox/sox-14-4-2/sox -q "' + filename + '" "' + filename.substring(0,filename.length - 4) + '-test.wav"';
    var child = exec(cmd, function (err, stdout, stderr) {
			if (err) {
				error('Sox error:', err || 'Unable to start Sox');
				callback();
			}
		});

		if (child) {
			let filenametest = filename.substring(0,filename.length - 4) + '-test.wav';
      let filenametest1 = filename.substring(0,filename.length - 4) + '-test1.wav';
			child.stdout.on("close", function() {
				setTimeout(function(){
					var cmd = webroot + '/sox/sox -q "' + filenametest + '" "' + filenametest1 + '" stat -−json';
						var stats;
						var child = exec(cmd, function (err, stdout, stderr) {
              fs.removeSync(filenametest);
              fs.removeSync(filenametest1);
							if (err) {
								error('Sox error:', err || 'Unable to start Sox');
								callback();
							}
						});

						if (child)
							child.stdout.on("close", function() {
								setTimeout(function(){
									try {
										var json = fs.readFileSync(webroot + '/../../../../state.json','utf8');
											stats = JSON.parse(json);
											callback(stats.Length_seconds);
									} catch(ex){
										error("error: " + ex.message);
										callback();
									}
								}, 200);
							});
				}, 200);
			});
		}

	} else {
    var fileresult = 'speech.wav';
  	var filepath = path.resolve(webroot, 'tts', 'speech', client, fileresult);
		var cmd = webroot + '/sox/sox -q ' + filename + ' ' + filepath + ' stat -−json';
		var stats;
		var child = exec(cmd, function (err, stdout, stderr) {
      fs.removeSync(filename);
			if (err) {
				error('Sox error:', err || 'Unable to start Sox');
				callback();
			}
		});

		if (child)
			child.stdout.on("close", function() {
				setTimeout(function(){
					try {
            var json = fs.readFileSync(webroot + '/../../../../state.json','utf8');
						stats = JSON.parse(json);
						callback(stats.Length_seconds);
					} catch(ex){
						error("error: " + ex.message);
						callback();
					}
				}, 200);
			});
	}

}



function ttsToWav (client, tts, callback) {

	var exec = require('child_process').exec
	, child;

	if (client.indexOf(' ') != -1) client = client.replace(/ /g,"_");

	var webroot = path.resolve(__dirname);
	var filename = 'speech.mp3';
	var filepath = path.resolve(webroot, 'tts', 'speech', client, filename);
	fs.ensureDirSync(webroot + '/tts/speech/' + client);

	// Decode URI
	tts = decodeURIComponent(tts);
	// tts to wav
	var execpath = webroot + '/lib/vbs/ttstowav.vbs';

	child = exec( execpath + ' "'+ tts + '" "' + filepath + '"',
	  function (err, stdout, stderr) {
			if (err !== null) {
				error('tts to wav error: ' + err);
			} else
				callback(filepath);
	  });
}
