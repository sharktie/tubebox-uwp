/* prelude.js: shared by the scripts after it.
 *
 * The app (TubeBox/MainPage.xaml.cs) joins the files in Inject/ into one script and runs it at the
 * start of every YouTube page, before YouTube's own code:
 *
 *   (function (config) { prelude.js, adblock.js, upgrade.js, sponsorblock.js, video.js,
 *                        controller.js })({ ...settings... });
 *
 * config: { xbox, blockAds, sponsorBlock, filters: {pruneKeys, pruneItems},
 *           codec: 'auto'|'vp9'|'h264', maxHeight }
 */
var webview = window.chrome && window.chrome.webview;
var isTop = window.top === window;
var hasOwn = Object.prototype.hasOwnProperty;

function post(type, payload) {
    if (!webview || !isTop) return;
    var msg = { type: type };
    for (var k in payload) if (hasOwn.call(payload, k)) msg[k] = payload[k];
    try { webview.postMessage(msg); } catch (e) {}
}

function log(message) {
    post('app.log', { message: String(message) });
}

/* Replaces obj[name] with a wrapper that still reads as native code, so the page can't tell. */
function wrapMethod(obj, name, make) {
    var original = obj[name];
    if (typeof original !== 'function') return;
    var wrapper = make(original);
    var text = 'function ' + name + '() { [native code] }';
    try {
        Object.defineProperty(wrapper, 'toString', { value: function () { return text; }, configurable: true });
        Object.defineProperty(wrapper, 'name', { value: name, configurable: true });
    } catch (e) {}
    try {
        Object.defineProperty(obj, name, { value: wrapper, writable: true, configurable: true, enumerable: false });
    } catch (e) {
        obj[name] = wrapper;
    }
}
