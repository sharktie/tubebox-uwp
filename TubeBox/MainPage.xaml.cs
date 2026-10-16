using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using TubeBox.Blocking;
using TubeBox.Bridge;
using TubeBox.Diagnostics;
using TubeBox.Input;
using TubeBox.Settings;
using Windows.Data.Json;
using Windows.Storage;
using Windows.System;
using Windows.System.Profile;
using Windows.UI.Core;
using Windows.UI.ViewManagement;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Input;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Navigation;

namespace TubeBox
{
    /// <summary>
    /// YouTube's own TV app (youtube.com/tv, the one smart TVs and consoles run) in a WebView2, with
    /// the scripts in Inject/ added to it: the controller as a TV remote, ad blocking,
    /// SponsorBlock, and the codec and quality limits from TubeBox's settings.
    /// </summary>
    public sealed partial class MainPage : Page, IPageHost
    {
        private const string HomeUrl = "https://www.youtube.com/tv";

        /// <summary>
        /// YouTube only serves its TV app to TVs and consoles. This is the Xbox's YouTube app: on some
        /// videos YouTube holds the picture back for as long as a blocked ad when it thinks it is
        /// talking to other devices (a Chromecast, for one), but not to an Xbox. The filter list can
        /// replace it (<see cref="FilterList.UserAgent"/>) if that changes.
        /// </summary>
        private const string TvUserAgent =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox Series X) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/48.0.2564.82 Safari/537.36 Edge/20.02";

        /// <summary>Joined in this order into the script added to every page (see Inject/prelude.js).</summary>
        private static readonly string[] ScriptParts = { "prelude.js", "adblock.js", "upgrade.js", "sponsorblock.js", "video.js", "controller.js" };

        private static readonly bool IsXbox = AnalyticsInfo.VersionInfo.DeviceFamily == "Windows.Xbox";

        private readonly Dictionary<string, string> _scriptTexts = new Dictionary<string, string>();
        private CoreWebView2 _core;
        private PageBridge _bridge;
        private ControllerBridge _controller;
        private RequestBlocker _blocker;
        private FilterList _filters;
        private string _scriptId;
        private ulong _homeNavigationId;
        private bool _dialogOpen;

        // This session's ad blocking, for the settings screen.
        private int _adsRemoved;
        private int _adsSkipped;
        private int _segmentsSkipped;
        private int _requestsBlockedEarlier;

        public MainPage()
        {
            Log.Write("Main page starting");
            this.InitializeComponent();
            // The controller moves YouTube's own highlight; the console's mouse-mode cursor would
            // only get in the way.
            SetPointerMode(false);
            PreviewKeyDown += OnPreviewKeyDown;
            Loaded += OnLoaded;
        }

        internal static bool IsYouTube(string url)
        {
            Uri uri;
            return Uri.TryCreate(url, UriKind.Absolute, out uri) && uri.Scheme == Uri.UriSchemeHttps &&
                (uri.Host.Equals("youtube.com", StringComparison.OrdinalIgnoreCase) ||
                 uri.Host.EndsWith(".youtube.com", StringComparison.OrdinalIgnoreCase));
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            base.OnNavigatedFrom(e);
            SystemNavigationManager.GetForCurrentView().BackRequested -= OnBackRequested;
            _controller?.Dispose();
            _bridge?.Dispose();
            _blocker?.Dispose();
#if DEBUG
            _devCommands?.Stop();
#endif
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            Loaded -= OnLoaded;
            Log.Write("Main page loaded, starting WebView2");
            SystemNavigationManager.GetForCurrentView().BackRequested += OnBackRequested;
            try
            {
                await WebView.EnsureCoreWebView2Async();
            }
            catch (Exception ex)
            {
                Log.Error("WebView2 failed to start", ex);
                ShowLoadError("The web view could not start. " + ex.Message);
                return;
            }
            Log.Write("WebView2 ready, browser " + WebView.CoreWebView2.Environment.BrowserVersionString);

            _core = WebView.CoreWebView2;
            _filters = await FilterList.LoadAsync();
            var settings = _core.Settings;
            settings.IsStatusBarEnabled = false;
            settings.IsZoomControlEnabled = false;
            settings.IsPinchZoomEnabled = false;
            // No browser shortcuts such as the back key: B is handled by ControllerBridge only.
            settings.AreBrowserAcceleratorKeysEnabled = false;
            settings.AreDefaultContextMenusEnabled = false;
            settings.IsGeneralAutofillEnabled = false;
            settings.IsPasswordAutosaveEnabled = false;
#if !DEBUG
            settings.AreDevToolsEnabled = false;
#endif
            _core.NavigationStarting += OnNavigationStarting;
            _core.NavigationCompleted += OnNavigationCompleted;
            _core.NewWindowRequested += OnNewWindowRequested;
            _core.WindowCloseRequested += OnWindowCloseRequested;
            _core.ProcessFailed += OnProcessFailed;

            try
            {
                await ApplySettingsAsync();
            }
            catch (Exception ex)
            {
                // Without its scripts the page has no controller support: better to say so.
                Log.Error("Adding the page scripts failed", ex);
                ShowLoadError("TubeBox couldn't prepare YouTube. " + ex.Message);
                return;
            }

            _bridge = new PageBridge(_core, this);
            _controller = new ControllerBridge(OnControllerAction);
#if DEBUG
            StartDevCommands(_core);
#endif
            Log.Write("Loading " + HomeUrl);
            _core.Navigate(HomeUrl);
            WebView.Focus(FocusState.Programmatic);
        }

