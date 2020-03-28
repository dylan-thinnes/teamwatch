// Grab all base elements
var header = document.getElementById("header");
var filename = document.getElementById("filename");
var subs = document.getElementById("subs");
var player = document.getElementById("player");
var heartbeat = document.getElementById("heartbeat--table");
var heartbeatNicks = document.getElementById("heartbeat--table--nicks");
var heartbeatLags = document.getElementById("heartbeat--table--lags");
var nick = document.getElementById("nick");
var videoFileDisplay = document.getElementById("videoFileDisplay");
var subtitleFileDisplay = document.getElementById("subtitleFileDisplay");
var synchronize = document.getElementById("synchronize");
var timer = document.getElementById("player--underlay--timer");

// Initialize timesync primitives
var ts = timesync.create({
    server: '/timesync',
    interval: 1000
});

var now = () => ts.now();

// Initialize the player
var playerjs = new Plyr('#player', {captions: {update: true, active: true}});
window.playerjs;

// Initialize the global "source" for the player
var source = {};
function updateSource (newsrc) {
    console.log("Updating source: ", source, newsrc);
    source = { ...source, ...newsrc };
    playerjs.source = source;

    var { sources: videos, tracks } = source;
    videos = videos || [];
    tracks = tracks || [];

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

};
updateSource({
    type: "video",
    sources: [],
    tracks: [],
});

// Functions for generating sources, both for subtitles and videos
function genVideoSource (file, defaultName) {
    if (file instanceof File) {
        var src = URL.createObjectURL(file);
        var name = file.name;
    } else if (typeof file == "string") {
        var src = file;
        var name = defaultName || "Untitled";
    }

    return { src, name };
}

function genYoutubeSource (...args) {
    var res = genVideoSource(...args);
    res.provider = "youtube";
    return res;
}

function genTrackSource (file) {
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
function updateFromFiles (files) {
    for (file of files) {
        if (!(file instanceof File)) continue;

        var mime = file.type;
        console.log(file, mime)
        if (mime == "video/mp4") {
            videos = [];
            console.log("Adding video:", file);
            addVideoSource(genVideoSource(file));
        } else if (mime == "text/vtt") {
            console.log("Adding subtitle:", file);
            addTrackSource(genTrackSource(file));
        } else if (mime == "application/x-subrip") {
            console.log("Adding subtitle:", file);
            srt2webvttFile(file, (blob) => {
                addTrackSource(genTrackSource(blob));
            });
        }
    }
}

function addVideoSource (videoSource) {
    var { sources } = source;
    sources = [videoSource];
    updateSource({ sources });
}

function addTrackSource (trackSource) {
    var { tracks } = source;
    tracks.push(trackSource);
    updateSource({ tracks });
}

function srt2webvtt (data) {
    // remove dos newlines
    var srt = data.replace(/\r+/g, '');
    // trim white space start and end
    srt = srt.replace(/^\s+|\s+$/g, '');

    // get cues
    var cuelist = srt.split('\n\n');
    var result = "";

    if (cuelist.length > 0) {
        result += "WEBVTT\n\n";
        for (var i = 0; i < cuelist.length; i=i+1) {
            result += convertSrtCue(cuelist[i]);
        }
    }

    return result;
}

function convertSrtCue(caption) {
    // remove all html tags for security reasons
    //srt = srt.replace(/<[a-zA-Z\/][^>]*>/g, '');

    var cue = "";
    var s = caption.split(/\n/);

    // concatenate muilt-line string separated in array into one
    while (s.length > 3) {
        for (var i = 3; i < s.length; i++) {
            s[2] += "\n" + s[i]
        }
        s.splice(3, s.length - 3);
    }

    var line = 0;

    // detect identifier
    if (!s[0].match(/\d+:\d+:\d+/) && s[1].match(/\d+:\d+:\d+/)) {
        cue += s[0].match(/\w+/) + "\n";
        line += 1;
    }

    // get time strings
    if (s[line].match(/\d+:\d+:\d+/)) {
        // convert time string
        var m = s[1].match(/(\d+):(\d+):(\d+)(?:,(\d+))?\s*--?>\s*(\d+):(\d+):(\d+)(?:,(\d+))?/);
        if (m) {
            cue += m[1]+":"+m[2]+":"+m[3]+"."+m[4]+" --> "+m[5]+":"+m[6]+":"+m[7]+"."+m[8]+"\n";
            line += 1;
        } else {
            // Unrecognized timestring
            return "";
        }
    } else {
        // file format error or comment lines
        return "";
    }

    // get cue text
    if (s[line]) {
        cue += s[line] + "\n\n";
    }

    return cue;
}

function srt2webvttFile (file, callback) {
    console.log("Called.")
    var r = new FileReader();
    r.onload = () => {
        var srt = r.result;
        var vtt = srt2webvtt(srt);
        var res = new Blob([vtt], { type: 'text/vtt' });
        res.name = file.name;
        callback(res);
    }
    r.readAsText(file);
}

// Track file updates
filename.addEventListener("change", e => updateFromFiles(e.target.files || []));

// Initialize websocket connection
var conn = io(`http://${window.location.hostname}:3000`);

// Function for triggering a player events on the connection
function trigger (type, data, channel) {
    var channel = channel || 'controlsup';
    var id = Math.random();
    seenEvents.add(id);
    conn.emit(channel, {
        ...data, id, type,
        seektime: playerjs.currentTime,
        senttime: now() / 1000,
    });
}

// Event listeners for the player
var abortNext = {};

function setPlayerListener (event, handler, nonotify) {
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

let countdownActive = false;

setPlayerListener("play", e => {
    if (countdownActive == true) return;
    trigger('countdown', {
        targetSeektime: playerjs.currentTime,
    }, 'countdown');
    abortNext.pause = true;
    playerjs.pause();
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
        senttime: now() / 1000,
        willBePlaying: playerjs.playing
    });
});

