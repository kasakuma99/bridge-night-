// Bridge Night Helper: a small Windows tray app.
//
// What it does:
//   * Reads the League client's local API on this PC (127.0.0.1). It only sends GET requests:
//     it never sends commands to the client, never clicks anything, never reads game memory.
//   * In custom games only: sends champ select picks, "game started", and end-of-game stats
//     (Riot ID, champion, team, win/loss, K/D/A, items, damage) to the Bridge Night site.
//   * Talks to exactly one server: the URL in its settings (our Supabase Edge Function),
//     with the helper token an admin created on the site.
//
// No admin rights, no background service, no autostart unless you tick it, no ads, no tracking.
// The token is stored encrypted for your Windows account (DPAPI) in %APPDATA%\BridgeNightHelper.
//
// Built with the C# compiler that ships with Windows (.NET Framework 4.8). See helper/build.ps1.
// Written in C# 5 on purpose, so that compiler can build it.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.Security;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Bridge Night Helper")]
[assembly: AssemblyProduct("Bridge Night Helper")]
[assembly: AssemblyDescription("Sends custom game picks and results to the Bridge Night site. Read-only towards the League client.")]
[assembly: AssemblyVersion("0.2.1.0")]
[assembly: AssemblyFileVersion("0.2.1.0")]

namespace BridgeNight
{
    static class Program
    {
        public const string Version = "0.2.1";
        public const string DefaultServer = "https://kimgoxjydargqtbwolxz.supabase.co/functions/v1/helper";

