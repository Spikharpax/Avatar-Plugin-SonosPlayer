var SpotifyAlbums = function SpotifyAlbums (SpotifyApi) {

  this.SpotifyApi = SpotifyApi;

}


SpotifyAlbums.prototype.searchUserAlbums = function () {

  return new Promise((resolve, reject) => {
    let albums = [];
    this.getSpotifyAlbums(0, albums, function() {
        resolve(albums);
    });
  });

}


SpotifyAlbums.prototype.getSpotifyAlbums = function (offset, albums, callback) {

      this.SpotifyApi.getMySavedAlbums({
        limit : 10,
        offset: offset
      })
      .then(data => {
          if (!data.body.items || data.body.items.length == 0) {
              return callback();
          }
          data.body.items.forEach(function(item) {
            albums.push(item.album);
          });
          this.getSpotifyAlbums(offset+10, albums, callback);
      }).catch(err => {
          callback();
      });
}

module.exports.SpotifyAlbums = SpotifyAlbums;
