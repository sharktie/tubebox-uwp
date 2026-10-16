using System;
using Microsoft.Web.WebView2.Core;
using TubeBox.Diagnostics;
using Windows.Data.Json;

namespace TubeBox.Bridge
{
    /// <summary>The parts of the app window the bridge needs.</summary>
    internal interface IPageHost
    {
        /// <summary>Ads taken out of YouTube's responses, and ads that played anyway and were sped through.</summary>
        void CountAds(int removed, int skipped);
        /// <summary>Sponsor segments SponsorBlock skipped.</summary>
        void CountSponsorSkips(int skipped);
    }

    /// <summary>
    /// Messages between the app and the scripts it adds to YouTube's page (Inject/). The app sends
    /// {type: 'input', action, repeat} for the controller; the page sends app.log, app.adblock
    /// ({removed, skipped}), app.sponsorblock ({skipped}) and app.exit (YouTube's window.close()).
    /// </summary>
    internal sealed class PageBridge : IDisposable
    {
        private readonly CoreWebView2 _webView;
        private readonly IPageHost _host;

        public PageBridge(CoreWebView2 webView, IPageHost host)
        {
            _webView = webView;
            _host = host;
            _webView.WebMessageReceived += OnWebMessageReceived;
        }

        public void Dispose()
        {
            _webView.WebMessageReceived -= OnWebMessageReceived;
        }

        /// <summary>Sends a controller action, e.g. "select", to the page.</summary>
        public void SendInput(string action, bool repeat)
        {
            var payload = new JsonObject();
            payload.SetNamedValue("type", JsonValue.CreateStringValue("input"));
            payload.SetNamedValue("action", JsonValue.CreateStringValue(action));
            payload.SetNamedValue("repeat", JsonValue.CreateBooleanValue(repeat));
            try
            {
                _webView.PostWebMessageAsJson(payload.Stringify());
            }
            catch (Exception ex)
            {
                Log.Write("Bridge post failed: " + ex.Message);
            }
        }

        private void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!MainPage.IsYouTube(e.Source))
            {
                return;
            }
            try
            {
                JsonObject message;
                if (!JsonObject.TryParse(e.WebMessageAsJson, out message))
                {
                    return;
                }
                switch (GetString(message, "type"))
                {
                    case "app.log":
                        Log.Write("page: " + GetString(message, "message"));
                        break;
                    case "app.adblock":
                        _host.CountAds((int)GetNumber(message, "removed"), (int)GetNumber(message, "skipped"));
                        break;
                    case "app.sponsorblock":
                        _host.CountSponsorSkips((int)GetNumber(message, "skipped"));
                        break;
                    case "app.exit":
                        Log.Write("YouTube closed itself; exiting");
                        Windows.UI.Xaml.Application.Current.Exit();
                        break;
                }
            }
            catch (Exception ex)
            {
                Log.Error("Bridge message failed", ex);
            }
        }

        private static string GetString(JsonObject message, string name)
        {
            var value = message.GetNamedValue(name, JsonValue.CreateNullValue());
            return value.ValueType == JsonValueType.String ? value.GetString() : null;
        }

        private static double GetNumber(JsonObject message, string name)
        {
            var value = message.GetNamedValue(name, JsonValue.CreateNullValue());
            return value.ValueType == JsonValueType.Number ? Math.Max(0, Math.Min(value.GetNumber(), 10000)) : 0;
        }
    }
}