        private void OnControllerAction(string action, bool repeat)
        {
            if (action == "menu" || action == "view")
            {
                if (!repeat)
                {
                    OpenSettings();
                }
                return;
            }
            _bridge?.SendInput(action, repeat);
        }

        /// <summary>
        /// Puts the current settings and filters into effect: the user agent and the script added to
        /// each page (both from the next page load) and the blocked addresses (straight away).
        /// </summary>
        private async Task ApplySettingsAsync()
        {
            _core.Settings.UserAgent = _filters.UserAgent ?? TvUserAgent;
            var script = await BuildPageScriptAsync();
            if (_scriptId != null)
            {
                _core.RemoveScriptToExecuteOnDocumentCreated(_scriptId);
            }
            _scriptId = await _core.AddScriptToExecuteOnDocumentCreatedAsync(script);

            if (_blocker != null)
            {
                _requestsBlockedEarlier += _blocker.Blocked;
                _blocker.Dispose();
                _blocker = null;
            }
            if (AppSettings.BlockAds)
            {
                _blocker = new RequestBlocker(_core, _filters.BlockUrls);
            }
            Log.Write(string.Format("Settings: ad blocking {0}, SponsorBlock {1}, codec {2}, maximum quality {3}",
                AppSettings.BlockAds ? "on" : "off", AppSettings.SponsorBlock ? "on" : "off", AppSettings.Codec,
                AppSettings.MaxHeight > 0 ? AppSettings.MaxHeight + "p" : "automatic"));
        }

        private async Task<string> BuildPageScriptAsync()
        {
            var config = new JsonObject();
            config.SetNamedValue("xbox", JsonValue.CreateBooleanValue(IsXbox));
            config.SetNamedValue("blockAds", JsonValue.CreateBooleanValue(AppSettings.BlockAds));
            config.SetNamedValue("sponsorBlock", JsonValue.CreateBooleanValue(AppSettings.SponsorBlock));
            config.SetNamedValue("filters", _filters.ToPageConfig());
            config.SetNamedValue("codec", JsonValue.CreateStringValue(AppSettings.Codec));
            config.SetNamedValue("maxHeight", JsonValue.CreateNumberValue(AppSettings.MaxHeight));

            var script = new StringBuilder();
            script.Append("(function (config) {\n'use strict';\n");
            // Only YouTube's pages; nothing else is ever loaded, but just in case.
            script.Append("if (!/(^|\\.)youtube\\.com$/.test(location.hostname)) return;\n");
            foreach (var part in ScriptParts)
            {
                script.Append(await ReadScriptAsync(part)).Append('\n');
            }
            script.Append("})(").Append(config.Stringify()).Append(");\n");
            return script.ToString();
        }

