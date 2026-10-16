/* upgrade.js: what YouTube leaves out for the device TubeBox says it is.
 *
 * TubeBox presents itself as the Xbox's own YouTube app (TvUserAgent in MainPage.xaml.cs), the
 * identity that YouTube doesn't hold videos back for. YouTube takes it for an Xbox 360, though,
 * and leaves out two things it sends other TVs, which are put back here, in the same responses
 * adblock.js cleans:
 *  - Video tiles get 320x180 thumbnails, blurry on a 1080p tile. They become sddefault (640x480;
 *    the tile centres it and crops the letterbox off), or stay as they were for the odd video
 *    that has no sddefault.
 *  - A focused video tile doesn't start a preview. Other TVs get a startInlinePlaybackCommand
 *    on each tile; the same one is added (the values are the ones YouTube sends a Chromecast).
 */
(function () {
    var SMALL_THUMBNAIL = /^https:\/\/i\.ytimg\.com\/vi\/([\w-]{11})\/(?:hq|mq|)default\.jpg/;
    var checked = Object.create(null);

    function upgradeThumbnail(header) {
        var thumbnail = header && header.thumbnail;
        var list = thumbnail && thumbnail.thumbnails;
        if (!Array.isArray(list) || !list.length) return;
        var best = list[list.length - 1];
        var match = best && typeof best.url === 'string' && SMALL_THUMBNAIL.exec(best.url);
        if (!match || (best.width || 0) >= 600) return;
        var entry = { url: 'https://i.ytimg.com/vi/' + match[1] + '/sddefault.jpg', width: 640, height: 480 };
        thumbnail.thumbnails = [entry];
        checkThumbnail(entry, best.url);
    }

    /* A few videos have no sddefault; YouTube then answers with a small grey placeholder. The
       browser has the image cached from the tile by then, so loading it again here is free. If
       it isn't the real thing, the tile data goes back to the original, and tiles already
       showing it are fixed. */
    function checkThumbnail(entry, original) {
        var url = entry.url;
        var result = checked[url];
        if (result === undefined) {
            result = checked[url] = new Promise(function (resolve) {
                var image = new Image();
                image.onload = function () { resolve(image.naturalWidth >= 400); };
                image.onerror = function () { resolve(false); };
                image.src = url;
            });
        }
        result.then(function (ok) {
            if (ok) return;
            entry.url = original;
            entry.width = 320;
            entry.height = 180;
            var tiles = document.querySelectorAll('ytlr-thumbnail-details');
            for (var i = 0; i < tiles.length; i++) {
                if ((tiles[i].style.backgroundImage || '').indexOf(url) >= 0) {
                    tiles[i].style.backgroundImage = 'url("' + original + '")';
                }
            }
        });
    }

    function hasPreview(command) {
        return !!command && JSON.stringify(command).indexOf('startInlinePlaybackCommand') >= 0;
    }

    function addPreview(tile) {
        var select = tile.onSelectCommand;
        var endpoint = select && select.watchEndpoint;
        if (tile.contentType !== 'TILE_CONTENT_TYPE_VIDEO' || !endpoint || !endpoint.videoId || hasPreview(tile.onFocusCommand)) return;
        var preview = {
            startInlinePlaybackCommand: {
                caption: false,
                muted: false,
                delayMs: 3000,
                // The tile's own endpoint with its fast-start (Onesie) details, as other TVs get.
                playbackEndpoint: { watchEndpoint: Object.assign({}, endpoint) },
                blockAdoption: true,
                resumeVideo: true,
                restartPlaybackBeforeSeconds: 10,
                durationMs: 40000,
                // The tile ignores previews while YouTube's "previews with sound" setting is off,
                // which it is for this device. YouTube's own banner previews pass the same flag.
                overrideSettingsSwitch: true
            }
        };
        // Some tiles show a hint on focus instead. The tile only looks for the preview directly
        // on onFocusCommand, so the preview takes its place.
        tile.onFocusCommand = preview;
    }

    function walk(node, depth) {
        if (!node || typeof node !== 'object' || depth > 100) return;
        if (Array.isArray(node)) {
            for (var i = 0; i < node.length; i++) walk(node[i], depth + 1);
            return;
        }
        var tile = node.tileRenderer;
        if (tile && typeof tile === 'object') {
            upgradeThumbnail(tile.header && tile.header.tileHeaderRenderer);
            addPreview(tile);
        }
        for (var key in node) {
            if (hasOwn.call(node, key)) walk(node[key], depth + 1);
        }
    }

    wrapMethod(JSON, 'parse', function (parse) {
        return function (text) {
            var result = parse.apply(this, arguments);
            if (typeof text === 'string' && text.indexOf('"tileRenderer"') >= 0 && result && typeof result === 'object') {
                try {
                    walk(result, 0);
                } catch (e) {
                    log('upgrading tiles failed: ' + e);
                }
            }
            return result;
        };
    });
})();
