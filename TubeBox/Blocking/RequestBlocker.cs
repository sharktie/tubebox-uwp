using System;
using System.Collections.Generic;
using System.Threading;
using Microsoft.Web.WebView2.Core;
using TubeBox.Diagnostics;

namespace TubeBox.Blocking
{
    /// <summary>
    /// Refuses requests to ad servers and YouTube's ad tracking addresses (the filter list's
    /// blockUrls) before they leave the console. The browser only asks about addresses that match
    /// one of the patterns, so video and page requests aren't slowed down.
    /// </summary>
    internal sealed class RequestBlocker : IDisposable
    {
        private readonly CoreWebView2 _core;
        private readonly List<string> _patterns = new List<string>();
        private int _blocked;

        public RequestBlocker(CoreWebView2 core, IEnumerable<string> patterns)
        {
            _core = core;
            foreach (var pattern in patterns)
            {
                try
                {
                    _core.AddWebResourceRequestedFilter(pattern, CoreWebView2WebResourceContext.All);
                    _patterns.Add(pattern);
                }
                catch (Exception ex)
                {
                    Log.Write("Ignoring the ad filter " + pattern + ": " + ex.Message);
                }
            }
            _core.WebResourceRequested += OnWebResourceRequested;
            Log.Write("Blocking " + _patterns.Count + " ad addresses");
        }

        /// <summary>Requests refused so far.</summary>
        public int Blocked
        {
            get { return _blocked; }
        }

        public void Dispose()
        {
            _core.WebResourceRequested -= OnWebResourceRequested;
            foreach (var pattern in _patterns)
            {
                try
                {
                    _core.RemoveWebResourceRequestedFilter(pattern, CoreWebView2WebResourceContext.All);
                }
                catch (Exception)
                {
                    // The web view is already gone.
                }
            }
            _patterns.Clear();
        }

        private void OnWebResourceRequested(CoreWebView2 sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            e.Response = sender.Environment.CreateWebResourceResponse(null, 403, "Blocked", string.Empty);
            Interlocked.Increment(ref _blocked);
        }
    }
}
