/* video.js: the codec and quality limits from TubeBox's settings.
 *
 * The TV app asks the browser which formats it can play (MediaSource.isTypeSupported, and
 * mediaCapabilities.decodingInfo for each size) and streams the best one it is told about. Saying
 * "no" to AV1 (or to AV1 and VP9), or to anything taller than the chosen quality, keeps it to
 * formats the console decodes smoothly.
 *
 * config.codec: 'auto' | 'vp9' (no AV1) | 'h264' (no AV1 or VP9); config.maxHeight: 0 for no limit.
 */
(function () {
    var codec = config.codec || 'auto';
    var maxHeight = config.maxHeight || 0;
    if (codec === 'auto' && !maxHeight) return;

    var blockedCodecs = codec === 'h264' ? /av01|vp9|vp09/i : codec === 'vp9' ? /av01/i : null;

    function codecBlocked(type) {
        return !!blockedCodecs && typeof type === 'string' && /^video\//i.test(type) && blockedCodecs.test(type);
    }

    // Portrait videos (Shorts) count by their width: 1080x1920 is 1080p.
    function sizeBlocked(video) {
        if (!maxHeight || !video || !video.width || !video.height) return false;
        return Math.min(video.width, video.height) > maxHeight;
    }

    /* The TV app also asks with TV-style size parameters ('video/webm; codecs="vp9"; width=3840')
       and first checks that an impossible size (width=99999) is refused; if it is, it trusts the
       answers for the real sizes and picks within them from the start. */
    function paramsBlocked(type) {
        if (!maxHeight || typeof type !== 'string') return false;
        var width = /;\s*width=(\d+)/i.exec(type);
        var height = /;\s*height=(\d+)/i.exec(type);
        return (!!width && +width[1] > Math.round(maxHeight * 16 / 9)) || (!!height && +height[1] > maxHeight);
    }

    if (window.MediaSource) {
        wrapMethod(MediaSource, 'isTypeSupported', function (isTypeSupported) {
            return function (type) {
                return codecBlocked(type) || paramsBlocked(type) ? false : isTypeSupported.apply(this, arguments);
            };
        });
    }

    wrapMethod(HTMLMediaElement.prototype, 'canPlayType', function (canPlayType) {
        return function (type) {
            return codecBlocked(type) ? '' : canPlayType.apply(this, arguments);
        };
    });

    if (window.MediaCapabilities && navigator.mediaCapabilities) {
        wrapMethod(MediaCapabilities.prototype, 'decodingInfo', function (decodingInfo) {
            return function (configuration) {
                var video = configuration && configuration.video;
                if (video && (codecBlocked(video.contentType) || sizeBlocked(video))) {
                    return Promise.resolve({ supported: false, smooth: false, powerEfficient: false, configuration: configuration });
                }
                return decodingInfo.apply(this, arguments);
            };
        });
    }
})();