        [STAThread]
        static void Main()
        {
            bool created;
            using (var mutex = new Mutex(true, "BridgeNightHelper-single-instance", out created))
            {
                if (!created)
                {
                    MessageBox.Show("Bridge Night Helper is already running. Look for its icon next to the clock.", "Bridge Night Helper");
                    return;
                }
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                ServicePointManager.ServerCertificateValidationCallback = Lcu.ValidateCertificate;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayApp());
            }
        }
    }

    /* ------------------------------------------------------------------ settings */

    class Settings
    {
        public string Server = Program.DefaultServer;
        public string Token = "";
        public bool Paused;
        public List<string> SentGames = new List<string>();

        static string Dir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BridgeNightHelper"); } }
        static string FilePath { get { return Path.Combine(Dir, "settings.json"); } }

        public static Settings Load()
        {
            var s = new Settings();
            try
            {
                if (!File.Exists(FilePath)) return s;
                var d = Json.Parse(File.ReadAllText(FilePath, Encoding.UTF8)) as Dictionary<string, object>;
                if (d == null) return s;
                s.Server = Json.Str(d, "server") ?? Program.DefaultServer;
                s.Paused = Json.Bool(d, "paused") ?? false;
                var enc = Json.Str(d, "token");
                if (!string.IsNullOrEmpty(enc))
                {
                    try
                    {
                        s.Token = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(enc), null, DataProtectionScope.CurrentUser));
                    }
                    catch { s.Token = ""; }
                }
                var sent = Json.List(d, "sentGames");
                if (sent != null) foreach (var x in sent) if (x != null) s.SentGames.Add(x.ToString());
            }
            catch { }
            return s;
        }

        public void Save()
        {
            Directory.CreateDirectory(Dir);
            var enc = string.IsNullOrEmpty(Token) ? "" :
                Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(Token), null, DataProtectionScope.CurrentUser));
            while (SentGames.Count > 50) SentGames.RemoveAt(0);
            var d = new Dictionary<string, object>();
            d["server"] = Server;
            d["token"] = enc;
            d["paused"] = Paused;
            d["sentGames"] = SentGames.ToArray();
            File.WriteAllText(FilePath, Json.Write(d), Encoding.UTF8);
        }

        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        public static bool Autostart
        {
            get
            {
                using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(RunKey))
                    return k != null && k.GetValue("BridgeNightHelper") != null;
            }
            set
            {
                using (var k = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(RunKey))
                {
                    if (value) k.SetValue("BridgeNightHelper", "\"" + Application.ExecutablePath + "\"");
                    else k.DeleteValue("BridgeNightHelper", false);
                }
            }
        }
    }

    /* ------------------------------------------------------------------ JSON helpers */

    static class Json
    {
        static JavaScriptSerializer Ser() { var s = new JavaScriptSerializer(); s.MaxJsonLength = int.MaxValue; s.RecursionLimit = 64; return s; }
        public static object Parse(string s) { return Ser().DeserializeObject(s); }
        public static string Write(object o) { return Ser().Serialize(o); }

        public static object Get(object o, string key)
        {
            var d = o as Dictionary<string, object>;
            object v;
            return d != null && d.TryGetValue(key, out v) ? v : null;
        }
        public static Dictionary<string, object> Dict(object o, string key) { return Get(o, key) as Dictionary<string, object>; }
        public static object[] List(object o, string key)
        {
            var v = Get(o, key);
            var a = v as object[];
            if (a != null) return a;
            var al = v as ArrayList;
            return al != null ? al.ToArray() : null;
        }
        public static string Str(object o, string key) { var v = Get(o, key); return v == null ? null : v.ToString(); }
        public static long? Long(object o, string key)
        {
            var v = Get(o, key);
            if (v == null) return null;
            try { return Convert.ToInt64(v); } catch { return null; }
        }
        public static bool? Bool(object o, string key) { var v = Get(o, key); return v is bool ? (bool?)(bool)v : null; }
    }

    /* ------------------------------------------------------------------ League client (read-only) */

    class LcuCreds { public int Port; public string Password; }

    static class Lcu
    {
        // The League client uses a self-signed certificate on 127.0.0.1. Accept that one only;
        // every other HTTPS connection (our server) must pass normal certificate checks.
        public static bool ValidateCertificate(object sender, System.Security.Cryptography.X509Certificates.X509Certificate cert,
            System.Security.Cryptography.X509Certificates.X509Chain chain, SslPolicyErrors errors)
        {
            var req = sender as HttpWebRequest;
            if (req != null && req.RequestUri.Host == "127.0.0.1") return true;
            return errors == SslPolicyErrors.None;
        }

        public static LcuCreds Find()
        {
            // 1) From the running client's command line (no admin needed for your own processes).
            try
            {
                using (var q = new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE Name = 'LeagueClientUx.exe'"))
                foreach (ManagementObject p in q.Get())
                {
                    var cl = (p["CommandLine"] ?? "").ToString();
                    var port = Regex.Match(cl, "--app-port=\"?(\\d+)");
                    var pw = Regex.Match(cl, "--remoting-auth-token=\"?([\\w-]+)");
                    if (port.Success && pw.Success) return new LcuCreds { Port = int.Parse(port.Groups[1].Value), Password = pw.Groups[1].Value };
                }
            }
            catch { }
            // 2) From the lockfile in the League install folder.
            var dirs = new List<string>();
            try
            {
                foreach (var p in Process.GetProcessesByName("LeagueClient"))
                {
                    try { dirs.Add(Path.GetDirectoryName(p.MainModule.FileName)); } catch { }
                }
            }
            catch { }
            dirs.Add(@"C:\Riot Games\League of Legends");
            dirs.Add(@"D:\Riot Games\League of Legends");
            foreach (var d in dirs)
            {
                try
                {
                    var f = Path.Combine(d, "lockfile");
                    if (!File.Exists(f)) continue;
                    string text;
                    using (var fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    using (var r = new StreamReader(fs)) text = r.ReadToEnd();
                    var parts = text.Split(':'); // name:pid:port:password:protocol
                    if (parts.Length >= 5) return new LcuCreds { Port = int.Parse(parts[2]), Password = parts[3] };
                }
                catch { }
            }
            return null;
        }

        /// GET only. Returns parsed JSON, or null if the endpoint isn't available right now.
        public static object Get(LcuCreds c, string path)
        {
            var req = (HttpWebRequest)WebRequest.Create("https://127.0.0.1:" + c.Port + path);
            req.Method = "GET";
            req.Timeout = 4000;
            req.ReadWriteTimeout = 4000;
            req.Accept = "application/json";
            req.Headers["Authorization"] = "Basic " + Convert.ToBase64String(Encoding.ASCII.GetBytes("riot:" + c.Password));
            try
            {
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                    return Json.Parse(r.ReadToEnd());
            }
            catch (WebException) { return null; }
        }
    }

    /* ------------------------------------------------------------------ the watcher */

    class Watcher
    {
        readonly Settings settings;
        readonly Action<string> log;
        readonly Action<string> status;
        int busy;
        string lastPhase = "";
        bool customGame;
        string lastPicksSig = "";
        DateTime lastPicksSent = DateTime.MinValue;
        List<string> lastPlayers = new List<string>();
        readonly Dictionary<string, string> riotIds = new Dictionary<string, string>();   // puuid -> Name#TAG
        Dictionary<long, string> champions;                                                // id -> name
        DateTime eogGiveUp = DateTime.MinValue;

        public Watcher(Settings s, Action<string> log, Action<string> status) { settings = s; this.log = log; this.status = status; }

        public void Tick()
        {
            if (Interlocked.Exchange(ref busy, 1) == 1) return;
            try { Step(); }
            catch (Exception e) { log("Problem: " + e.Message); }
            finally { Interlocked.Exchange(ref busy, 0); }
        }

        void Step()
        {
            var c = Lcu.Find();
            if (c == null)
            {
                status("Waiting for the League client");
                if (lastPhase != "") { lastPhase = ""; log("League client closed"); }
                return;
            }
            if (lastPhase == "") log("Connected to the League client (port " + c.Port + ")");
            var phase = (Lcu.Get(c, "/lol-gameflow/v1/gameflow-phase") ?? "None").ToString();
            var inGameFlow = phase == "ChampSelect" || phase == "GameStart" || phase == "InProgress" || phase == "Reconnect"
                || phase == "WaitingForStats" || phase == "PreEndOfGame" || phase == "EndOfGame";
            object sess = null;
            if (inGameFlow)
            {
                // Check every time: right after the phase changes, the session can still be incomplete.
                sess = Lcu.Get(c, "/lol-gameflow/v1/session");
                var gd = Json.Dict(sess, "gameData");
                var isCustom = Json.Bool(gd, "isCustomGame");
                if (isCustom.HasValue)
                {
                    if (isCustom.Value != customGame || phase != lastPhase)
                        log("Game type: " + (isCustom.Value ? "custom game" : "not a custom game (nothing is sent)"));
                    customGame = isCustom.Value;
                }
            }
            else if (phase == "None" || phase == "Lobby" || phase == "Matchmaking") customGame = false;

            if (phase != lastPhase)
            {
                log("Client phase: " + phase);
                if (phase == "ChampSelect") { lastPicksSig = ""; eogGiveUp = DateTime.MinValue; }
            }
            var prev = lastPhase;
            lastPhase = phase;
            status(settings.Paused ? "Paused" : customGame && inGameFlow ? "Custom game: " + phase : "Connected to the League client");

            if (!customGame) return;

            if (phase == "ChampSelect") ChampSelect(c, sess);
            else if (phase == "InProgress" && prev != "InProgress")
            {
                // Loading screen: everyone sees all champions now, so they may be filled in on the site.
                var all = Players(c, sess, null);
                if (all.Count > 0)
                {
                    lastPlayers = all.Select(p => (string)p["riotId"]).ToList();
                    log("Game loading: " + string.Join(", ", all.Select(p => p["riotId"] + (p.ContainsKey("champion") ? " " + p["champion"] : "")).ToArray()));
                    Send(Dict("type", "champselect", "stage", "loading", "players", all.Cast<object>().ToArray()), "Champions sent");
                }
                if (lastPlayers.Count >= 1) Send(Dict("type", "phase", "phase", "InProgress", "players", lastPlayers.ToArray()), "Game started");
                else log("Game started, but no players could be read");
            }
            else if (phase == "EndOfGame" || phase == "PreEndOfGame" || phase == "WaitingForStats") EndOfGame(c);
        }

        string RiotId(LcuCreds c, string puuid, object player)
        {
            if (string.IsNullOrEmpty(puuid)) return null;
            string id;
            if (riotIds.TryGetValue(puuid, out id)) return id;
            var name = Json.Str(player, "gameName") ?? Json.Str(player, "riotIdGameName");
            var tag = Json.Str(player, "tagLine") ?? Json.Str(player, "riotIdTagLine");
            if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(tag))
            {
                var s = Lcu.Get(c, "/lol-summoner/v2/summoners/puuid/" + Uri.EscapeDataString(puuid));
                name = Json.Str(s, "gameName");
                tag = Json.Str(s, "tagLine");
            }
            if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(tag)) return null;
            id = name + "#" + tag;
            riotIds[puuid] = id;
            return id;
        }

        string Champion(LcuCreds c, long id)
        {
            if (id <= 0) return null;
            if (champions == null || !champions.ContainsKey(id))
            {
                var list = Lcu.Get(c, "/lol-game-data/assets/v1/champion-summary.json") as object[];
                if (list != null)
                {
                    champions = new Dictionary<long, string>();
                    foreach (var ch in list)
                    {
                        var cid = Json.Long(ch, "id");
                        var nm = Json.Str(ch, "name");
                        if (cid.HasValue && cid.Value > 0 && !string.IsNullOrEmpty(nm)) champions[cid.Value] = nm;
                    }
                }
            }
            string n;
            return champions != null && champions.TryGetValue(id, out n) ? n : null;
        }

        /// Everyone in the game with their side (blue = team 100 / teamOne, red = team 200 / teamTwo) and champion.
        /// The lobby (gameflow session) lists both teams; champ select only shows your own team's picks
        /// in custom games, so both are combined.
        List<Dictionary<string, object>> Players(LcuCreds c, object sess, object champSelect)
        {
            var byPuuid = new Dictionary<string, Dictionary<string, object>>();
            var order = new List<string>();
            Action<object, string> add = delegate(object p, string side)
            {
                var puuid = Json.Str(p, "puuid");
                if (string.IsNullOrEmpty(puuid)) return;
                Dictionary<string, object> e;
                if (!byPuuid.TryGetValue(puuid, out e))
                {
                    var rid = RiotId(c, puuid, p);
                    if (rid == null) return;
                    e = Dict("riotId", rid);
                    byPuuid[puuid] = e;
                    order.Add(puuid);
                }
                if (side != null && !e.ContainsKey("side")) e["side"] = side;
                var champId = Json.Long(p, "championId") ?? 0;
                if (champId <= 0) champId = Json.Long(p, "championPickIntent") ?? 0;
                var name = Champion(c, champId);
                if (!string.IsNullOrEmpty(name)) e["champion"] = name;
            };

            var gd = Json.Dict(sess, "gameData");
            foreach (var p in Json.List(gd, "teamOne") ?? new object[0]) add(p, "blue");
            foreach (var p in Json.List(gd, "teamTwo") ?? new object[0]) add(p, "red");
            foreach (var sel in Json.List(gd, "playerChampionSelections") ?? new object[0]) add(sel, null);

            if (champSelect != null)
            {
                foreach (var team in new[] { "myTeam", "theirTeam" })
                    foreach (var p in Json.List(champSelect, team) ?? new object[0])
                    {
                        var t = Json.Long(p, "team");
                        add(p, t == 1 ? "blue" : t == 2 ? "red" : null);
                    }
            }
            return order.Select(k => byPuuid[k]).ToList();
        }

        void ChampSelect(LcuCreds c, object sess)
        {
            var cs = Lcu.Get(c, "/lol-champ-select/v1/session");
            var players = Players(c, sess, cs);
            if (players.Count == 0)
            {
                if (lastPicksSig != "none") log("Champ select: no players could be read yet");
                lastPicksSig = "none";
                return;
            }
            lastPlayers = players.Select(p => (string)p["riotId"]).ToList();
            // Fair play: during champ select nobody may learn picks they can't see in their own client
            // (the site is shared by both teams). So only names and sides are sent here; champions follow
            // when the game loads, when everyone sees all champions on the loading screen anyway.
            foreach (var p in players) p.Remove("champion");
            var sig = Json.Write(players);
            // Send when picks change, and repeat every 20 s in case the site needed a moment.
            if (sig == lastPicksSig && (DateTime.UtcNow - lastPicksSent).TotalSeconds < 20) return;
            if (sig != lastPicksSig)
                log("Champ select: " + string.Join(", ", players.Select(p => p["riotId"] + (p.ContainsKey("side") ? " (" + p["side"] + ")" : "")).ToArray()));
            lastPicksSig = sig;
            lastPicksSent = DateTime.UtcNow;
            Send(Dict("type", "champselect", "players", players.Cast<object>().ToArray()), "Champ select sent");
        }

        void EndOfGame(LcuCreds c)
        {
            if (eogGiveUp != DateTime.MinValue && DateTime.UtcNow > eogGiveUp) return;
            if (eogGiveUp == DateTime.MinValue) eogGiveUp = DateTime.UtcNow.AddMinutes(5);
            var b = Lcu.Get(c, "/lol-end-of-game/v1/eog-stats-block");
            if (b == null) return;
            var gameId = Json.Long(b, "gameId");
            if (!gameId.HasValue || gameId.Value <= 0) return;
            var gid = gameId.Value.ToString();
            if (settings.SentGames.Contains(gid)) return;

            var players = new List<object>();
            var teams = Json.List(b, "teams") ?? new object[0];
            foreach (var t in teams)
            {
                var teamId = Json.Long(t, "teamId") ?? 0;
                var win = Json.Bool(t, "isWinningTeam");
                var side = teamId == 100 ? "blue" : teamId == 200 ? "red" : null;
                foreach (var p in Json.List(t, "players") ?? new object[0])
                {
                    var rid = RiotId(c, Json.Str(p, "puuid"), p);
                    var pteam = Json.Long(p, "teamId") ?? teamId;
                    var pside = pteam == 100 ? "blue" : pteam == 200 ? "red" : side;
                    if (rid == null || pside == null || !win.HasValue) continue;
                    var st = Json.Dict(p, "stats");
                    var items = new List<long>();
                    foreach (var it in Json.List(p, "items") ?? new object[0])
                    {
                        long v;
                        if (it != null && long.TryParse(it.ToString(), out v) && v > 0) items.Add(v);
                    }
                    var d = Dict("riotId", rid, "side", pside, "win", win.Value,
                        "champion", Champion(c, Json.Long(p, "championId") ?? 0) ?? "");
                    var k = Json.Long(st, "CHAMPIONS_KILLED"); if (k.HasValue) d["kills"] = k.Value;
                    var de = Json.Long(st, "NUM_DEATHS"); if (de.HasValue) d["deaths"] = de.Value;
                    var a = Json.Long(st, "ASSISTS"); if (a.HasValue) d["assists"] = a.Value;
                    var dmg = Json.Long(st, "TOTAL_DAMAGE_DEALT_TO_CHAMPIONS"); if (dmg.HasValue) d["damage"] = dmg.Value;
                    if (items.Count > 0) d["items"] = items.ToArray();
                    players.Add(d);
                }
            }
            if (players.Count < 2) { log("End of game: not enough player data yet"); return; }
            var body = Dict("type", "result", "gameId", gid, "players", players.ToArray());
            var len = Json.Long(b, "gameLength");
            if (len.HasValue && len.Value > 0) body["durationSec"] = len.Value;
            if (Send(body, "Game result " + gid))
            {
                settings.SentGames.Add(gid);
                try { settings.Save(); } catch { }
            }
        }

        static Dictionary<string, object> Dict(params object[] kv)
        {
            var d = new Dictionary<string, object>();
            for (var i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
            return d;
        }

        public bool Send(Dictionary<string, object> body, string what)
        {
            if (settings.Paused) { log(what + ": not sent (paused)"); return false; }
            if (string.IsNullOrEmpty(settings.Token)) { log(what + ": not sent (no helper token in Settings)"); return false; }
            string note;
            var ok = Post(settings, body, out note);
            log(what + ": " + note);
            return ok;
        }

        public static bool Post(Settings s, Dictionary<string, object> body, out string note)
        {
            Uri uri;
            if (!Uri.TryCreate(s.Server, UriKind.Absolute, out uri) || uri.Scheme != "https") { note = "server URL must start with https://"; return false; }
            var req = (HttpWebRequest)WebRequest.Create(uri);
            req.Method = "POST";
            req.ContentType = "application/json; charset=utf-8";
            req.Timeout = 10000;
            req.UserAgent = "BridgeNightHelper/" + Program.Version;
            req.Headers["Authorization"] = "Bearer " + s.Token;
            var bytes = Encoding.UTF8.GetBytes(Json.Write(body));
            try
            {
                using (var st = req.GetRequestStream()) st.Write(bytes, 0, bytes.Length);
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                {
                    var j = Json.Parse(r.ReadToEnd());
                    note = Json.Str(j, "note") ?? "sent";
                    return Json.Bool(j, "ok") ?? true;
                }
            }
            catch (WebException e)
            {
                var res = e.Response as HttpWebResponse;
                if (res != null)
                {
                    try
                    {
                        using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                            note = Json.Str(Json.Parse(r.ReadToEnd()), "note") ?? ("error " + (int)res.StatusCode);
                    }
                    catch { note = "error " + (int)res.StatusCode; }
                }
                else note = "no connection to the server";
                return false;
            }
        }
    }

    /* ------------------------------------------------------------------ tray + settings window */

    class TrayApp : ApplicationContext
    {
        readonly NotifyIcon icon = new NotifyIcon();
        readonly Settings settings = Settings.Load();
        readonly List<string> logLines = new List<string>();
        readonly SynchronizationContext ui;
        readonly System.Threading.Timer timer;
        readonly Watcher watcher;
        readonly ToolStripMenuItem pauseItem;
        SettingsForm form;
        string statusText = "Starting";

        public TrayApp()
        {
            ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            icon.Icon = MakeIcon();
            icon.Text = "Bridge Night Helper";
            var menu = new ContextMenuStrip();
            menu.Items.Add("Settings and log", null, delegate { ShowSettings(); });
            pauseItem = new ToolStripMenuItem("Pause sending", null, delegate { SetPaused(!settings.Paused); });
            pauseItem.Checked = settings.Paused;
            menu.Items.Add(pauseItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Exit", null, delegate { Quit(); });
            icon.ContextMenuStrip = menu;
            icon.DoubleClick += delegate { ShowSettings(); };
            icon.Visible = true;

            watcher = new Watcher(settings, Log, Status);
            Log("Bridge Night Helper " + Program.Version + " started");
            timer = new System.Threading.Timer(delegate { watcher.Tick(); }, null, 1000, 2000);
            if (string.IsNullOrEmpty(settings.Token)) ShowSettings();
        }

        static Icon MakeIcon()
        {
            using (var bmp = new Bitmap(32, 32))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                    g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                    using (var bg = new SolidBrush(Color.FromArgb(11, 15, 20))) g.FillEllipse(bg, 0, 0, 31, 31);
                    using (var f = new Font("Segoe UI", 15, FontStyle.Bold, GraphicsUnit.Pixel))
                    using (var fg = new SolidBrush(Color.FromArgb(191, 230, 255)))
                    {
                        var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                        g.DrawString("BN", f, fg, new RectangleF(0, 0, 32, 32), sf);
                    }
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }

        static readonly object fileLock = new object();
        static string LogFile { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BridgeNightHelper", "helper-log.txt"); } }

        /// Also keeps a log file (no token in it), so problems can be checked after the game.
        static void WriteLogFile(string text)
        {
            try
            {
                lock (fileLock)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(LogFile));
                    var fi = new FileInfo(LogFile);
                    if (fi.Exists && fi.Length > 512 * 1024)
                    {
                        var keep = File.ReadAllLines(LogFile, Encoding.UTF8);
                        File.WriteAllLines(LogFile, keep.Skip(keep.Length / 2).ToArray(), Encoding.UTF8);
                    }
                    File.AppendAllText(LogFile, DateTime.Now.ToString("yyyy-MM-dd ") + text + Environment.NewLine, Encoding.UTF8);
                }
            }
            catch { }
        }

        void Log(string line)
        {
            var text = DateTime.Now.ToString("HH:mm:ss") + "  " + line;
            WriteLogFile(text);
            ui.Post(delegate
            {
                logLines.Add(text);
                while (logLines.Count > 200) logLines.RemoveAt(0);
                if (form != null && !form.IsDisposed) form.AddLog(text);
            }, null);
        }

        void Status(string s)
        {
            ui.Post(delegate
            {
                if (s == statusText) return;
                statusText = s;
                var t = "Bridge Night Helper: " + s;
                icon.Text = t.Length > 63 ? t.Substring(0, 63) : t;
                if (form != null && !form.IsDisposed) form.SetStatus(s);
            }, null);
        }

        void SetPaused(bool p)
        {
            settings.Paused = p;
            pauseItem.Checked = p;
            try { settings.Save(); } catch { }
            Log(p ? "Paused: nothing is sent" : "Sending again");
            if (form != null && !form.IsDisposed) form.SetPaused(p);
        }

        void ShowSettings()
        {
            if (form == null || form.IsDisposed)
            {
                form = new SettingsForm(settings, logLines, statusText, SetPaused, Log);
            }
            form.Show();
            form.Activate();
        }

        void Quit()
        {
            timer.Dispose();
            icon.Visible = false;
            icon.Dispose();
            ExitThread();
        }
    }

    class SettingsForm : Form
    {
        readonly Settings settings;
        readonly TextBox server = new TextBox();
        readonly TextBox token = new TextBox();
        readonly CheckBox paused = new CheckBox();
        readonly CheckBox autostart = new CheckBox();
        readonly ListBox logBox = new ListBox();
        readonly Label status = new Label();
        readonly Action<bool> onPause;
        readonly Action<string> log;

        public SettingsForm(Settings s, List<string> lines, string statusText, Action<bool> onPause, Action<string> log)
        {
            settings = s;
            this.onPause = onPause;
            this.log = log;
            Text = "Bridge Night Helper " + Program.Version;
            Width = 620; Height = 560;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9.5f);
            MinimumSize = new Size(520, 460);

            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Padding = new Padding(12) };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

            status.AutoSize = true; status.Text = "Status: " + statusText; status.Font = new Font(Font, FontStyle.Bold);
            layout.Controls.Add(status, 0, 0); layout.SetColumnSpan(status, 2);

            layout.Controls.Add(new Label { Text = "Server URL", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 1);
            server.Text = s.Server; server.Dock = DockStyle.Fill;
            layout.Controls.Add(server, 1, 1);

            layout.Controls.Add(new Label { Text = "Helper token", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 2);
            token.Text = s.Token; token.UseSystemPasswordChar = true; token.Dock = DockStyle.Fill;
            layout.Controls.Add(token, 1, 2);

            var hint = new Label { AutoSize = true, MaximumSize = new Size(560, 0), ForeColor = SystemColors.GrayText,
                Text = "Get a token from an admin (Players page on the site, \"Helper tokens\"). It is stored encrypted for your Windows account." };
            layout.Controls.Add(hint, 0, 3); layout.SetColumnSpan(hint, 2);

            paused.Text = "Pause sending"; paused.AutoSize = true; paused.Checked = s.Paused;
            paused.CheckedChanged += delegate { onPause(paused.Checked); };
            layout.Controls.Add(paused, 0, 4); layout.SetColumnSpan(paused, 2);

            autostart.Text = "Start with Windows"; autostart.AutoSize = true;
            try { autostart.Checked = Settings.Autostart; } catch { }
            autostart.CheckedChanged += delegate
            {
                try { Settings.Autostart = autostart.Checked; } catch (Exception e) { MessageBox.Show("Could not change that: " + e.Message); }
            };
            layout.Controls.Add(autostart, 0, 5); layout.SetColumnSpan(autostart, 2);

            var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill };
            var save = new Button { Text = "Save", AutoSize = true };
            save.Click += delegate { SaveSettings(); };
            var test = new Button { Text = "Save and test connection", AutoSize = true };
            test.Click += delegate { SaveSettings(); TestConnection(); };
            buttons.Controls.Add(save); buttons.Controls.Add(test);
            layout.Controls.Add(buttons, 0, 6); layout.SetColumnSpan(buttons, 2);

            layout.Controls.Add(new Label { Text = "Last messages", AutoSize = true }, 0, 7);
            logBox.Dock = DockStyle.Fill; logBox.HorizontalScrollbar = true; logBox.IntegralHeight = false;
            foreach (var l in lines) logBox.Items.Add(l);
            layout.Controls.Add(logBox, 0, 8); layout.SetColumnSpan(logBox, 2);
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            for (var i = 0; i < 8; i++) layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

            var about = new Label { AutoSize = true, MaximumSize = new Size(560, 0), ForeColor = SystemColors.GrayText,
                Text = "Read-only: it only reads the League client on this PC and never controls it. Sends data for custom games only. Close it from the tray icon (right-click, Exit)." };
            layout.Controls.Add(about, 0, 9); layout.SetColumnSpan(about, 2);

            Controls.Add(layout);
            ScrollLog();
        }

        void SaveSettings()
        {
            var url = server.Text.Trim();
            if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                MessageBox.Show("The server URL must start with https://", "Bridge Night Helper");
                return;
            }
            settings.Server = url;
            settings.Token = token.Text.Trim();
            try { settings.Save(); log("Settings saved"); }
            catch (Exception e) { MessageBox.Show("Could not save: " + e.Message); }
        }

        void TestConnection()
        {
            var s = settings;
            ThreadPool.QueueUserWorkItem(delegate
            {
                string note;
                var d = new Dictionary<string, object>();
                d["type"] = "hello";
                var ok = Watcher.Post(s, d, out note);
                log("Connection test: " + note);
                BeginInvoke((Action)delegate { MessageBox.Show(this, ok ? "Works! " + note : "Not working: " + note, "Bridge Night Helper"); });
            });
        }

        public void AddLog(string line) { logBox.Items.Add(line); while (logBox.Items.Count > 200) logBox.Items.RemoveAt(0); ScrollLog(); }
        void ScrollLog() { if (logBox.Items.Count > 0) logBox.TopIndex = logBox.Items.Count - 1; }
        public void SetStatus(string s) { status.Text = "Status: " + s; }
        public void SetPaused(bool p) { if (paused.Checked != p) paused.Checked = p; }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // Closing the window keeps the helper running in the tray.
            if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); }
            base.OnFormClosing(e);
        }
    }
}
