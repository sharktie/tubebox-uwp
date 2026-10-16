/* sponsorblock.js: skips the sponsor reads, self-promotion and "like and subscribe" reminders
 * inside videos, using the segments people mark on SponsorBlock (sponsor.ajay.app). These are part
 * of the video itself, so no ad blocker removes them.
 *
 * Only the first four characters of a hash of the video's ID are sent, as the SponsorBlock browser
 * extension does: the answer lists every marked video with that prefix, and the right one is
 * picked out here, so SponsorBlock can't tell what is being watched.
 */
if (config.sponsorBlock && isTop && window.crypto && crypto.subtle) (function () {
    var API = 'https://sponsor.ajay.app/api/skipSegments/';
    var CATEGORIES = ['sponsor', 'selfpromo', 'interaction'];
    var NAMES = { sponsor: 'sponsor', selfpromo: 'self-promotion', interaction: 'subscribe reminder' };

    var videoId = null;
    var segments = [];
    var lastSkip = 0;
    var toast = null;
    var toastTimer = 0;

    function currentVideoId() {
        var match = /[?&]v=([\w-]{11})/.exec(location.hash);
        return match ? match[1] : null;
    }

    function load(id) {
        videoId = id;
        segments = [];
        if (!id) return;
        crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)).then(function (digest) {
            var hex = Array.prototype.map.call(new Uint8Array(digest), function (b) {
                return ('0' + b.toString(16)).slice(-2);
            }).join('');
            var url = API + hex.slice(0, 4) + '?categories=' + encodeURIComponent(JSON.stringify(CATEGORIES));
            return fetch(url, { credentials: 'omit' }).then(function (response) {
                return response.status === 404 ? [] : response.json();
            });
        }).then(function (videos) {
            if (videoId !== id) return;
            var entry = (videos || []).filter(function (v) { return v.videoID === id; })[0];
            segments = ((entry && entry.segments) || []).filter(function (s) {
                return s.actionType === 'skip' && s.segment && s.segment[1] - s.segment[0] >= 1;
            });
            if (segments.length) log('SponsorBlock: ' + segments.length + ' segment(s) to skip');
        }).catch(function (e) {
            log('SponsorBlock lookup failed: ' + e);
        });
    }

    function showToast(text) {
        if (!document.body) return;
        if (!toast) {
            toast = document.createElement('div');
            toast.style.cssText = 'position:fixed;right:5vw;top:7vh;padding:1.2vh 1.6vw;border-radius:1vh;' +
                'background:rgba(15,15,15,.85);color:#fff;font:500 2.2vh/1.4 Roboto,Arial,sans-serif;' +
                'z-index:2147483647;pointer-events:none';
            document.body.appendChild(toast);
        }
        toast.textContent = text;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            if (toast) toast.remove();
            toast = null;
        }, 3000);
    }

    setInterval(function () {
        var id = currentVideoId();
        if (id !== videoId) load(id);
        if (!segments.length) return;
        var player = document.querySelector('.html5-video-player');
        var video = player && player.querySelector('video');
        if (!video || video.paused || player.classList.contains('ad-showing')) return;
        var duration = video.duration;
        var now = video.currentTime;
        for (var i = 0; i < segments.length; i++) {
            var s = segments[i];
            // Marked on a different cut of the video: the times would be wrong.
            if (s.videoDuration > 0 && isFinite(duration) && Math.abs(s.videoDuration - duration) > 3) continue;
            var start = s.segment[0];
            var end = Math.min(s.segment[1], isFinite(duration) ? duration - 0.5 : s.segment[1]);
            if (now >= start && now < end - 0.5 && Date.now() - lastSkip > 1000) {
                video.currentTime = end;
                lastSkip = Date.now();
                showToast('Skipped ' + (NAMES[s.category] || s.category) + ' (SponsorBlock)');
                post('app.sponsorblock', { skipped: 1 });
                return;
            }
        }
    }, 250);
})();