        private async Task<string> ReadScriptAsync(string name)
        {
            string text;
            if (!_scriptTexts.TryGetValue(name, out text))
            {
                var file = await StorageFile.GetFileFromApplicationUriAsync(new Uri("ms-appx:///Inject/" + name));
                text = await FileIO.ReadTextAsync(file);
                _scriptTexts[name] = text;
            }
            return text;
        }

        void IPageHost.CountAds(int removed, int skipped)
        {
            _adsRemoved += removed;
            _adsSkipped += skipped;
        }

        void IPageHost.CountSponsorSkips(int skipped)
        {
            _segmentsSkipped += skipped;
        }

        /// <summary>TubeBox's settings, on Menu or View.</summary>
        private async void OpenSettings()
        {
            if (_dialogOpen || _core == null || LoadErrorPanel.Visibility != Visibility.Collapsed)
            {
                return;
            }
            var blockAds = new ToggleSwitch { Header = "Block ads", IsOn = AppSettings.BlockAds };
            var sponsorBlock = new ToggleSwitch
            {
                Header = "Skip sponsor segments (SponsorBlock)",
                IsOn = AppSettings.SponsorBlock,
            };
            var codec = new ComboBox
            {
                Header = "Video codec",
                HorizontalAlignment = HorizontalAlignment.Stretch,
                ItemsSource = new[] { "Automatic (YouTube decides)", "VP9 (no AV1)", "H.264 (most compatible, up to 1080p)" },
                SelectedIndex = Array.IndexOf(AppSettings.Codecs, AppSettings.Codec),
            };
            var quality = new ComboBox
            {
                Header = "Maximum quality",
                HorizontalAlignment = HorizontalAlignment.Stretch,
                ItemsSource = new[] { "Automatic", "2160p (4K)", "1440p", "1080p", "720p", "480p" },
                SelectedIndex = Array.IndexOf(AppSettings.MaxHeights, AppSettings.MaxHeight),
            };
            var status = new TextBlock { TextWrapping = TextWrapping.Wrap, Opacity = 0.75 };
            Action showStatus = () =>
            {
                var blocked = _requestsBlockedEarlier + (_blocker != null ? _blocker.Blocked : 0);
                status.Text = string.Format(
                    "This session: {0} ads removed, {1} ad requests blocked{2}, {3} sponsor segments skipped.\nAd filters: version {4}{5}.",
                    _adsRemoved, blocked, _adsSkipped > 0 ? ", " + _adsSkipped + " ads sped through" : string.Empty,
                    _segmentsSkipped, _filters.Version, _filters.Updated != null ? " (" + _filters.Updated + ")" : string.Empty);
            };
            showStatus();
            var updateButton = new Button { Content = "Update ad filters" };
            var reloadButton = new Button { Content = "Reload YouTube" };
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
            buttons.Children.Add(updateButton);
            buttons.Children.Add(reloadButton);

            var panel = new StackPanel { Spacing = 20, MinWidth = 460 };
            panel.Children.Add(blockAds);
            panel.Children.Add(sponsorBlock);
            panel.Children.Add(codec);
            panel.Children.Add(quality);
            panel.Children.Add(status);
            panel.Children.Add(buttons);
            panel.Children.Add(new TextBlock { Text = "TubeBox " + App.VersionText(), Opacity = 0.5 });

            var dialog = new ContentDialog
            {
                Title = "TubeBox",
                Content = new ScrollViewer { Content = panel },
                PrimaryButtonText = "Save",
                SecondaryButtonText = "Exit TubeBox",
                CloseButtonText = "Cancel",
                DefaultButton = ContentDialogButton.Primary,
            };
            var filtersChanged = false;
            var reloadRequested = false;
            updateButton.Click += async (s, e) =>
            {
                updateButton.IsEnabled = false;
                status.Text = "Checking for new ad filters...";
                var updated = await FilterList.UpdateAsync(_filters, true);
                if (updated != null)
                {
                    _filters = updated;
                    filtersChanged = true;
                }
                showStatus();
                status.Text += updated != null ? "\nUpdated. YouTube reloads when you close this." : "\nNo newer filters.";
                updateButton.IsEnabled = true;
            };
            reloadButton.Click += (s, e) =>
            {
                reloadRequested = true;
                dialog.Hide();
            };

            _dialogOpen = true;
            if (_controller != null)
            {
                _controller.Paused = true;
            }
            ContentDialogResult result;
            try
            {
                result = await dialog.ShowAsync();
            }
            finally
            {
                _dialogOpen = false;
                if (_controller != null)
                {
                    _controller.Paused = false;
                }
                WebView.Focus(FocusState.Programmatic);
            }

            if (result == ContentDialogResult.Secondary)
            {
                Log.Write("Exit chosen in settings");
                Application.Current.Exit();
                return;
            }
            var changed = filtersChanged;
            if (result == ContentDialogResult.Primary)
            {
                var newCodec = AppSettings.Codecs[Math.Max(0, codec.SelectedIndex)];
                var newHeight = AppSettings.MaxHeights[Math.Max(0, quality.SelectedIndex)];
                if (blockAds.IsOn != AppSettings.BlockAds || sponsorBlock.IsOn != AppSettings.SponsorBlock ||
                    newCodec != AppSettings.Codec || newHeight != AppSettings.MaxHeight)
                {
                    AppSettings.BlockAds = blockAds.IsOn;
                    AppSettings.SponsorBlock = sponsorBlock.IsOn;
                    AppSettings.Codec = newCodec;
                    AppSettings.MaxHeight = newHeight;
                    changed = true;
                }
            }
            if (changed)
            {
                await ApplySettingsAsync();
            }
            if (changed || reloadRequested)
            {
                Log.Write("Reloading YouTube");
                _core.Reload();
            }
        }

