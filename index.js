var app = require('express')();
var http = require('http').createServer(app);
var io = require('socket.io')(http);

// app.get('/', function(req, res){
//     res.sendFile(__dirname + '/index.html');
// });

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
        socket.broadcast.emit('controlsdown', e);
    });

    socket.on('heartbeat', e => {
        heart['you'] = uid;
        heart[uid] = e.senttime - e.currentTime;
        heart.id = Math.random();
        socket.emit('heartreply', heart);
        console.log('heartreply', heart);
    });
});

http.listen(3000, function(){
    console.log('listening on *:3000');
});
