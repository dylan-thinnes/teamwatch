// Grab all base elements
var header = document.getElementById("header");
var filename = document.getElementById("filename");
var subs = document.getElementById("subs");
var player = document.getElementById("player");

// Initialize the player
var playerjs = new Plyr('#player', {captions: {update: true, active: true}});
window.playerjs;

// Initialize the global "source" for the player
var source = {};
var updateSource = (newsrc) => {
    console.log("Updating source: ", source, newsrc);
    source = { ...source, ...newsrc };
    playerjs.source = source;
};
updateSource({
    type: "video",
    sources: [],
    tracks: [],
});

// Functions for generating sources, both for subtitles and videos
var genVideoSource = file => {
    if (file instanceof File) {
        src = URL.createObjectURL(file);
    } else if (typeof file == "string") {
        src = file;
    }

    return { src };
}

var genTrackSource = file => {
    let track = {
        kind: "captions",
        src: URL.createObjectURL(file),
        srclang: "en",
        label: "English",
        default: true,
    }

    return track;
}

// Function to update video sources/tracks from list of files
var updateFromFiles = files => {
    var { tracks, sources: videos } = source;

    for (file of files) {
        if (!(file instanceof File)) continue;

        var mime = file.type;
        var [type, subtype] = mime.split("/");
        if (mime == "video/mp4") {
            videos = videos || [];
            console.log("Adding video:", file);
            videos.push(genVideoSource(file));
        } else if (mime == "text/vtt") {
            tracks = tracks || [];
            console.log("Adding subtitle:", file);
            tracks.push(genTrackSource(file));
        }
    }

    updateSource({
        type: "video",
        tracks,
        sources: videos
    })
}

filename.addEventListener("change", e => updateFromFiles(e.target.files || []));

// Initialize connection
var conn = io("http://localhost:3000");

// Trigger a controls event on the connection
var trigger = (type, data, channel) => {
    var channel = channel || 'controlsup';
    var id = Math.random();
    seenEvents.add(id);
    conn.emit(channel, {
        ...data, id, type,
        seektime: playerjs.currentTime,
        senttime: Date.now() / 1000,
    });
}

// Event listeners for the player
var abortNext = {};

var setPlayerListener = (event, handler, nonotify) => {
    playerjs.on(event, e => {
        if (abortNext[event] == true) {
            console.log(`ABORTED: ${event}`, e);
            delete abortNext[event];
            return;
        } else {
            if (nonotify !== true) {
                console.log(`TRIGGERED: ${event}`, e);
            }
            handler(e);
        }
    });
}

setPlayerListener("play", e => {
    trigger("play", {
        willBePlaying: true
    });
});

setPlayerListener("pause", e => {
    trigger("pause", {
        willBePlaying: false
    });
});

setPlayerListener("seeked", e => {
    abortNext.pause = true;
    playerjs.pause();
    trigger("seeked", {
        seektime: playerjs.currentTime,
        senttime: Date.now() / 1000,
        willBePlaying: playerjs.playing
    });
});

setPlayerListener("canplay", e => {
    console.log("CANPLAY");
}, true);

setPlayerListener("timeupdate", _.throttle(e => {
    console.log("TIMEUPDATE");
    trigger("heartbeat", {
        currentTime: playerjs.currentTime
    }, 'heartbeat');
}, 1000), true);

var seenEvents = new Set();
conn.on('heartreply', e => {
    console.log('heartreply', e);
});
conn.on('controlsdown', e => {
    console.log("Event", e);

    if (seenEvents.has(e.id)) {
        console.log("Event already seen.");
        return;
    }
    seenEvents.add(e.id);

    var adjustedTime = e.seektime;
    if (e.willBePlaying) {
        adjustedTime += (Date.now() / 1000) - e.senttime;
    }
    console.log(`Seeking to adjusted time: ${adjustedTime}`)

    switch (e.type) {
        case 'play':
            abortNext.seeked = true;
            abortNext.play = true;
            playerjs.currentTime = adjustedTime;
            playerjs.play();
            break;
        case 'pause':
            abortNext.seeked = true;
            abortNext.pause = true;
            playerjs.pause();
            playerjs.currentTime = adjustedTime;
            break;
        case 'seeked':
            abortNext.seeked = true;
            playerjs.currentTime = adjustedTime;
            break;
    }
});

