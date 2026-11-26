// Bridge Night Helper: automatic updates from this project's GitHub releases. Only files from the project's own
// release download URL are accepted, and the exe is only swapped when its SHA-256 matches the release's
// .sha256 file. Never during a game. If anything fails, the running version stays and the log says why.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace BridgeNight
{
    static partial class Updater
    {
        const string Api = "https://api.github.com/repos/kasakuma99/bridge-night-/releases/latest";
        internal const string DownloadPrefix = "https://github.com/kasakuma99/bridge-night-/releases/download/";
        const string ExeAsset = "bridge-night-helper.exe";

        static readonly object gate = new object();
        static string newVersion = "", notes = "", exeUrl = "", shaUrl = "";
        static string state = "";          // "" = idle (State then shows the last check)
        static string failure = "";
        static bool busy, waitingForGame;
        static DateTime? lastCheck;
        static DateTime nextCheck = DateTime.MaxValue;

        static string Exe { get { return Assembly.GetExecutingAssembly().Location; } }
        static string StateFile { get { return Path.Combine(Settings.Dir, "update.json"); } }

        /* ---- schedule (called by PcServices) */

        internal static void OnStart()
        {
            try { foreach (var left in new[] { Exe + ".old", Exe + ".new" }) if (File.Exists(left)) File.Delete(left); } catch (Exception e) { PcServices.Log("Could not remove the old version: " + e.Message); }
            var d = ReadState();
            DateTime t;
            if (d != null && DateTime.TryParse(Json.Str(d, "lastCheck") ?? "", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out t)) lastCheck = t;
            nextCheck = DateTime.Now.AddSeconds(20);
        }

        internal static void OnTick()
        {
            if (DateTime.Now < nextCheck) return;
            nextCheck = DateTime.Now.AddHours(24);
            CheckNowImpl();
        }

        internal static void OnGameEnded()
        {
            bool go;
            lock (gate) { go = waitingForGame; waitingForGame = false; }
            if (go) StartInstall(false);
        }

        /* ---- check */

        static void CheckNowImpl()
        {
            lock (gate)
            {
                if (busy) return;
                busy = true;
                state = "Checking";
            }
            RaiseChanged();
            PcServices.Background("update check", delegate
            {
                bool install = false;
                try
                {
                    Check();
                    var s = PcServices.Options;
                    lock (gate) install = newVersion != "" && s != null && s.AutoUpdate;
                }
                catch (Exception e)
                {
                    lock (gate) failure = "Could not check for updates: " + e.Message;
                    PcServices.Log("Update check failed: " + e.Message);
                }
                finally
                {
                    lock (gate) { busy = false; if (state == "Checking") state = ""; }
                    HelperStatus.SetUpdate(NewVersion);
                    RaiseChanged();
                }
                if (install) StartInstall(false);
            });
        }

        static void Check()
        {
            var release = Json.Parse(Get(Api)) as Dictionary<string, object>;
            if (release == null) throw new Exception("GitHub sent no release");
            var tag = Json.Str(release, "tag_name") ?? "";
            var version = tag.StartsWith("helper-v", StringComparison.Ordinal) ? tag.Substring(8) : "";
            string exe = "", sha = "";
            var assets = Json.List(release, "assets");
            if (assets != null)
                foreach (var a in assets)
                {
                    var name = Json.Str(a, "name");
                    var url = Json.Str(a, "browser_download_url") ?? "";
                    if (!AllowedUrl(url)) continue;
                    if (name == ExeAsset) exe = url;
                    else if (name == ExeAsset + ".sha256") sha = url;
                }
            bool newer = version != "" && CompareVersions(version, Program.Version) > 0 && exe != "" && sha != "";
            var now = DateTime.Now;
            lock (gate)
            {
                newVersion = newer ? version : "";
                notes = newer ? PlainNotes(Json.Str(release, "body") ?? "") : "";
                exeUrl = newer ? exe : "";
                shaUrl = newer ? sha : "";
                failure = "";
                lastCheck = now;
            }
            SaveState(null);
            PcServices.Log(newer ? "Update available: " + version : "Helper is up to date (" + Program.Version + ")");
        }

        /* ---- install */

        static bool InstallNowImpl(out string note)
        {
#if TEST
            note = "Test build: updates are off";
            return false;
#else
            if (PcServices.GameRunning) { note = "Not during a game: it installs when the game ends."; lock (gate) waitingForGame = NewVersion != ""; return false; }
            if (NewVersion == "") { note = "No new version found. Check again later."; return false; }
            lock (gate) if (busy) { note = "Already busy with the update."; return false; }
            StartInstall(true);
            note = "Downloading version " + NewVersion + ".";
            return true;
#endif
        }

        static void StartInstall(bool asked)
        {
#if TEST
            PcServices.Log("Test build: an update was found but test builds never install it");
#else
            lock (gate)
            {
                if (busy || newVersion == "") return;
                if (PcServices.GameRunning) { waitingForGame = true; state = "Waiting for the game to end"; RaiseChanged(); return; }
                busy = true;
                state = "Downloading";
            }
            RaiseChanged();
            PcServices.Background("update install", delegate
            {
                try { Install(); }
                catch (Exception e)
                {
                    lock (gate) failure = "Update failed: " + e.Message + ". The current version keeps running.";
                    PcServices.Log("Update failed, keeping " + Program.Version + ": " + e.Message);
                }
                finally
                {
                    lock (gate) { busy = false; if (state == "Downloading" || state == "Installing") state = ""; }
                    RaiseChanged();
                }
            });
#endif
        }

#if !TEST
        static void Install()
        {
            string version, exe, sha, text;
            lock (gate) { version = newVersion; exe = exeUrl; sha = shaUrl; text = notes; }
            var path = Exe;
            var fresh = path + ".new";
            var old = path + ".old";
            try
            {
                var expected = ParseSha(Get(sha));
                if (expected == null) throw new Exception("the fingerprint file is not valid");
                Download(exe, fresh);
                string actual;
                using (var f = File.OpenRead(fresh))
                using (var h = SHA256.Create())
                    actual = BitConverter.ToString(h.ComputeHash(f)).Replace("-", "");
                if (!string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
                    throw new Exception("the download's fingerprint does not match the release");
                if (PcServices.GameRunning) // a game started while downloading: try again afterwards
                {
                    lock (gate) waitingForGame = true;
                    throw new Exception("a game started, it installs when the game ends");
                }
                lock (gate) state = "Installing";
                if (File.Exists(old)) File.Delete(old);
                File.Move(path, old); // a running exe can be renamed, not deleted
                try { File.Move(fresh, path); }
                catch { File.Move(old, path); throw; }
            }
            catch
            {
                try { if (File.Exists(fresh)) File.Delete(fresh); } catch { }
                throw;
            }
            SaveState(version, text);
            PcServices.Log("Installed version " + version + ", restarting");
            Process.Start(new ProcessStartInfo(path, "--updated-from " + Program.Version) { UseShellExecute = false });
            PcServices.RaiseNotify("Bridge Night Helper updated", "Version " + version + " starts now.");
            PcServices.OnUi(delegate { Application.Exit(); });
        }

        static void Download(string url, string file)
        {
            var req = Request(url);
            req.Timeout = 60000;
            req.ReadWriteTimeout = 60000;
            using (var res = req.GetResponse())
            using (var s = res.GetResponseStream())
            using (var f = File.Create(file))
            {
                var buf = new byte[65536];
                long total = 0;
                int n;
                while ((n = s.Read(buf, 0, buf.Length)) > 0)
                {
                    total += n;
                    if (total > 50L * 1024 * 1024) throw new Exception("the download is too big");
                    f.Write(buf, 0, n);
                }
            }
        }
#endif

        /* ---- small pure parts (also used by tools/selftest.ps1) */

        /// Only the project's own release files.
        internal static bool AllowedUrl(string url)
        {
            return url != null && url.StartsWith(DownloadPrefix, StringComparison.Ordinal) && url.IndexOf("..", StringComparison.Ordinal) < 0;
        }

        /// "0.7.1" vs "0.7.0": numeric, missing parts count as 0. Not a version: -1 (treated as older).
        internal static int CompareVersions(string a, string b)
        {
            var x = Parts(a);
            var y = Parts(b);
            if (x == null) return y == null ? 0 : -1;
            if (y == null) return 1;
            for (int i = 0; i < Math.Max(x.Length, y.Length); i++)
            {
                int p = i < x.Length ? x[i] : 0, q = i < y.Length ? y[i] : 0;
                if (p != q) return p.CompareTo(q);
            }
            return 0;
        }

        static int[] Parts(string v)
        {
            if (string.IsNullOrEmpty(v)) return null;
            var s = v.Split('.');
            var r = new int[s.Length];
            for (int i = 0; i < s.Length; i++) if (!int.TryParse(s[i], NumberStyles.None, CultureInfo.InvariantCulture, out r[i])) return null;
            return r;
        }

        /// The .sha256 file: "<64 hex>  bridge-night-helper.exe". First token, lower case; null if not a SHA-256.
        internal static string ParseSha(string text)
        {
            if (text == null) return null;
            var t = text.TrimStart((char)0xFEFF).Trim().Split(new[] { ' ', '\t', '\r', '\n', '*' }, StringSplitOptions.RemoveEmptyEntries);
            if (t.Length == 0 || !Regex.IsMatch(t[0], "^[0-9a-fA-F]{64}$")) return null;
            return t[0].ToLowerInvariant();
        }

        /// Release notes are Markdown: keep the words, drop the marks.
        internal static string PlainNotes(string md)
        {
            var lines = new List<string>();
            foreach (var raw in md.Replace("\r", "").Split('\n'))
            {
                var l = Regex.Replace(raw, @"^\s*#+\s*", "");
                l = Regex.Replace(l, @"^\s*[-*]\s+", "• ");
                l = Regex.Replace(l, @"\[([^\]]*)\]\([^)]*\)", "$1");
                l = l.Replace("**", "").Replace("`", "");
                lines.Add(l.TrimEnd());
            }
            return string.Join("\n", lines).Trim();
        }

        /* ---- state */

        static string StateImpl()
        {
            lock (gate)
            {
                if (state != "") return state;
                if (failure != "") return failure;
                if (waitingForGame) return "Waiting for the game to end";
                if (newVersion != "") return "Version " + newVersion + " is ready";
                if (!lastCheck.HasValue) return "Not checked yet";
                return "Up to date · checked " + Ago(DateTime.Now - lastCheck.Value);
            }
        }

        internal static string Ago(TimeSpan t)
        {
            if (t.TotalMinutes < 1) return "just now";
            if (t.TotalHours < 1) return (int)t.TotalMinutes + " min ago";
            if (t.TotalDays < 1) return (int)t.TotalHours + " h ago";
            return (int)t.TotalDays + (t.TotalDays < 2 ? " day ago" : " days ago");
        }

        static string WhatsNewImpl()
        {
            if (Program.UpdatedFrom == "") return "";
            var d = ReadState();
            return d != null && Json.Str(d, "installed") == Program.Version ? Json.Str(d, "installedNotes") ?? "" : "";
        }

        static Dictionary<string, object> ReadState()
        {
            try { return File.Exists(StateFile) ? Json.Parse(File.ReadAllText(StateFile, Encoding.UTF8)) as Dictionary<string, object> : null; }
            catch { return null; }
        }

        /// update.json: when the last check was, and the notes of the version just installed (for WhatsNew).
        static void SaveState(string installed, string installedNotes = null)
        {
            try
            {
                lock (gate)
                {
                    var d = ReadState() ?? new Dictionary<string, object>();
                    if (lastCheck.HasValue) d["lastCheck"] = lastCheck.Value.ToString("o", CultureInfo.InvariantCulture);
                    if (installed != null) { d["installed"] = installed; d["installedNotes"] = installedNotes ?? ""; }
                    Directory.CreateDirectory(Settings.Dir);
                    File.WriteAllText(StateFile, Json.Write(d), Encoding.UTF8);
                }
            }
            catch (Exception e) { PcServices.Log("Could not save update.json: " + e.Message); }
        }

        /* ---- HTTP */

        static HttpWebRequest Request(string url)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.UserAgent = "BridgeNightHelper/" + Program.Version;
            req.Timeout = 15000;
            req.ReadWriteTimeout = 15000;
            req.AllowAutoRedirect = true; // release files redirect to GitHub's download host
            return req;
        }

        static string Get(string url)
        {
            var req = Request(url);
            if (url == Api) req.Accept = "application/vnd.github+json";
            using (var res = req.GetResponse())
            using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                return r.ReadToEnd();
        }
    }
}
