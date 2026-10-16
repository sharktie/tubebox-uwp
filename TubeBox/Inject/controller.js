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
    /* Off the console (on a PC), a controller press and a keyboard key meaning the same within this
       window count once. On the console the browser's own key events are dropped altogether
       (below). */
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
    /* Real key events that mean the same as a controller action. */
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

    var droppedLogged = 0;

    function logDropped(e) {
        if (droppedLogged >= 20) return;
        droppedLogged++;
        log('ignored the console\'s own ' + e.type + ' ' +
            (e.key !== undefined ? e.key + ' (' + e.keyCode + ')' : 'deltaY ' + e.deltaY) + (e.repeat ? ' repeat' : ''));
    }

    ['keydown', 'keyup', 'keypress'].forEach(function (type) {
        window.addEventListener(type, function (e) {
            if (!e.isTrusted) return;
            var action = KEY_ACTION[e.key];
            /* On the console the app's messages are the one source of controller input. The
               browser also turns the controller into key events of its own (its gamepad codes,
               195-218, arrow keys and others for the sticks, at its own moments), which would move
               YouTube a second time; every key event from it is dropped. Elsewhere only the
               gamepad codes are. */
            if (config.xbox || (e.keyCode >= 195 && e.keyCode <= 218)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (type === 'keydown') logDropped(e);
                return;
            }
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

    /* The console turns the controller into a mouse pointer the page can't switch off, and the
       right stick into scrolling. The pointer is hidden and its clicks and moves dropped, so A
       doesn't also click whatever is under it. Scroll wheel events are dropped too: the TV app
       turns each one into an arrow key. */
    ['pointerdown', 'pointerup', 'pointermove', 'pointerover', 'mousedown', 'mouseup', 'mousemove',
     'mouseover', 'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel', 'mousewheel'].forEach(function (type) {
        window.addEventListener(type, function (e) {
            if (!e.isTrusted) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (type === 'wheel' || type === 'mousewheel') logDropped(e);
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