        public void SetPointerMode(bool enabled)
        {
            var mode = enabled ? RequiresPointer.WhenFocused : RequiresPointer.Never;
            RequiresPointer = mode;
            WebView.RequiresPointer = mode;
        }

        private void EnsureWebViewFocus()
        {
            if (LoadErrorPanel.Visibility != Visibility.Collapsed || _dialogOpen)
            {
                return;
            }
            for (var element = FocusManager.GetFocusedElement() as DependencyObject; element != null; element = VisualTreeHelper.GetParent(element))
            {
                if (element == WebView)
                {
                    return;
                }
            }
            WebView.Focus(FocusState.Programmatic);
        }

        private void OnPreviewKeyDown(object sender, KeyRoutedEventArgs e)
        {
            // ControllerBridge handles the controller. Stop XAML from also using its buttons to move
            // focus out of the web page, except on the load error screen where they work its buttons.
            var key = (int)e.Key;
            var isController = (key >= (int)VirtualKey.GamepadA && key <= (int)VirtualKey.GamepadRightThumbstickLeft) ||
                (key >= (int)VirtualKey.NavigationView && key <= (int)VirtualKey.NavigationCancel);
            if (isController && LoadErrorPanel.Visibility == Visibility.Collapsed && !_dialogOpen)
            {
                e.Handled = true;
                EnsureWebViewFocus();
            }
        }

        private void OnNavigationStarting(CoreWebView2 sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (IsYouTube(e.Uri))
            {
                _homeNavigationId = e.NavigationId;
                return;
            }
            // Only YouTube runs in here; there's no browser to show anything else in.
            Log.Write("Not opening " + Log.DescribeUrl(e.Uri));
            e.Cancel = true;
        }

        private async void OnNavigationCompleted(CoreWebView2 sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.NavigationId != _homeNavigationId)
            {
                return;
            }
            Log.Write("YouTube load finished: " + (e.IsSuccess ? "success" : e.WebErrorStatus.ToString()));
            if (e.IsSuccess)
            {
                LoadErrorPanel.Visibility = Visibility.Collapsed;
                if (_controller != null)
                {
                    _controller.Paused = false;
                }
                EmulatePageFocus(sender);
                // Newer ad filters, if any, take effect from the next start.
                var updated = await FilterList.UpdateAsync(_filters, false);
                if (updated != null)
                {
                    _filters = updated;
                }
            }
            else if (e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
            {
                ShowLoadError("Check the console's internet connection and try again. (" + e.WebErrorStatus + ")");
            }
        }

