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
 * The app build YouTube serves that device also misplaces the video in Shorts (fitShorts) and
 * draws black boxes behind text (fixLegacyLook). Its missing animations are turned back on by
 * the address the app opens (env_forceFullAnimation, MainPage.xaml.cs).
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

    function walk(node, depth, previews) {
        if (!node || typeof node !== 'object' || depth > 100) return;
        if (Array.isArray(node)) {
            for (var i = 0; i < node.length; i++) walk(node[i], depth + 1, previews);
            return;
        }
        var tile = node.tileRenderer;
        if (tile && typeof tile === 'object') {
            upgradeThumbnail(tile.header && tile.header.tileHeaderRenderer);
            if (previews) addPreview(tile);
        }
        for (var key in node) {
            if (hasOwn.call(node, key)) walk(node[key], depth + 1, previews);
        }
    }

    /* No previews on the related videos below a playing video, as on other TVs: a preview would
       stop the video and then take over the screen. They come with the video (its watch-next
       response), and more of them load while it plays. */
    function wantsPreviews(result) {
        if (result.currentVideoEndpoint || (result.contents && result.contents.singleColumnWatchNextResults)) return false;
        if (!result.contents && /^#\/watch/.test(location.hash)) return false;
        return true;
    }

    /* Shorts: this build lays the video out for the whole screen and slides it off to the left,
       instead of into the Shorts frame in the middle. While a Short is open, a stylesheet rule
       (which the player's own inline sizes can't override) puts it inside the frame, filled
       the way other TVs show it. */
    function fitShorts() {
        var root = document.documentElement;
        var page = document.querySelector('ytlr-shorts-page');
        var ring = page && page.getBoundingClientRect().width > 0 && document.querySelector('ytlr-player-focus-ring');
        var video = ring && document.querySelector('.html5-video-player video.video-stream');
        var box = ring && ring.getBoundingClientRect();
        if (!video || !box || box.width < 50 || box.height < 50) {
            if (root.hasAttribute('data-tubebox-shorts')) root.removeAttribute('data-tubebox-shorts');
            return;
        }
        var border = parseFloat(getComputedStyle(ring).borderLeftWidth) || 0;
        var container = video.parentElement.getBoundingClientRect();
        var values = {
            '--tubebox-shorts-left': (box.left + border - container.left) + 'px',
            '--tubebox-shorts-top': (box.top - container.top) + 'px',
            '--tubebox-shorts-width': (box.width - 2 * border) + 'px',
            '--tubebox-shorts-height': box.height + 'px'
        };
        for (var name in values) {
            if (root.style.getPropertyValue(name) !== values[name]) root.style.setProperty(name, values[name]);
        }
        if (!root.hasAttribute('data-tubebox-shorts')) root.setAttribute('data-tubebox-shorts', '');
    }

    /* The build's stylesheet also has an old-TV look (rules under .app-quality-root): solid black
       boxes behind the title, channel and times over a video, and no text shadows. Those rules
       are found by what they do (the class names change with every YouTube release) and
       changed: the boxes become a shadow behind the text, and the shadows come back. The rest of
       the old-TV rules stay; some of them keep the video visible. */
    var TEXT_SHADOW = '0 0 0.5rem rgba(0, 0, 0, 0.9), 0 0.1rem 0.25rem rgba(0, 0, 0, 0.9)';
    var fixedRules = typeof WeakSet === 'function' ? new WeakSet() : null;

    function fixLegacyRules(list, owner) {
        for (var i = list.length - 1; i >= 0; i--) {
            var rule = list[i];
            if (rule.cssRules && !rule.selectorText) {
                fixLegacyRules(rule.cssRules, rule);
                continue;
            }
            if (!rule.selectorText || rule.selectorText.indexOf('app-quality-root') < 0 || (fixedRules && fixedRules.has(rule))) continue;
            var style = rule.style;
            if (style.backgroundColor === 'rgb(0, 0, 0)' && style.display === 'inline') {
                style.backgroundColor = 'transparent';
                style.textShadow = TEXT_SHADOW;
                if (fixedRules) fixedRules.add(rule);
            } else if (style.textShadow === 'none' && style.length === 1) {
                owner.deleteRule(i);
            }
        }
    }

    function fixLegacyLook() {
        for (var i = 0; i < document.styleSheets.length; i++) {
            var sheet = document.styleSheets[i];
            try {
                fixLegacyRules(sheet.cssRules, sheet);
            } catch (e) {
                // A stylesheet from another site; not YouTube's.
            }
        }
    }

    if (isTop) {
        // Stylesheets arrive as the app loads its parts; look again whenever one is added.
        var watchStyles = function () {
            fixLegacyLook();
            new MutationObserver(fixLegacyLook).observe(document.head || document.documentElement, { childList: true });
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchStyles);
        else watchStyles();

        var shortsStyle = document.createElement('style');
        shortsStyle.textContent =
            'html[data-tubebox-shorts] .html5-video-player video.video-stream {' +
            ' left: var(--tubebox-shorts-left) !important; top: var(--tubebox-shorts-top) !important;' +
            ' width: var(--tubebox-shorts-width) !important; height: var(--tubebox-shorts-height) !important;' +
            ' object-fit: cover !important; }' +
            /* The shade over the video while the related videos below it are in focus: the old-TV
               rules hide it. It is the full-screen layer the app tints with the video's colours;
               the app itself fades it in and out. Translucent, as on other TVs. */
            ' ytlr-watch-default > div[style*="gradient"] {' +
            ' display: block !important; background-color: rgba(0, 0, 0, 0.3) !important; }';
        var addStyle = function () { (document.head || document.documentElement).appendChild(shortsStyle); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addStyle);
        else addStyle();
        setInterval(fitShorts, 250);
    }

    wrapMethod(JSON, 'parse', function (parse) {
        return function (text) {
            var result = parse.apply(this, arguments);
            if (typeof text === 'string' && text.indexOf('"tileRenderer"') >= 0 && result && typeof result === 'object') {
                try {
                    walk(result, 0, wantsPreviews(result));
                } catch (e) {
                    log('upgrading tiles failed: ' + e);
                }
            }
            return result;
        };
    });
})();
