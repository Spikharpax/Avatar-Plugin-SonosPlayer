/**
 * Spotify library to get an access code to the owner's Spotify account
 * @module Spotify
 * Stephane Bascher
 * avatar.home.automation@gmail.com
 * creation date: 2018-12-10
 */

const {remote} = require('electron');
const {BrowserWindow} = remote;
const express = require('express');
const request = require('request');
const querystring = require('querystring');
const path = require('path');

var Spotify = function Spotify (port, options) {

  this.port = port;
  this.redirect_uri = 'http://localhost:'+this.port+'/SonosPlayer/callback';
  this.options = options;

}


Spotify.prototype.authenticate = function () {
  return new Promise((resolve, reject) => {
      this.getAuthenticate().then(state => {
          resolve (state);
      }).catch(err => {
          reject (err);
      });
  })
}


Spotify.prototype.getAuthenticate = function () {

  return new Promise((resolve, reject) => {
      var style = {
        frame: false,
        movable: false,
        resizable: false,
        show: false,
        width: 480,
        height: 500,
        title: 'Spotify'
      }

      var spotifyWindow = new BrowserWindow(style);

      var client_id = this.options.client_id; // Your client id
      var client_secret = this.options.client_secret; // Your secret
      var redirect_uri = this.redirect_uri;

       var generateRandomString = function(length) {
          var text = '';
          var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

          for (var i = 0; i < length; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
          }
          return text;
       };

       var stateKey;
       stateKey = generateRandomString(16);

       var spotifyApp = express();
       var ROOT  = path.normalize(__dirname);
       ROOT = path.resolve(ROOT + '/../../plugins/SonosPlayer/public');
       spotifyApp.use(express.static(ROOT));

       spotifyApp.get('/SonosPlayer/callback', function(req, res) {

         var code = req.query.code || null;
         var state = req.query.state || null;

         if (state === null || state !== stateKey) {
             if (spotifyWindow) spotifyWindow.close();
             reject ('Sonos Player: Invalid access to Spotify account');
         } else {
             var authOptions = {
               url: 'https://accounts.spotify.com/api/token',
               form: {
                 code: code,
                 redirect_uri: redirect_uri,
                 grant_type: 'authorization_code'
               },
               headers: {
                 'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
               },
               json: true
             };

             request.post(authOptions, function(err, response, body) {
             if (!err && response.statusCode === 200) {

               var access_token = body.access_token,
                   refresh_token = body.refresh_token;

               var options = {
                 url: 'https://api.spotify.com/v1/me',
                 headers: { 'Authorization': 'Bearer ' + access_token },
                 json: true
               };

               // use the access token to access the Spotify Web API
                request.get(options, function(err, response, body) {
                 if (spotifyWindow) spotifyWindow.close();
                 resolve ({body: body, access_token: access_token, refresh_token: refresh_token, code: code});
               });
             } else {
                 if (spotifyWindow) spotifyWindow.close();
                 reject ('Sonos Player: Invalid token to Spotify account. Access denied');
             }
           });
         }
       });

       var spotifyServer = spotifyApp.listen(8888);
        var scope = 'user-read-private user-library-read user-library-modify playlist-read-private user-read-playback-state user-read-currently-playing';
        spotifyWindow.loadURL('https://accounts.spotify.com/authorize?' +
          querystring.stringify({
            response_type: 'code',
            client_id: client_id,
            scope: scope,
            redirect_uri: redirect_uri,
            state: stateKey,
            show_dialog: false
          }));

        spotifyWindow.once('ready-to-show', () => {
            spotifyWindow.show();
        })

        spotifyWindow.on('closed', function () {
          console.log('Closing Spotify API server')
          // Everything done
          // refresh all
          spotifyServer.close();
          spotifyServer = null;
          spotifyWindow = null;
        })
    })

}

module.exports.Spotify = Spotify;
