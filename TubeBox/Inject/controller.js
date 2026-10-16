/* controller.js: the console controller, turned into the keys of a TV remote.
 *
 * Inside WebView2 on Xbox the page doesn't get the controller's buttons, so the app reads the
 * controller (TubeBox/Input/ControllerBridge.cs) and posts {type: 'input', action, repeat}. YouTube's
 * TV app already knows a remote's keys, so each action becomes that key, pressed on whatever has
 * focus:
 *   D-pad / left stick  arrows          A  OK (Enter)           B  back (Escape)
 *   X  play / pause                     Y  search
 *   LB / RB  previous / next video      LT / RT  rewind / fast-forward
 * Menu and View open TubeBox's settings in the app and never reach the page.
 */
if (isTop && webview) (function () {
    /* The console can deliver one press both through the app and as a key event in the page; the
       second copy within this window is dropped. */
    var DEDUPE_MS = 150;
    var KEYS = {
        up: [38, 'ArrowUp'],
        down: [40, 'ArrowDown'],
        left: [37, 'ArrowLeft'],
        right: [39, 'ArrowRight'],
        select: [13, 'Enter'],
        back: [27, 'Escape'],
        x: [179, 'MediaPlayPause'],
        y: [170, 'BrowserSearch'],
        lb: [177, 'MediaTrackPrevious'],
        rb: [176, 'MediaTrackNext'],
        lt: [227, 'MediaRewind'],
        rt: [228, 'MediaFastForward']
    };
    /* Real key events that mean the same as a controller action, for the de-duplication. */
    var KEY_ACTION = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        Enter: 'select', NumpadEnter: 'select', Escape: 'back', GoBack: 'back', BrowserBack: 'back'
    };
    var lastNative = {};
    var lastKey = {};
    var swallowed = {};

    function fire(type, def, repeat) {
        var target = document.activeElement;
        if (!target || target === document.documentElement) target = document.body || document.documentElement;
        var ev = new KeyboardEvent(type, {
            key: def[1], code: def[1], keyCode: def[0], which: def[0],
            repeat: !!repeat, bubbles: true, cancelable: true, view: window
        });
        /* The TV app reads keyCode; make sure it is set whatever the engine does with the legacy
           init members. */
        if (ev.keyCode !== def[0]) {
            try {
                Object.defineProperty(ev, 'keyCode', { get: function () { return def[0]; } });
                Object.defineProperty(ev, 'which', { get: function () { return def[0]; } });
            } catch (e) {}
        }
        target.dispatchEvent(ev);
    }

    webview.addEventListener('message', function (event) {
        var msg = event.data;
        if (!msg || msg.type !== 'input') return;
        var def = KEYS[msg.action];
        if (!def) return;
        var now = performance.now();
        lastNative[msg.action] = now;
        if (now - (lastKey[msg.action] || -1e9) < DEDUPE_MS) return;
        fire('keydown', def, msg.repeat);
        fire('keyup', def, false);
    });

    ['keydown', 'keyup'].forEach(function (type) {
        window.addEventListener(type, function (e) {
            if (!e.isTrusted) return;
            /* The Xbox's own gamepad key codes (195-218): the app's messages are the one source of
               controller input, so the TV app never sees a press twice. */
            if (e.keyCode >= 195 && e.keyCode <= 218) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
            var action = KEY_ACTION[e.key];
            if (!action) return;
            var now = performance.now();
            if (type === 'keydown') {
                lastKey[action] = now;
                swallowed[action] = now - (lastNative[action] || -1e9) < DEDUPE_MS;
            }
            if (swallowed[action]) {
                if (type === 'keyup') swallowed[action] = false;
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }, true);
    });

    /* Backing out of the start screen closes the TV app with window.close(), which the browser
       ignores for a page it didn't open by script; the app closes instead. */
    wrapMethod(window, 'close', function () {
        return function () { post('app.exit', {}); };
    });

    if (!config.xbox) return;

    /* The console turns the controller into a mouse pointer the page can't switch off. It is
       hidden, and its clicks and moves dropped, so A doesn't also click whatever is under it. */
    ['pointerdown', 'pointerup', 'pointermove', 'pointerover', 'mousedown', 'mouseup', 'mousemove',
     'mouseover', 'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel'].forEach(function (type) {
        window.addEventListener(type, function (e) {
            if (!e.isTrusted) return;
            e.preventDefault();
            e.stopImmediatePropagation();
        }, { capture: true, passive: false });
    });
    function hideCursor() {
        var style = document.createElement('style');
        style.textContent = 'html, html * { cursor: none !important; }';
        (document.head || document.documentElement).appendChild(style);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hideCursor);
    else hideCursor();

    /* The same goes for the Gamepad API: the page would see the controller as well as our keys. */
    if (navigator.getGamepads) {
        wrapMethod(Navigator.prototype, 'getGamepads', function () {
            return function () { return []; };
        });
    }
})();
