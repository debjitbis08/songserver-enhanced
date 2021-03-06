"use strict";

var http = require('http');
var staticServer = require('node-static');
var socketio = require('socket.io');
var formidable = require('formidable');
var fileServer = new staticServer.Server(__dirname + '/public');

var argv = require('optimist')
    .usage('Start the Song Server.\nUsage: $0')
    .alias('p', 'port')
    .describe('p', 'Port to start server on')
    .alias('m', 'media')
    .describe('m', 'The media folder(where songs will be stored) ex : -m "/media"')
    .alias('a', 'adminlist')
    .describe('m', 'Admin ip list seperated by comma ex : -a "172.16.4.2,172.16.3.2"')
    .argv
;

/* Setting Defaults */

var PORT = argv.port || 8085;
var mediaFolder = argv.media || "/media/";
var adminList = (argv.adminlist && argv.adminlist.split(",")) || [];

var SongServer = require('./lib/songServer.js');

var songServer = new SongServer({
    directory: __dirname + mediaFolder,
    adminlist : adminList
});




var server = http.createServer(function (request, response) {
    if (request.url === '/upload') {
        var form = new formidable.IncomingForm();
        try {
            form.parse(request, function(err, fields, files){
                if (!err) {
                    songServer.saveSongs(files);
                    songServer.once("songsSaved", function () {
                        response.end('ok');
                    });
                } else {
                    response.end('error');
                }
            });
        } catch(ex) {
            console.log(ex);
        }
    } else {
        fileServer.serve(request, response);
    }
});
server.listen(PORT);

var websock = socketio.listen(server);

websock.configure(function (){
    websock.set('authorization', function (handshakeData, callback) {
        songServer.connectUser(handshakeData.address.address, handshakeData.query.name);
        callback(null, true);
    });
});

websock.configure(function() {
    websock.disable('log');
});

songServer.on("mediaListChange", function (list) {
    websock.sockets.in('users').emit('mediaListChange', list.toJSON());
});

songServer.on("playListChange", function (playlist) {
    websock.sockets.in('users').emit('playListChange', playlist.toJSON());
});

songServer.on("nowPlaying", function (media) {
    websock.sockets.in('users').emit('nowPlaying', media.toJSON());
    media.getInfo();
});




websock.sockets.on('connection', function(socket) {
    socket.join('users');
    
    var ip = socket.handshake.address.address;

    var user = songServer.connectUser(ip);

    socket.emit('init', {
        playList: songServer.getPlayList().toJSON(),
        mediaList: songServer.getMediaList().toJSON(),
        user: user.toJSON(),
        nowPlaying: songServer.getCurrentMedia(true)
    });

    socket.on('songSelected', function (song) {
        var name = song.name,
            result;

        result = songServer.enqueue(name, user);
        if (result instanceof Error) {
            socket.emit('error', {
                message: result.message,
                song: song
            });
        }
    });
    
    socket.on('userNameChange', function (name) {
        user.setName(name);
    });
    
    socket.on('songRemoved', function(song) {
        var result = songServer.dequeue(song, user);
        if (result instanceof Error) {
            socket.emit('error', result);
        }
    });
    
    socket.on('upVote', function(song) {
        var result = songServer.upVote(song, user);
        if (result instanceof Error) {
            socket.emit('error', {
		message: result.message,
                song: song,
                action: "upvote"
	    });
        }
    });
    
    socket.on('downVote', function(song) {
        var result = songServer.downVote(song, user);
        if (result instanceof Error) {
            socket.emit('error', {
                message: result.message,
                song: song,
                action: "downvote"
            });
        }
    });
});

console.log('Server started on port: ' + PORT);

