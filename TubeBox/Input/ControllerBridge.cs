using System;
using Windows.Gaming.Input;
using Windows.UI.Xaml;

namespace TubeBox.Input
{
    /// <summary>
    /// Reads the controller and hands out named actions ("up", "select", "back", ...).
    /// Inside WebView2 on Xbox the page never sees the A or B buttons, so the app reads them here
    /// and Inject/controller.js presses the matching TV remote key in YouTube's page.
    /// </summary>
    internal sealed class ControllerBridge : IDisposable
    {
        private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(30);
        private static readonly TimeSpan FirstRepeatDelay = TimeSpan.FromMilliseconds(400);
        private static readonly TimeSpan RepeatInterval = TimeSpan.FromMilliseconds(110);
        // A stick direction starts past StickThreshold and lasts until the stick falls back under
        // StickRelease, so a stick resting near one value can't flicker on and off and move twice.
        private const double StickThreshold = 0.6;
        private const double StickRelease = 0.35;
        private const double TriggerThreshold = 0.5;

        private static readonly ButtonAction[] Buttons =
        {
            new ButtonAction(GamepadButtons.A, "select"),
            new ButtonAction(GamepadButtons.B, "back"),
            new ButtonAction(GamepadButtons.X, "x"),
            new ButtonAction(GamepadButtons.Y, "y"),
            new ButtonAction(GamepadButtons.Menu, "menu"),
            new ButtonAction(GamepadButtons.View, "view"),
            new ButtonAction(GamepadButtons.LeftShoulder, "lb"),
            new ButtonAction(GamepadButtons.RightShoulder, "rb"),
        };

        private readonly Action<string, bool> _send;
        private readonly DispatcherTimer _timer = new DispatcherTimer();
        private GamepadButtons _previousButtons;
        private bool _previousLeftTrigger;
        private bool _previousRightTrigger;
        private string _heldDirection;
        private string _stickDirection;
        private DateTime _nextRepeat;

        /// <param name="send">Called on the UI thread with an action name and whether it is a held-down repeat.</param>
        public ControllerBridge(Action<string, bool> send)
        {
            _send = send;
            // Buttons already down at start (e.g. the A press that launched the app) don't count.
            var reading = Read();
            _previousButtons = reading.Buttons;
            _previousLeftTrigger = reading.LeftTrigger;
            _previousRightTrigger = reading.RightTrigger;
            _timer.Interval = PollInterval;
            _timer.Tick += OnTick;
            _timer.Start();
        }

        /// <summary>While true the controller is left to XAML, e.g. for a dialog or the load error screen.</summary>
        public bool Paused { get; set; }

        public void Dispose()
        {
            _timer.Stop();
        }

        private void OnTick(object sender, object e)
        {
            var reading = Read();
            var pressed = reading.Buttons & ~_previousButtons;
            var leftTriggerPressed = reading.LeftTrigger && !_previousLeftTrigger;
            var rightTriggerPressed = reading.RightTrigger && !_previousRightTrigger;
            _previousButtons = reading.Buttons;
            _previousLeftTrigger = reading.LeftTrigger;
            _previousRightTrigger = reading.RightTrigger;
            if (Paused)
            {
                _heldDirection = null;
                return;
            }

            var now = DateTime.UtcNow;
            if (reading.Direction != _heldDirection)
            {
                _heldDirection = reading.Direction;
                if (reading.Direction != null)
                {
                    _send(reading.Direction, false);
                    _nextRepeat = now + FirstRepeatDelay;
                }
            }
            else if (reading.Direction != null && now >= _nextRepeat)
            {
                _send(reading.Direction, true);
                _nextRepeat = now + RepeatInterval;
            }

            foreach (var button in Buttons)
            {
                if ((pressed & button.Button) != 0)
                {
                    _send(button.Name, false);
                }
            }
            if (leftTriggerPressed)
            {
                _send("lt", false);
            }
            if (rightTriggerPressed)
            {
                _send("rt", false);
            }
        }

        private ControllerReading Read()
        {
            var result = new ControllerReading();
            double stickX = 0, stickY = 0;
            foreach (var gamepad in Gamepad.Gamepads)
            {
                var reading = gamepad.GetCurrentReading();
                result.Buttons |= reading.Buttons;
                result.LeftTrigger |= reading.LeftTrigger > TriggerThreshold;
                result.RightTrigger |= reading.RightTrigger > TriggerThreshold;
                if (result.Direction == null)
                {
                    result.Direction = GetDPadDirection(reading.Buttons);
                }
                // With several controllers, the stick pushed furthest counts.
                if (Math.Max(Math.Abs(reading.LeftThumbstickX), Math.Abs(reading.LeftThumbstickY)) >
                    Math.Max(Math.Abs(stickX), Math.Abs(stickY)))
                {
                    stickX = reading.LeftThumbstickX;
                    stickY = reading.LeftThumbstickY;
                }
            }
            var stick = GetStickDirection(stickX, stickY);
            if (result.Direction == null)
            {
                result.Direction = stick;
            }
            return result;
        }

        private static string GetDPadDirection(GamepadButtons buttons)
        {
            if ((buttons & GamepadButtons.DPadUp) != 0) return "up";
            if ((buttons & GamepadButtons.DPadDown) != 0) return "down";
            if ((buttons & GamepadButtons.DPadLeft) != 0) return "left";
            if ((buttons & GamepadButtons.DPadRight) != 0) return "right";
            return null;
        }

        private string GetStickDirection(double x, double y)
        {
            var strongest = Math.Abs(y) >= Math.Abs(x) ? (y > 0 ? "up" : "down") : (x > 0 ? "right" : "left");
            if (_stickDirection != null && Along(_stickDirection, x, y) >= StickRelease)
            {
                // Still held. Swinging round to another direction counts once it is pushed as far
                // as a new press would need.
                if (strongest != _stickDirection && Along(strongest, x, y) >= StickThreshold)
                {
                    _stickDirection = strongest;
                }
                return _stickDirection;
            }
            _stickDirection = Math.Max(Math.Abs(x), Math.Abs(y)) >= StickThreshold ? strongest : null;
            return _stickDirection;
        }

        /// <summary>How far the stick is pushed in the given direction (negative if the other way).</summary>
        private static double Along(string direction, double x, double y)
        {
            switch (direction)
            {
                case "up": return y;
                case "down": return -y;
                case "right": return x;
                default: return -x;
            }
        }

        private sealed class ControllerReading
        {
            public GamepadButtons Buttons;
            public bool LeftTrigger;
            public bool RightTrigger;
            public string Direction;
        }

        private struct ButtonAction
        {
            public ButtonAction(GamepadButtons button, string name)
            {
                Button = button;
                Name = name;
            }

            public GamepadButtons Button;
            public string Name;
        }
    }
}
