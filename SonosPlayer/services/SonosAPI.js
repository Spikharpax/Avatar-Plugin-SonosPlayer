const soundex  = require('./soundex.js').soundex;
const clj_fuzzy = require('clj-fuzzy');

var SonosAPI = function SonosAPI (lexic, search_lexic) {

  this.lexic = lexic;
  this.search_lexic = search_lexic;

}


SonosAPI.prototype.matchTerm  = function (items, term) {

  let match = [];
  let sdx = soundex(term);
  let score = 0;
  items.forEach(item => {
    if (item.title || item.name)
      if (this.getLevenshteinDistance(sdx, item.title || item.name, score))
        match.push (item);
  });

  return match;

}


SonosAPI.prototype.searchSpotifyAlbumByName = function (albums, answered, albumsMatched) {
  return new Promise((resolve, reject) => {

    if (answered == true || answered == "list") return resolve(albums);

    let sdx = soundex(answered);
  	let score = 0;
    albums.forEach(album => {
      if (this.getLevenshteinDistance(sdx, album.name, score))
        albumsMatched.push (album);
    });
    resolve(albums);
  });
}


SonosAPI.prototype.searchSpotifyAlbumByArtist = function (albums, answered, albumsMatched) {
  return new Promise((resolve, reject) => {

    if (answered == true || answered == "list") return resolve(albums);

    let sdx = soundex(answered);
  	let score = 0;
    albums.forEach(album => {
      if (this.getLevenshteinDistance(sdx, album.artists[0].name, score))
        albumsMatched.push (album);
    });
    resolve(albums);
  });
}



SonosAPI.prototype.getLevenshteinDistance = function (sdx, text, score) {
  let sdx_gram = soundex(text);
  let levens  = clj_fuzzy.metrics.levenshtein(sdx, sdx_gram);
      levens  = 1 - (levens / sdx_gram.length);
  if (levens > score && levens >= 0.8){
    score = levens;
    return true;
  } else {
    return false;
  }
}



SonosAPI.prototype.getLexic = function (sentence) {

  for (let i in this.lexic) {
      let even = _.find(this.lexic[i], (num) => {
          if (sentence.toLowerCase().indexOf(num) != -1) {
            let replaceSentence = sentence.substring(0, sentence.toLowerCase().indexOf(num) - 1);
            let replaceSentence1 = sentence.substring(sentence.toLowerCase().indexOf(num) + num.length);
            sentence = replaceSentence+' '+i+' '+replaceSentence1;
          }
          return sentence.toLowerCase() == num.toLowerCase();
      });
      if (even) {
          sentence = i;
          break;
      }
  }
  return sentence;
}


SonosAPI.prototype.getSearchLexic = function (sentence) {

  for (let i in this.search_lexic) {
      let even = _.find(this.search_lexic[i], (num) => {
          return sentence.toLowerCase() == num.toLowerCase();
      });
      if (even) {
          sentence = i;
          break;
      }
  }
  return sentence;
}



module.exports.SonosAPI = SonosAPI;
