var SpotifyPlaylists = function SpotifyPlaylists (SpotifyApi) {

  this.SpotifyApi = SpotifyApi;

}


SpotifyPlaylists.prototype.searchUserPlaylists = function () {

  return new Promise((resolve, reject) => {

    let albums = [];
    this.SpotifyApi.getUserPlaylists()
    .then(data => {

        if (!data.body.items || data.body.items.length == 0) {
            return resolve(0);
        }
        data.body.items.forEach(function(item) {
          albums.push(item);
        });
        resolve(albums);
    }).catch(err => {
        console.log('searchUserPlaylists:', err)
        resolve(0);
    });
  });

}


module.exports.SpotifyPlaylists = SpotifyPlaylists;
