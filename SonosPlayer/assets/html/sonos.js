const {ipcRenderer, remote} = require('electron');
const {ipcMain, BrowserWindow} = remote;
const fs = require('fs-extra');
const _ = require('underscore');

let config = fs.readJsonSync(__dirname + '/../../SonosPlayer.prop', { throws: false });
let tblGenres = [];


window.onbeforeunload = (e) => {
  e.preventDefault();
  close();
}


document.getElementById('exit').addEventListener('click', function(){
    close();
});


function close() {

  let SonosWindowsID = ipcRenderer.sendSync('SonosWindowsID');
  let SonosWindows = BrowserWindow.fromId(SonosWindowsID);
  let pos = SonosWindows.getPosition();
  fs.writeJsonSync('./resources/core/plugins/SonosPlayer/style.json', {
    x: pos[0],
    y: pos[1]
  });

  ipcMain.removeAllListeners('SonosSpeech');
  ipcMain.removeAllListeners('SonosUnderstand');
  ipcMain.removeAllListeners('SonosSay');
  ipcMain.removeAllListeners('SonosGenre');
  ipcMain.removeAllListeners('SonosGetGenre');
  ipcRenderer.sendSync('Sonos', 'quit');
}


document.getElementById('menu-genre').addEventListener('click', function(){
  document.getElementById('speech').value = "";
  document.getElementById('title').value = "";
  document.getElementById('lexic').value = "";
})

document.getElementById('check-genre').addEventListener('click', function(){
 if (document.getElementById('check-genre').toggled) {
    document.getElementById("title").style.visibility = "hidden";
    document.getElementById('genre').style.display = "block";
    document.getElementById("genre").style.visibility = "visible";
    //document.getElementById("selection").toggled = true;
  } else {
    document.getElementById('genre').style.visibility = "hidden";
    document.getElementById('title').style.display = "block";
    document.getElementById('title').style.visibility = "visible";
  }
})

document.getElementById('delete').addEventListener('click', function(){
  document.getElementById('title').value = "";
  document.getElementById('speech').value = "";
  document.getElementById('lexic').value = "";
  document.getElementById("selection").toggled = true;
})

document.getElementById('save').addEventListener('click', function(){

  let toSave;

  if (document.getElementById('speech').value && document.getElementById('title').value && (document.getElementById('speech').value.toLowerCase() != document.getElementById('title').value.toLowerCase())) {
    let understood = document.getElementById('title').value;
    let found;
    for (item in config.modules.SonosPlayer.search_lexic) {
      if (item.toLowerCase() == understood.toLowerCase())
          found = item;
    }
    if (found) {
      config.modules.SonosPlayer.search_lexic[found] = _.union([document.getElementById('speech').value], config.modules.SonosPlayer.search_lexic[found]);
    } else {
      found = understood;
      config.modules.SonosPlayer.search_lexic[found] = [document.getElementById('speech').value];
    }
    toSave = true;
  }

  if (document.getElementById('lexic').value  && document.getElementById('title').value && (document.getElementById('genre').style.visibility == "" || document.getElementById('genre').style.visibility == "hidden") && (document.getElementById('lexic').value.toLowerCase() != document.getElementById('title').value.toLowerCase())) {
      let say = document.getElementById('lexic').value;
      let found;
      for (item in config.modules.SonosPlayer.tts_lexic) {
        if (item.toLowerCase() == say.toLowerCase())
            found = item;
      }

      if (found) {
          config.modules.SonosPlayer.tts_lexic[found] = _.union([document.getElementById('title').value], config.modules.SonosPlayer.tts_lexic[found]);
      } else {
        found = say;
        config.modules.SonosPlayer.tts_lexic[found] = [document.getElementById('title').value];
      }
      toSave = true;
  }

  if (document.getElementById('lexic').value && document.getElementById('genre').style.visibility == "visible") {
      let say = document.getElementById('lexic').value;
      let found;
      for (item in config.modules.SonosPlayer.tts_lexic) {
        if (item.toLowerCase() == say.toLowerCase())
            found = item;
      }

      let value;
      let menuGenre = document.getElementById('menu-genre');
      for(var i=0; i < menuGenre.childNodes.length;i++) {
    		  let child = menuGenre.childNodes[i];
          if (child.toggled && child.value != "Sélectionnez un genre") {
            value = child.value.split('@@')[0];
            break;
          }
  	  }

      if (found && found.toLowerCase() != value.toLowerCase()) {
          config.modules.SonosPlayer.tts_lexic[found] = _.union([value], config.modules.SonosPlayer.tts_lexic[found]);
      } else {
        found = say;
        config.modules.SonosPlayer.tts_lexic[found] = [value];
      }
      toSave = true;
  }

  if (toSave) {
    fs.writeJsonSync(__dirname + '/../../SonosPlayer.prop', config);
    let notification = document.getElementById('notification');
    notification.innerHTML = "Sauvegardé !"
    notification.opened = true;
  }

});


function setGenre (genres) {

  let imgs = ['games','art-track','audiotrack','library-music','queue-music','surround-sound','radio','playlist-play','album','airplay','music-video','high-quality']
  let menuGenres = document.getElementById('menu-genre');
  genres.forEach(genre => {
      let menuitem = document.createElement("x-menuitem");
      menuitem.value = genre.name+'@@'+genre.id;
      tblGenres.push(genre.name+'@@'+genre.id);
      let icon = document.createElement("x-icon");
      let img = imgs[Math.floor(Math.random() * imgs.length)];
      icon.setAttribute('name', img);
      let label = document.createElement("x-label");
      label.className = 'label-help';
      label.innerHTML = genre.name;
      menuitem.appendChild(icon);
      menuitem.appendChild(label);
      menuGenres.appendChild(menuitem);
  })

  document.getElementById("selection").toggled = true;

}


ipcMain.on('SonosSpeech', (event, arg) => {
  document.getElementById('speech').value = arg;
  event.returnValue = null;
})
.on('SonosUnderstand', (event, arg) => {
  if (arg)
    document.getElementById('title').value = arg;

  event.returnValue = document.getElementById('title').value;
})
.on('SonosSay', (event, arg) => {
  if (!document.getElementById('lexic').value)
    document.getElementById('lexic').value = arg;

  event.returnValue = document.getElementById('lexic').value;
})
.on('SonosGenre', (event, arg) => {
  document.getElementById('check-genre').disabled = false;
  if (tblGenres.length > 0) tblGenres = [];
  setGenre(arg);
  event.returnValue = true;
})
.on('SonosGetGenre', (event, arg) => {
  let value = false;
  if (document.getElementById('genre').style.visibility == "visible") {
    let menuGenre = document.getElementById('menu-genre');
    for(var i=0; i < menuGenre.childNodes.length;i++) {
  		  let child = menuGenre.childNodes[i];
        if (child.toggled && child.value != "Sélectionnez un genre") {
          value = child.value;
          break;
        }
	  }
  } else if (document.getElementById('title').value) {
    for(var i = 0; i < tblGenres.length; i++) {
        if (tblGenres[i].split('@@')[0].toLowerCase() == document.getElementById('title').value.toLowerCase()) {
            value = tblGenres[i];
            break;
        }
    }
  }

  event.returnValue = value;
})
