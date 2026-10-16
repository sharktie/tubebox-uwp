using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using TubeBox.Diagnostics;
using Windows.Data.Json;
using Windows.Storage;
using Windows.Web.Http;
using Windows.Web.Http.Filters;

namespace TubeBox.Blocking
{
    /// <summary>
    /// The ad filters (Inject/filters.json): what Inject/adblock.js removes from YouTube's responses
    /// and which addresses <see cref="RequestBlocker"/> refuses. Like a uBlock Origin filter list,
    /// it can be updated without updating the app: a newer version published in the repository is
    /// downloaded and kept in the app's LocalState folder.
    /// </summary>
    internal sealed class FilterList
    {
        private const string UpdateUrl = "https://raw.githubusercontent.com/sharktie/tubebox-uwp/main/TubeBox/Inject/filters.json";
        private const string CacheFileName = "filters.json";
        private const string LastCheckKey = "filtersLastCheck";
        private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(12);
        private const int MaxEntries = 500;

        private FilterList(int version, string updated, string[] pruneKeys, string[] pruneItems, string[] blockUrls)
        {
            Version = version;
            Updated = updated;
            PruneKeys = pruneKeys;
            PruneItems = pruneItems;
            BlockUrls = blockUrls;
        }

        public int Version { get; }
        public string Updated { get; }
        public IReadOnlyList<string> PruneKeys { get; }
        public IReadOnlyList<string> PruneItems { get; }
        public IReadOnlyList<string> BlockUrls { get; }

        /// <summary>The part the page script needs, as config.filters.</summary>
        public JsonObject ToPageConfig()
        {
            var result = new JsonObject();
            result.SetNamedValue("pruneKeys", ToJsonArray(PruneKeys));
            result.SetNamedValue("pruneItems", ToJsonArray(PruneItems));
            return result;
        }

        /// <summary>The newer of the filters in the package and the last downloaded ones.</summary>
        public static async Task<FilterList> LoadAsync()
        {
            FilterList bundled = null;
            try
            {
                var file = await StorageFile.GetFileFromApplicationUriAsync(new Uri("ms-appx:///Inject/filters.json"));
                bundled = Parse(await FileIO.ReadTextAsync(file));
            }
            catch (Exception ex)
            {
                Log.Error("Reading the built-in ad filters failed", ex);
            }
            var cached = await ReadCacheAsync();
            var list = cached != null && (bundled == null || cached.Version > bundled.Version) ? cached : bundled;
            if (list == null)
            {
                list = new FilterList(0, null, new string[0], new string[0], new string[0]);
            }
            Log.Write("Ad filters version " + list.Version + (list == cached ? " (downloaded)" : " (built in)"));
            return list;
        }

        /// <summary>
        /// Downloads the published filters and keeps them if they are newer than <paramref name="current"/>.
        /// Returns the new list, or null if there is nothing newer (or the check failed, or one ran
        /// recently and <paramref name="force"/> is false).
        /// </summary>
        public static async Task<FilterList> UpdateAsync(FilterList current, bool force)
        {
            var settings = ApplicationData.Current.LocalSettings.Values;
            object last;
            if (!force && settings.TryGetValue(LastCheckKey, out last) && last is long &&
                DateTimeOffset.UtcNow - DateTimeOffset.FromUnixTimeSeconds((long)last) < CheckInterval)
            {
                return null;
            }
            settings[LastCheckKey] = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            try
            {
                var filter = new HttpBaseProtocolFilter();
                filter.CacheControl.ReadBehavior = HttpCacheReadBehavior.NoCache;
                filter.CacheControl.WriteBehavior = HttpCacheWriteBehavior.NoCache;
                using (var client = new HttpClient(filter))
                using (var response = await client.GetAsync(new Uri(UpdateUrl)))
                {
                    if (!response.IsSuccessStatusCode)
                    {
                        Log.Write("Ad filter check: the server answered " + (int)response.StatusCode);
                        return null;
                    }
                    var text = await response.Content.ReadAsStringAsync();
                    var downloaded = Parse(text);
                    if (downloaded == null || downloaded.Version <= current.Version)
                    {
                        Log.Write("Ad filters are up to date (version " + current.Version + ")");
                        return null;
                    }
                    var folder = ApplicationData.Current.LocalFolder;
                    var file = await folder.CreateFileAsync(CacheFileName, CreationCollisionOption.ReplaceExisting);
                    await FileIO.WriteTextAsync(file, text);
                    Log.Write("Ad filters updated to version " + downloaded.Version);
                    return downloaded;
                }
            }
            catch (Exception ex)
            {
                Log.Write("Ad filter check failed: " + ex.Message);
                return null;
            }
        }

        private static async Task<FilterList> ReadCacheAsync()
        {
            try
            {
                var path = Path.Combine(ApplicationData.Current.LocalFolder.Path, CacheFileName);
                if (!File.Exists(path))
                {
                    return null;
                }
                var file = await StorageFile.GetFileFromPathAsync(path);
                return Parse(await FileIO.ReadTextAsync(file));
            }
            catch (Exception ex)
            {
                Log.Error("Reading the downloaded ad filters failed", ex);
                return null;
            }
        }

        /// <summary>Null unless the text is a filter list in the expected shape.</summary>
        private static FilterList Parse(string text)
        {
            JsonObject json;
            if (string.IsNullOrEmpty(text) || !JsonObject.TryParse(text, out json))
            {
                return null;
            }
            var version = json.GetNamedValue("version", JsonValue.CreateNullValue());
            if (version.ValueType != JsonValueType.Number || version.GetNumber() < 1)
            {
                return null;
            }
            var pruneKeys = ReadStrings(json, "pruneKeys");
            var pruneItems = ReadStrings(json, "pruneItems");
            var blockUrls = ReadStrings(json, "blockUrls");
            if (pruneKeys == null || pruneItems == null || blockUrls == null)
            {
                return null;
            }
            var updated = json.GetNamedValue("updated", JsonValue.CreateNullValue());
            return new FilterList((int)version.GetNumber(),
                updated.ValueType == JsonValueType.String ? updated.GetString() : null,
                pruneKeys, pruneItems, blockUrls);
        }

        private static string[] ReadStrings(JsonObject json, string name)
        {
            var value = json.GetNamedValue(name, JsonValue.CreateNullValue());
            if (value.ValueType != JsonValueType.Array)
            {
                return null;
            }
            var array = value.GetArray();
            if (array.Count > MaxEntries)
            {
                return null;
            }
            var result = new List<string>();
            foreach (var item in array)
            {
                if (item.ValueType != JsonValueType.String || string.IsNullOrWhiteSpace(item.GetString()) || item.GetString().Length > 300)
                {
                    return null;
                }
                result.Add(item.GetString());
            }
            return result.ToArray();
        }

        private static JsonArray ToJsonArray(IEnumerable<string> values)
        {
            var array = new JsonArray();
            foreach (var value in values)
            {
                array.Add(JsonValue.CreateStringValue(value));
            }
            return array;
        }
    }
}
