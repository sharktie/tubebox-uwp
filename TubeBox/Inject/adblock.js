/* adblock.js: YouTube's ads removed the way uBlock Origin's YouTube filters do it.
 *
 * YouTube's ads come from youtube.com itself, inside the same responses as the videos, so
 * blocking ad servers isn't enough on its own. Like uBO's json-prune scriptlet, this takes the ad
 * parts out of every response before the TV app reads them: a video's ad breaks (adPlacements,
 * adSlots, playerAds) and the sponsored tiles and banners on the home screen (adSlotRenderer).
 * What to remove comes from filters.json (config.filters), which the app keeps up to date.
 *
 * If an ad plays anyway (YouTube changed something the filters don't cover yet), it is muted and
 * run through at 16x until the video starts. On some videos YouTube then holds the video back for
 * the ad's length whatever the client does; a notice says so while it waits.
 *
 * Ad servers and ad tracking requests are refused by the app itself (Blocking/RequestBlocker.cs).
 */
if (config.blockAds) (function () {
    var filters = config.filters || {};
    var keys = filters.pruneKeys || [];
    var items = filters.pruneItems || [];
    if (!keys.length && !items.length) return;

    var keySet = Object.create(null);
    var itemSet = Object.create(null);
    keys.forEach(function (k) { keySet[k] = true; });
    items.forEach(function (k) { itemSet[k] = true; });
    // Most responses carry no ads; a quick look at the text skips walking those.
    var marker = new RegExp('"(' + keys.concat(items).map(function (k) {
        return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|') + ')"');

    var pending = 0;
    var reportTimer = 0;
    var adsRemovedAt = 0;

    function report(removed, skipped) {
        pending += removed;
        if (skipped) post('app.adblock', { removed: 0, skipped: 1 });
        if (!reportTimer && pending) {
            reportTimer = setTimeout(function () {
                post('app.adblock', { removed: pending, skipped: 0 });
                pending = 0;
                reportTimer = 0;
            }, 1000);
        }
    }

    function isAdItem(item) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        for (var k in item) if (itemSet[k] === true && hasOwn.call(item, k)) return true;
        return false;
    }

    function prune(node, depth) {
        if (!node || typeof node !== 'object' || depth > 100) return 0;
        var removed = 0;
        if (Array.isArray(node)) {
            for (var i = node.length - 1; i >= 0; i--) {
                if (isAdItem(node[i])) {
                    node.splice(i, 1);
                    removed++;
                } else {
                    removed += prune(node[i], depth + 1);
                }
            }
        } else {
            for (var key in node) {
                if (!hasOwn.call(node, key)) continue;
                if (keySet[key] === true) {
                    delete node[key];
                    removed++;
                } else {
                    removed += prune(node[key], depth + 1);
                }
            }
        }
        return removed;
    }

    function clean(result) {
        try {
            var removed = prune(result, 0);
            if (removed) {
                report(removed, false);
                if (result.streamingData) adsRemovedAt = Date.now();
            }
        } catch (e) {
            log('ad filter failed: ' + e);
        }
        return result;
    }

    // The TV app reads its responses as text and parses them with JSON.parse.
    wrapMethod(JSON, 'parse', function (parse) {
        return function (text) {
            var result = parse.apply(this, arguments);
            if (typeof text === 'string' && text.length > 64 && result && typeof result === 'object' && marker.test(text)) {
                clean(result);
            }
            return result;
        };
    });

    // fetch(...).json() and XHR's 'json' responses don't go through JSON.parse.
    if (window.Response) {
        wrapMethod(Response.prototype, 'json', function () {
            return function () {
                return this.text().then(function (text) { return JSON.parse(text); });
            };
        });
    }
    var responseGetter = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
    if (responseGetter && responseGetter.get) {
        var getResponse = responseGetter.get;
        Object.defineProperty(XMLHttpRequest.prototype, 'response', {
            get: function () {
                var result = getResponse.call(this);
                return this.responseType === 'json' && result && typeof result === 'object' ? clean(result) : result;
            },
            configurable: true,
            enumerable: responseGetter.enumerable
        });
    }

    if (!isTop) return;

    /* For some videos YouTube's servers hold the picture back for about as long as the removed
       ad would have run (its answer to ad blockers; speeding through the ad doesn't shorten it).
       Say so, rather than leave a frozen 0:00 that looks broken. */
    var notice = null;
    var stuckSince = 0;

    function showNotice(show) {
        if (show && !notice && document.body) {
            notice = document.createElement('div');
            notice.textContent = 'Ad blocked. YouTube holds the video back for about as long as the ad would have run.';
            notice.style.cssText = 'position:fixed;left:5vw;bottom:7vh;max-width:60vw;padding:1.2vh 1.6vw;' +
                'border-radius:1vh;background:rgba(15,15,15,.85);color:#fff;font:500 2.2vh/1.4 Roboto,Arial,sans-serif;' +
                'z-index:2147483647;pointer-events:none';
            document.body.appendChild(notice);
        } else if (!show && notice) {
            notice.remove();
            notice = null;
        }
    }

    // The safety net: the player marks itself 'ad-showing' while an ad plays.
    var skipping = null;
    setInterval(function () {
        var player = document.querySelector('.html5-video-player');
        var video = player && player.querySelector('video');
        var showing = !!video && player.classList.contains('ad-showing');

        var stuck = !!video && !showing && !video.paused && video.currentTime < 0.3 &&
            Date.now() - adsRemovedAt < 90000;
        if (!stuck) stuckSince = 0;
        else if (!stuckSince) stuckSince = Date.now();
        showNotice(stuck && Date.now() - stuckSince > 4000);

        if (showing) {
            if (!skipping || skipping.video !== video) {
                skipping = { video: video, muted: video.muted, rate: video.playbackRate === 16 ? 1 : video.playbackRate };
                report(0, true);
                log('an ad got through the filters; speeding through it');
            }
            if (!video.muted) video.muted = true;
            if (video.playbackRate !== 16) video.playbackRate = 16;
        } else if (skipping) {
            skipping.video.muted = skipping.muted;
            skipping.video.playbackRate = skipping.rate;
            skipping = null;
        }
    }, 250);
})();
