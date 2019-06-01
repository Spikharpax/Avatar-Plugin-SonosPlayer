const _ = require('underscore');
let market;

var SpotifySearch = function SpotifySearch (SpotifyApi, available_market) {

  this.SpotifyApi = SpotifyApi;
  market = available_market;
}


SpotifySearch.prototype.addAlbumToLibrary = function (artist, album) {

  return new Promise((resolve, reject) => {

    this.searchArtist(artist)
    .then(albums => {
        return new Promise((resolved, rejected) => {
          let albumID;
          albums.forEach(function(item){
            if (item.name == album)
              albumID = item.id;
          });

          if (!albumID)
            return resolved(false);

          resolved(albumID);
        })
    })
    .then(albumID => {

      if (!albumID) return resolve(false);

      this.SpotifyApi.addToMySavedAlbums([albumID])
      .then(data => {
          resolve(true);
      })
      .catch(err => {
          resolve(false);
      });
    })
    .catch(err => {
      console.log('addAlbumToLibrary',err);
      resolve(false);
    });
  });

}



SpotifySearch.prototype.searchArtist = function (artist) {

  return new Promise((resolve, reject) => {

    this.getArtist(artist)
    .then(artistID => {
        if (!artistID) return resolve(false);
        let albums = [];
        this.searchArtistAlbums(0, artistID, albums, function() {
            resolve(albums);
        });
    })
    .catch(err => {
      resolve(false);
    });
  });

}


SpotifySearch.prototype.getArtist = function (artist) {

  return new Promise((resolve, reject) => {
    this.SpotifyApi.searchArtists(artist)
    .then(data => {
        if (!data.body || !data.body.artists || !data.body.artists.items || data.body.artists.items.length == 0)
          return resolve(false);
          // le plus proche
          resolve(data.body.artists.items[0].id);
    })
    .catch(err => {
      console.log('getArtist', err);
      resolve(false);
    });
  });

}


SpotifySearch.prototype.searchArtistAlbums = function (offset, artistID, albums, callback) {

    this.SpotifyApi.getArtistAlbums(artistID,
      { limit : 20,
        offset : offset
      })
      .then(data => {
          if (!data.body || !data.body.items || data.body.items.length == 0)
              return callback();

          data.body.items.forEach(function(item) {
              if (item.available_markets && _.contains(item.available_markets, market)) {
                if (!item.album_group)
                  albums.push(item);
                else if (item.album_group && item.album_group == 'album')
                  albums.push(item);
              }
          });

          if ((offset+20) == 60)
            return callback();

          this.searchArtistAlbums (offset + 20, artistID, albums, callback)

      }).catch(err => {
          console.log('searchArtistAlbums:', err)
          return callback();
      });

}


SpotifySearch.prototype.searchTitre = function (titre, artist) {

    return new Promise((resolve, reject) => {

      let searchVal = (artist) ? 'track:'+titre+' artist:'+artist : 'track:'+titre;
      this.SpotifyApi.searchTracks(searchVal, {
          country: 'FR',
          limit : 20, // 5 maxi...
          offset : 0
      })
      .then(data => {
          let result = [];
          if (data.body && data.body.tracks && data.body.tracks.items && data.body.tracks.items.length > 0) {
            if (data.body.tracks.items.length == 1) {
              let pos = Math.floor(Math.random() * data.body.tracks.items.length);
              result.push(data.body.tracks.items[pos]);
            } else {
              data.body.tracks.items.forEach(function(tracks) {
                result.push(tracks);
              });
            }
          }
          resolve(result);
      }).catch(err => {
          console.log('getTitres:', err)
          reject();
      });

    });
}




SpotifySearch.prototype.searchGenres = function (genres) {
    return new Promise((resolve, reject) => {
      this.getGenres(0, genres, () => {
          resolve(genres);
      });
    });
}



SpotifySearch.prototype.getGenres = function (offset, genres, callback) {

      this.SpotifyApi.getCategories({
        limit : 10,
        offset: offset,
        country: 'FR',
        locale: 'fr_FR'
      })
      .then(data => {
          if (!data.body || !data.body.categories || !data.body.categories.items || data.body.categories.items.length == 0) {
              return callback();
          }
          data.body.categories.items.forEach(function(genre) {
            genres.push({name: genre.name, id: genre.id});
          });
          this.getGenres(offset+10, genres, callback);
      }).catch(err => {
          console.log('getGenres:', err)
          callback();
      });
}


SpotifySearch.prototype.searchPlaylistsByCategory = function (genre) {

    return new Promise((resolve, reject) => {
      let albums = [];
      this.getPlaylistsByCategory(0, genre, albums, function() {
          resolve(albums);
      });
    });

}


SpotifySearch.prototype.getPlaylistsByCategory = function (offset, genre, albums, callback) {

      this.SpotifyApi.getPlaylistsForCategory(genre[0].id, {
          country: 'FR',
          limit : 10,
          offset : offset
      })
      .then(data => {
          if (!data.body.playlists.items || data.body.playlists.items.length == 0) {
              return callback();
          }

          data.body.playlists.items.forEach(function(item) {
            albums.push(item);
          });

          this.getPlaylistsByCategory (offset+10, genre, albums, callback);
      })
      .catch(err => {
        console.log("getPlaylistsByCategory:", err);
        callback();
      });
}


module.exports.SpotifySearch = SpotifySearch;