setInterval(_ => {
    trigger("heartbeat", {
        currentTime: playerjs.currentTime,
        isPlaying: playerjs.playing,
        nick: nick.value || "Anon",
    }, 'heartbeat');
}, 1000);

var mean = xs => xs.reduce((x,y) => x + y, 0) / xs.length

var seenEvents = new Set();

var lastHeartreply = null;
heartreplySyncedtime = (heart) => {
    let curr = now() / 1000;
    let syncedtime = heart.senttime - heart.currentTime;
    if (heart.isPlaying == false) {
        syncedtime += curr - heart.senttime;
    }
    return syncedtime;
}

conn.on('heartreply', e => {
    // console.log('heartreply', e);
    let hearts = Object.values(e).filter(x => x != null && typeof x == 'object');
    let curr = now() / 1000;
    for (heart of hearts) {
        heart.syncedtime = heartreplySyncedtime(heart);
    }
    e.meanSyncedtime = mean(hearts.map(x => x.syncedtime));
    heartbeatNicks.innerHTML = `<div><b>Nick</b></div>`;
    heartbeatLags.innerHTML  = `<div><b>Time Lag</b></div>`;
    for (var heart of hearts) {
        let delta = heart.syncedtime - e.meanSyncedtime;
        heart.delta = delta;
        heartbeatNicks.innerHTML += `<div>${heart.nick || 'Anon'}${heart.uid == e.you ? ' (You)' : ''}</div>`
        lagClass = Math.abs(delta) > 0.5 ? 'bad' : Math.abs(delta) > 0.1 ? 'ok' : 'good';
        heartbeatLags.innerHTML  += `<div class='${lagClass}'>
                                         ${Math.round((delta + Number.EPSILON) * 100) / 100}
                                     </div>`;
    }
    lastHeartreply = e;
});

var id = x => {
    console.log(x);
    return x;
}

// Function for synchronization to last heartreply after joining
function runSynchronize () {
    console.log("synchronize");
    let e = lastHeartreply;
    let hearts = Object.values(e).filter(x => x != null && typeof x == 'object' && x.uid != e.you);
    let meanSyncedtime = mean(hearts.map(x => heartreplySyncedtime(x)));
    let meanSeektime = now() / 1000 - meanSyncedtime;
    fireAtTarget({
        target: now() + 5000,
        targetSeektime: meanSeektime + 5,
    });
}

synchronize.addEventListener("click", runSynchronize);

function fireAtTarget (e) {
    let curr = now();
    countdownActive = true;
    if (e.target > curr) {
        let diff = e.target - curr;
        abortNext.seeked = true;
        playerjs.currentTime = e.targetSeektime;


        timer.className = "show";
        let cancelId;
        let timerDiff = diff / 1000;
        cancelId = setInterval(() => {
            if (timerDiff <= 0.1) {
                timer.className = null;
                clearInterval(cancelId);
            }
            var text = Math.floor((timerDiff + Number.EPSILON) * 10) / 10
            text = text.toString() + (text == Math.floor(text) ? ".0" : "");
            timer.innerHTML = text;
            timerDiff -= 0.1;
        }, 100);

        setTimeout(() => {
            abortNext.play = true;
            playerjs.play();
            countdownActive = false;
        }, diff);
    } else {
        var adjustedTime = e.targetSeektime;
        adjustedTime += (now() / 1000) - e.target / 1000;
        abortNext.seeked = true;
        playerjs.currentTime = adjustedTime;
        abortNext.play = true;
        playerjs.play();
        countdownActive = false;
    }
}

conn.on('countdown', fireAtTarget);

conn.on('controlsdown', e => {
    console.log("Event", e);

    if (seenEvents.has(e.id)) {
        console.log("Event already seen.");
        return;
    }
    seenEvents.add(e.id);

    var adjustedTime = e.seektime;
    if (e.willBePlaying) {
        adjustedTime += (now() / 1000) - e.senttime;
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