        // Without the console's mouse-mode cursor nothing ever clicks into the page, so the browser
        // treats it as unfocused (document.hasFocus() is false).
        private static async void EmulatePageFocus(CoreWebView2 core)
        {
            try
            {
                await core.CallDevToolsProtocolMethodAsync("Emulation.setFocusEmulationEnabled", "{\"enabled\":true}");
            }
            catch (Exception ex)
            {
                Log.Error("Page focus emulation failed", ex);
            }
        }

        private void OnNewWindowRequested(CoreWebView2 sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            Log.Write("Not opening a new window for " + Log.DescribeUrl(e.Uri));
        }

        // Backing out of YouTube's start screen closes the TV app, which closes TubeBox.
        private void OnWindowCloseRequested(CoreWebView2 sender, object e)
        {
            Log.Write("YouTube closed itself; exiting");
            Application.Current.Exit();
        }

        private void OnProcessFailed(CoreWebView2 sender, CoreWebView2ProcessFailedEventArgs e)
        {
            Log.Write("WebView2 process failed: " + e.ProcessFailedKind);
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited ||
                e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
            {
                sender.Reload();
            }
            else if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                ShowLoadError("The web view stopped unexpectedly.");
            }
        }

        private void OnBackRequested(object sender, BackRequestedEventArgs e)
        {
            // ControllerBridge already handles B; handling it here too would go back twice, and
            // leaving it unhandled would close the app.
            if (LoadErrorPanel.Visibility == Visibility.Collapsed)
            {
                e.Handled = true;
            }
        }

        private void RetryButton_Click(object sender, RoutedEventArgs e)
        {
            // A fresh page also recovers from a crashed browser process.
            Frame.Navigate(typeof(MainPage));
            Frame.BackStack.Clear();
        }

        private void ExitButton_Click(object sender, RoutedEventArgs e)
        {
            Application.Current.Exit();
        }

        private void ShowLoadError(string message)
        {
            LoadErrorText.Text = message;
            LoadErrorPanel.Visibility = Visibility.Visible;
            if (_controller != null)
            {
                _controller.Paused = true;
            }
            RetryButton.Focus(FocusState.Programmatic);
        }

#if DEBUG
        // Debug builds only: a script saved in the app's LocalState folder as dev-command.js is run
        // in the page and its result written next to it as dev-result.json. tools/dev-page.mjs uses
        // this to drive and inspect the app on a PC, where nothing outside the app can connect to it.
        private DispatcherTimer _devCommands;

        private void StartDevCommands(CoreWebView2 core)
        {
            var folder = ApplicationData.Current.LocalFolder.Path;
            var commandPath = Path.Combine(folder, "dev-command.js");
            var resultPath = Path.Combine(folder, "dev-result.json");
            var busy = false;
            _devCommands = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
            _devCommands.Tick += async (s, e) =>
            {
                if (busy || !File.Exists(commandPath))
                {
                    return;
                }
                busy = true;
                try
                {
                    string script;
                    try
                    {
                        script = File.ReadAllText(commandPath);
                        File.Delete(commandPath);
                    }
                    catch (IOException)
                    {
                        return; // Still being written; next tick.
                    }
                    string result;
                    if (script.StartsWith("//controller ", StringComparison.Ordinal))
                    {
                        // A controller button, as ControllerBridge would report it.
                        OnControllerAction(script.Substring(13).Trim(), false);
                        result = "\"pressed\"";
                    }
                    else
                    {
                        try
                        {
                            result = await core.ExecuteScriptAsync(script);
                        }
                        catch (Exception ex)
                        {
                            result = "{\"devError\":" + JsonValue.CreateStringValue(ex.Message).Stringify() + "}";
                        }
                    }
                    File.WriteAllText(resultPath + ".tmp", result ?? "null");
                    if (File.Exists(resultPath))
                    {
                        File.Delete(resultPath);
                    }
                    File.Move(resultPath + ".tmp", resultPath);
                }
                catch (Exception ex)
                {
                    Log.Error("Dev command failed", ex);
                }
                finally
                {
                    busy = false;
                }
            };
            _devCommands.Start();
        }
#endif
    }
}
