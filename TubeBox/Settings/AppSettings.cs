using Windows.Foundation.Collections;
using Windows.Storage;

namespace TubeBox.Settings
{
    /// <summary>TubeBox's own settings (Menu or View on the controller), kept in the app's local settings.</summary>
    internal static class AppSettings
    {
        private const string BlockAdsKey = "blockAds";
        private const string SponsorBlockKey = "sponsorBlock";
        private const string CodecKey = "codec";
        private const string MaxHeightKey = "maxHeight";

        public static readonly string[] Codecs = { "auto", "vp9", "h264" };
        public static readonly int[] MaxHeights = { 0, 2160, 1440, 1080, 720, 480 };

        public static bool BlockAds
        {
            get { return Get(BlockAdsKey, true); }
            set { Values[BlockAdsKey] = value; }
        }

        /// <summary>Skip sponsor reads, self-promotion and subscribe reminders marked on SponsorBlock.</summary>
        public static bool SponsorBlock
        {
            get { return Get(SponsorBlockKey, true); }
            set { Values[SponsorBlockKey] = value; }
        }

        /// <summary>"auto" (whatever YouTube picks), "vp9" (no AV1) or "h264" (no AV1 or VP9).</summary>
        public static string Codec
        {
            get
            {
                var value = Get(CodecKey, "auto");
                return System.Array.IndexOf(Codecs, value) >= 0 ? value : "auto";
            }
            set { Values[CodecKey] = value; }
        }

        /// <summary>The tallest video picture to stream (by the shorter side), or 0 for no limit.</summary>
        public static int MaxHeight
        {
            get
            {
                var value = Get(MaxHeightKey, 0);
                return System.Array.IndexOf(MaxHeights, value) >= 0 ? value : 0;
            }
            set { Values[MaxHeightKey] = value; }
        }

        private static IPropertySet Values
        {
            get { return ApplicationData.Current.LocalSettings.Values; }
        }

        private static T Get<T>(string key, T fallback)
        {
            object value;
            return Values.TryGetValue(key, out value) && value is T ? (T)value : fallback;
        }
    }
}
