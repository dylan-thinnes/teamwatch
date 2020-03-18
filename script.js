// Grab all base elements
var header = document.getElementById("header");
var filename = document.getElementById("filename");
var subs = document.getElementById("subs");
var player = document.getElementById("player");
var heartbeat = document.getElementById("heartbeat--table");
var nick = document.getElementById("nick");
var videoFileDisplay = document.getElementById("videoFileDisplay");
var subtitleFileDisplay = document.getElementById("subtitleFileDisplay");

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

    return { src, name: file.name };
}

var genTrackSource = file => {
    let track = {
        kind: "captions",
        src: URL.createObjectURL(file),
        srclang: "en",
        label: "English",
        default: true,
        name: file.name,
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
            videos = [];
            console.log("Adding video:", file);
            videos.push(genVideoSource(file));
        } else if (mime == "text/vtt") {
            tracks = [];
            console.log("Adding subtitle:", file);
            tracks.push(genTrackSource(file));
        }
    }

    if (videos.length > 0) {
        videoFileDisplay.innerHTML = videos[0].name;
    } else {
        videoFileDisplay.innerHTML = "No video chosen.";
    }

    if (tracks.length > 0) {
        subtitleFileDisplay.innerHTML = tracks[0].name;
    } else {
        subtitleFileDisplay.innerHTML = "No subtitle chosen.";
    }

    updateSource({
        type: "video",
        tracks,
        sources: videos
    });
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
    console.log("Pause was triggered.")
    trigger("pause", {
        willBePlaying: false
    });
});

setPlayerListener("seeked", e => {
    console.log("Next pause will be aborted due to seek.")
    if (playerjs.playing == true) {
        abortNext.pause = true;
        playerjs.pause();
    }
    trigger("seeked", {
        seektime: playerjs.currentTime,
        senttime: Date.now() / 1000,
        willBePlaying: playerjs.playing
    });
});

setPlayerListener("canplay", e => {
    console.log("CANPLAY");
}, true);

setInterval(_ => {
    trigger("heartbeat", {
        currentTime: playerjs.currentTime,
        isPlaying: playerjs.playing,
        nick: nick.value || "Anon",
    }, 'heartbeat');
}, 1000);

var mean = xs => xs.reduce((x,y) => x + y, 0) / xs.length

var seenEvents = new Set();
conn.on('heartreply', e => {
    // console.log('heartreply', e);
    let hearts = Object.values(e).filter(x => x != null && typeof x == 'object');
    let curr = Date.now() / 1000;
    for (heart of hearts) {
        let syncedtime = heart.senttime - heart.currentTime;
        if (heart.isPlaying == false) {
            syncedtime += curr - heart.senttime;
        }
        heart.syncedtime = syncedtime;
    }
    let meanSyncedtime = mean(hearts.map(x => x.syncedtime));
    heartbeat.innerHTML = `
<tr>
    <th>Nick</th>
    <th>Time Lag</th>
</tr>
`;
    for (var heart of hearts) {
        let delta = heart.syncedtime - meanSyncedtime;
        heartbeat.innerHTML += `<tr><td>${heart.nick || heart.uid}</td><td>${Math.round((delta + Number.EPSILON) * 100) / 100}</td></tr>`;
    }
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
            if (playerjs.playing == true) {
                abortNext.pause = true;
                playerjs.pause();
            }
            playerjs.currentTime = adjustedTime;
            break;
        case 'seeked':
            abortNext.seeked = true;
            if (playerjs.playing == true) {
                abortNext.pause = true;
                playerjs.pause();
            }
            playerjs.currentTime = adjustedTime;
            break;
    }
});

