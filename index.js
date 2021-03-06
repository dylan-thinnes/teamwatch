var express = require('express');
var app = express();
var http = require('http').createServer(app);
var timesyncServer = require('timesync/server');

app.use('/', express.static(__dirname));

var io = require('socket.io')(http, { path: '/socket.io' });

app.use('/timesync', timesyncServer.requestHandler);

app.listen(8080);
http.listen(3000, () => {
    console.log("listening on *:3000");
});

var seenEvents = new Set();
var heart = {};
io.on('connection', function(socket){
    let uid = Math.random();

    socket.on('controlsup', e => {
        console.log(e);
        if (typeof e != 'object' || e.id == null) return;
        console.log(`has id: ${e.id}`);
        if (seenEvents.has(e.id)) return;
        if (e.time != null && seenEvents.has(e.time)) return;
        seenEvents.add(e.id);
        seenEvents.add(e.time);
        setTimeout(() => {
            socket.broadcast.emit('controlsdown', e);
        }, 1000);
    });

    socket.on('heartbeat', e => {
        heart['you'] = uid;
        heart[uid] = { ...e, uid };
        let curr = Date.now() / 1000;
        for (index in heart) {
            let heartbeat = heart[index];
            if (heartbeat == null || typeof heartbeat != 'object') continue;
            if (heartbeat.senttime < curr - 10) {
                delete heart[index];
            }
        }
        heart.id = Math.random();
        socket.emit('heartreply', heart);
        console.log('heartreply', heart);
    });

    socket.on('disconnect', e => {
        delete heart[uid];
    });

    socket.on('countdown', e => {
        let curr = Date.now();
        io.emit('countdown', {
            target: curr + 3000,
            targetSeektime: e.targetSeektime,
        });
    });
});
