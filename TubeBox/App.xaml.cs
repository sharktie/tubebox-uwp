using System;
using System.Threading.Tasks;
using TubeBox.Diagnostics;
using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.UI;
using Windows.UI.ViewManagement;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;
using Windows.UI.Xaml.Navigation;

namespace TubeBox
{
    sealed partial class App : Application
    {
        public App()
        {
            Log.Start();
            Log.Write("App starting, version " + VersionText());
            this.UnhandledException += OnUnhandledException;
            TaskScheduler.UnobservedTaskException += (s, e) => Log.Error("Unobserved task exception", e.Exception);

            // WebView2 reads these when it starts its browser process, so they must be set before the
            // first page loads. Black instead of white while YouTube loads, and videos may start with
            // sound without a click: the controller's presses reach the page as script events, which
            // the browser doesn't count as the user interacting.
            Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "FF000000");
            Environment.SetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "--autoplay-policy=no-user-gesture-required");

            this.InitializeComponent();
            // Xbox: no mouse-mode pointer; the controller drives YouTube's own highlight.
            this.RequiresPointerMode = ApplicationRequiresPointerMode.WhenRequested;
        }

        protected override void OnLaunched(LaunchActivatedEventArgs e)
        {
            // Xbox: use the whole screen instead of the TV-safe area. YouTube's TV app keeps its
            // controls inside the safe area itself.
            ApplicationView.GetForCurrentView().SetDesiredBoundsMode(ApplicationViewBoundsMode.UseCoreWindow);

            var rootFrame = Window.Current.Content as Frame;
            if (rootFrame == null)
            {
                rootFrame = new Frame();
                rootFrame.NavigationFailed += OnNavigationFailed;
                Window.Current.Content = rootFrame;
            }

            if (e.PrelaunchActivated == false)
            {
                if (rootFrame.Content == null)
                {
                    try
                    {
                        rootFrame.Navigate(typeof(MainPage), e.Arguments);
                    }
                    catch (Exception ex)
                    {
                        Log.Error("Main page failed to load", ex);
                        ShowFatalError(ex);
                    }
                }
                Window.Current.Activate();
                Log.Write("Window activated");
            }
        }

        private void OnUnhandledException(object sender, Windows.UI.Xaml.UnhandledExceptionEventArgs e)
        {
            Log.Write("Unhandled exception: " + e.Message + Environment.NewLine + e.Exception);
            e.Handled = true;
            ShowFatalError(e.Exception);
        }

        // Shows what went wrong instead of leaving the console on the splash screen.
        private static void ShowFatalError(Exception error)
        {
            var text = new TextBlock
            {
                Text = "TubeBox hit an error and can't continue. Please send this to the developer:" +
                    Environment.NewLine + Environment.NewLine + "Version " + VersionText() + Environment.NewLine + error,
                Foreground = new SolidColorBrush(Colors.White),
                TextWrapping = TextWrapping.Wrap,
                IsTextSelectionEnabled = true,
                Margin = new Thickness(48),
            };
            Window.Current.Content = new ScrollViewer
            {
                Content = text,
                Background = new SolidColorBrush(Colors.Black),
            };
            Window.Current.Activate();
        }

        internal static string VersionText()
        {
            var version = Package.Current.Id.Version;
            return string.Format("{0}.{1}.{2}.{3}", version.Major, version.Minor, version.Build, version.Revision);
        }

        private void OnNavigationFailed(object sender, NavigationFailedEventArgs e)
        {
            throw new Exception("Failed to load Page " + e.SourcePageType.FullName);
        }
    }
}
