// Bridge Night Helper: a small Windows tray app.
//
// What it does:
//   * Reads two local APIs on this PC (127.0.0.1): the League client's, and the one Riot's game offers for tools
//     (Live Client Data, port 2999). It only sends GET requests: it never sends commands, never clicks anything,
//     never reads game memory.
//   * In custom games only: sends who plays on which side, then champions, levels, K/D/A, items, summoner spells,
//     game events, and after the game the result, damage and augments. Only the fields listed in Reading() below.
//     During champ select only names and sides, never champions.
//   * Talks to exactly one server: the URL in its settings (our Supabase Edge Function),
//     with the helper token you made on the site.
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
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Bridge Night Helper")]
[assembly: AssemblyProduct("Bridge Night Helper")]
[assembly: AssemblyDescription("Shows custom games on the Bridge Night site. Read-only towards League.")]
[assembly: AssemblyVersion("0.7.0.0")]
[assembly: AssemblyFileVersion("0.7.0.0")]

namespace BridgeNight
{
    static class Program
    {
        public const string Version = "0.7.0";
        public const string DefaultServer = "https://kimgoxjydargqtbwolxz.supabase.co/functions/v1/live";
        /// Versions before 0.5 sent to this one. Settings that still have it move to the new one.
        public const string OldServer = "https://kimgoxjydargqtbwolxz.supabase.co/functions/v1/helper";
#if TEST
        // build.ps1 -Test: a separate program with its own settings, next to the normal helper.
        public const string Id = "BridgeNightHelperTest";
        public const string Title = "Bridge Night Helper TEST";
#else
        public const string Id = "BridgeNightHelper";
        public const string Title = "Bridge Night Helper";
#endif

        /// Set when this process was started by Updater after replacing the exe: the version it replaced.
        public static string UpdatedFrom = "";

        [STAThread]
        static void Main(string[] args)
        {
            bool created;
            for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--updated-from") UpdatedFrom = args[i + 1];
            using (var mutex = new Mutex(true, Id + "-single-instance", out created))
            {
                // After an update the old process may still be closing: wait for it instead of complaining.
                if (!created && UpdatedFrom != "")
                {
                    try { created = mutex.WaitOne(15000); } catch (AbandonedMutexException) { created = true; }
                }
                if (!created)
                {
                    MessageBox.Show(Title + " is already running. Look for its icon next to the clock.", Title);
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
        // 0.7 options (Settings page). Defaults keep the PC light: only what the user switches on runs.
        public bool AutoUpdate = true;      // install new versions by itself (never during a game)
        public bool LiveMeasure = true;     // Performance page measures while it is open
        public int MeasureEvery = 5;        // seconds: 1, 5 or 10
        public bool RecordLastGame = true;  // keep a light performance record of each custom game
        public bool ResultAlerts = true;    // pop-up when a result is saved
        public bool GameModeAuto = true;    // apply game mode when a game starts
        public bool PowerPlanInGame = true; // high-performance power plan during games
        public bool MusicQuieter = false;   // turn music apps down during games
        public bool BreakReminder = false;  // remind after long sessions
        public bool Hotkeys = true;         // Ctrl+Alt+M (mic) and Ctrl+Alt+H (output)
        public bool MuteSound = true;       // short sound when muting/unmuting
        public bool MutedBadge = true;      // small "Muted" badge on screen
        public bool TourDone = false;       // first-start tour finished or skipped

        public static string Dir
        {
            get
            {
#if TEST
                var dir = Environment.GetEnvironmentVariable("BN_HELPER_DIR");
                if (!string.IsNullOrEmpty(dir)) return dir;
#endif
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), Program.Id);
            }
        }
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
                if (s.Server == Program.OldServer) s.Server = Program.DefaultServer;
                s.Paused = Json.Bool(d, "paused") ?? false;
                s.AutoUpdate = Json.Bool(d, "autoUpdate") ?? true;
                s.LiveMeasure = Json.Bool(d, "liveMeasure") ?? true;
                var every = Json.Long(d, "measureEvery") ?? 5;
                s.MeasureEvery = every == 1 || every == 10 ? (int)every : 5;
                s.RecordLastGame = Json.Bool(d, "recordLastGame") ?? true;
                s.ResultAlerts = Json.Bool(d, "resultAlerts") ?? true;
                s.GameModeAuto = Json.Bool(d, "gameModeAuto") ?? true;
                s.PowerPlanInGame = Json.Bool(d, "powerPlanInGame") ?? true;
                s.MusicQuieter = Json.Bool(d, "musicQuieter") ?? false;
                s.BreakReminder = Json.Bool(d, "breakReminder") ?? false;
                s.Hotkeys = Json.Bool(d, "hotkeys") ?? true;
                s.MuteSound = Json.Bool(d, "muteSound") ?? true;
                s.MutedBadge = Json.Bool(d, "mutedBadge") ?? true;
                s.TourDone = Json.Bool(d, "tourDone") ?? false;
                var enc = Json.Str(d, "token");
                if (!string.IsNullOrEmpty(enc))
                {
                    try
                    {
                        s.Token = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(enc), null, DataProtectionScope.CurrentUser));
                    }
                    catch { s.Token = ""; }
                }
            }
            catch { }
            return s;
        }

        public void Save()
        {
            Directory.CreateDirectory(Dir);
            var enc = string.IsNullOrEmpty(Token) ? "" :
                Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(Token), null, DataProtectionScope.CurrentUser));
            var d = new Dictionary<string, object>();
            d["server"] = Server;
            d["token"] = enc;
            d["paused"] = Paused;
            d["autoUpdate"] = AutoUpdate;
            d["liveMeasure"] = LiveMeasure;
            d["measureEvery"] = MeasureEvery;
            d["recordLastGame"] = RecordLastGame;
            d["resultAlerts"] = ResultAlerts;
            d["gameModeAuto"] = GameModeAuto;
            d["powerPlanInGame"] = PowerPlanInGame;
            d["musicQuieter"] = MusicQuieter;
            d["breakReminder"] = BreakReminder;
            d["hotkeys"] = Hotkeys;
            d["muteSound"] = MuteSound;
            d["mutedBadge"] = MutedBadge;
            d["tourDone"] = TourDone;
            File.WriteAllText(FilePath, Json.Write(d), Encoding.UTF8);
        }

        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        public static bool Autostart
        {
            get
            {
                using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(RunKey))
                    return k != null && k.GetValue(Program.Id) != null;
            }
            set
            {
                using (var k = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(RunKey))
                {
                    if (value) k.SetValue(Program.Id, "\"" + Application.ExecutablePath + "\"");
                    else k.DeleteValue(Program.Id, false);
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
#if TEST
            // Only for the automatic test: a stand-in for League.
            var fake = Environment.GetEnvironmentVariable("LEAGUE_DIR");
            if (!string.IsNullOrEmpty(fake))
            {
                var p = File.ReadAllText(Path.Combine(fake, "lockfile")).Split(':');
                return new LcuCreds { Port = int.Parse(p[2]), Password = p[3] };
            }
#endif
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
            return Get(c.Port, path, c.Password);
        }

        /// The running game's own data (Riot's Live Client Data API). null while no game is running.
        public static object GetGame(string path)
        {
            var port = 2999;
#if TEST
            int p;
            if (int.TryParse(Environment.GetEnvironmentVariable("LEAGUE_GAME_PORT"), out p)) port = p;
#endif
            return Get(port, path, null);
        }

        static object Get(int port, string path, string password)
        {
            var req = (HttpWebRequest)WebRequest.Create("https://127.0.0.1:" + port + path);
            req.Method = "GET";
            req.Timeout = 4000;
            req.ReadWriteTimeout = 4000;
            req.Accept = "application/json";
            if (password != null) req.Headers["Authorization"] = "Basic " + Convert.ToBase64String(Encoding.ASCII.GetBytes("riot:" + password));
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

    /// Reads League every moment and sends what it sees, trimmed to what the site needs, to our server.
    /// The server decides what it means (src/lib/live.ts). Custom games only: from other games nothing is read or sent.
    class Watcher
    {
        static readonly HashSet<string> Flow = new HashSet<string> { "ChampSelect", "GameStart", "InProgress", "Reconnect", "WaitingForStats", "PreEndOfGame", "EndOfGame" };
        static readonly HashSet<string> InGame = new HashSet<string> { "GameStart", "InProgress", "Reconnect", "PreEndOfGame", "WaitingForStats" };
        static readonly HashSet<string> Over = new HashSet<string> { "WaitingForStats", "PreEndOfGame", "EndOfGame" };
        const double SendEvery = 2.8;

        readonly Settings settings;
        readonly Action<string> log;
        readonly Action<string> status;
        int busy;
        string lastPhase = "";
        bool? lastCustom;
        object lobby;                                                                     // the teams as they were in the lobby
        readonly Dictionary<string, string> names = new Dictionary<string, string>();     // puuid -> Name#TAG
        readonly Dictionary<string, DateTime> asked = new Dictionary<string, DateTime>(); // puuids that didn't answer
        Dictionary<string, object> champions;                                             // id -> Data Dragon id
        LcuCreds creds;

        // what the server last said about the game
        string gameId, gameStatus;
        bool needHistory, greeted;
        DateTime endedAt, lastSend = DateTime.MinValue, lastHistory = DateTime.MinValue, backoff = DateTime.MinValue, lastFind = DateTime.MinValue;
        string lastNote = "";

        public Watcher(Settings s, Action<string> log, Action<string> status) { settings = s; this.log = log; this.status = status; }

        public void Tick()
        {
            if (Interlocked.Exchange(ref busy, 1) == 1) return;
            try { Step(); }
            catch (Exception e) { Say("Problem: " + e.Message); }
            finally { Interlocked.Exchange(ref busy, 0); }
        }

        /// Logs something once, until something else happens.
        void Say(string note) { if (note != lastNote) { lastNote = note; log(note); } }

        void Step()
        {
            if (creds == null && (DateTime.UtcNow - lastFind).TotalSeconds >= 4) { lastFind = DateTime.UtcNow; creds = Lcu.Find(); }
            var c = creds;
            var answer = c == null ? null : Lcu.Get(c, "/lol-gameflow/v1/gameflow-phase");
            if (answer == null)
            {
                // Closed, or just starting. Nothing is sent: a short hiccup must not end a game.
                creds = null;
                status("Waiting for the League client");
                if (lastPhase != "") { lastPhase = ""; lastCustom = null; log("League client closed"); }
                return;
            }
            var phase = answer.ToString();
            if (lastPhase == "") log("Connected to the League client");
            var changed = phase != lastPhase;
            if (changed) log("Client phase: " + phase);
            lastPhase = phase;

            if (phase == "Lobby")
            {
                var l = Lcu.Get(c, "/lol-lobby/v2/lobby");
                lobby = Json.Bool(Json.Dict(l, "gameConfig"), "isCustom") == true ? l : null;
            }
            if (phase == "ChampSelect" && changed)
            {
                // A new game: forget everyone from before.
                names.Clear(); asked.Clear();
                gameId = null; gameStatus = null; needHistory = false;
            }

            object session = null;
            var flow = Flow.Contains(phase);
            if (flow)
            {
                session = Lcu.Get(c, "/lol-gameflow/v1/session");
                if (session == null) return;
                var custom = Json.Bool(Json.Dict(session, "gameData"), "isCustomGame") == true;
                if (custom != lastCustom) log(custom ? "Custom game" : "Not a custom game: nothing is read or sent");
                lastCustom = custom;
                status(settings.Paused ? "Paused" : custom ? "Custom game: " + phase : "Not a custom game");
                if (!custom)
                {
                    // Only the result of our earlier custom game, if we are still waiting for it.
                    var h = History(c, false);
                    if (h != null) Send(Reading("None", c, null, null, null, null, null, h));
                    return;
                }
            }
            else
            {
                lastCustom = null;
                status(settings.Paused ? "Paused" : "Connected to the League client");
            }

            var now = DateTime.UtcNow;
            var other = gameStatus == "other";
            if (now < backoff || (now - lastSend).TotalSeconds < (other ? 10 : SendEvery)) return;

            if (flow)
            {
                // Once the server has everything, the end screen has nothing new.
                if (Over.Contains(phase) && gameStatus == "ended" && !needHistory) return;
                object cs = null, lob = null, game = null, eog = null;
                if (phase == "ChampSelect")
                {
                    cs = Lcu.Get(c, "/lol-champ-select/v1/session");
                    lob = Lcu.Get(c, "/lol-lobby/v2/lobby");
                    if (Json.List(Json.Dict(lob, "gameConfig"), "customTeam100") == null) lob = lobby;
                }
                if (InGame.Contains(phase)) game = Lcu.GetGame("/liveclientdata/allgamedata");
                if (Over.Contains(phase))
                {
                    eog = Lcu.Get(c, "/lol-end-of-game/v1/eog-stats-block");
                    // Right after a game, the block can still be the one of the game before.
                    if (gameId != null && Json.Str(eog, "gameId") != gameId) eog = null;
                }
                Send(Reading(phase, c, session, cs, lob, game, eog, History(c, phase == "Reconnect")));
                return;
            }

            // Not in a game. Our game may still be open on the site, or wait for its result.
            var open = gameStatus == "select" || gameStatus == "loading" || gameStatus == "playing";
            var history = History(c, gameStatus == "playing");
            if (!greeted || open || history != null) Send(Reading(phase, c, null, null, null, null, null, history));
        }

        /// Our game in the client's match history: augments after a game, and the result if this player left early.
        object History(LcuCreds c, bool left)
        {
            if (gameId == null) return null;
            var now = DateTime.UtcNow;
            var waiting = gameStatus == "ended" && needHistory && (now - endedAt).TotalMinutes < 60;
            if (!waiting && !left) return null;
            var pause = waiting && (now - endedAt).TotalSeconds < 60 ? 4 : 20;
            if ((now - lastHistory).TotalSeconds < pause) return null;
            lastHistory = now;
            var h = Lcu.Get(c, "/lol-match-history/v1/games/" + Uri.EscapeDataString(gameId));
            return Json.Str(h, "gameId") == gameId ? h : null;
        }

        /* ---------- what is sent: only what the site needs ---------- */

        static Dictionary<string, object> Pick(object o, params string[] keys)
        {
            var d = new Dictionary<string, object>();
            foreach (var k in keys) { var v = Json.Get(o, k); if (v != null) d[k] = v; }
            return d;
        }
        static object[] PickAll(object o, string key, Func<object, object> f)
        {
            return (Json.List(o, key) ?? new object[0]).Select(f).ToArray();
        }
        /// Field names differ between patches, so every "surrender" flag is sent.
        static Dictionary<string, object> WithSurrender(Dictionary<string, object> d, object o)
        {
            var src = o as Dictionary<string, object>;
            if (src != null) foreach (var kv in src) if (kv.Key.IndexOf("surrender", StringComparison.OrdinalIgnoreCase) >= 0) d[kv.Key] = kv.Value;
            return d;
        }
        static string[] Numbered(string prefix, int from, int to) { return Enumerable.Range(from, to - from + 1).Select(n => prefix + n).ToArray(); }

        Dictionary<string, object> Reading(string phase, LcuCreds c, object session, object champSelect, object lob, object game, object eog, object history)
        {
            var who = new HashSet<string>();
            var champs = new HashSet<string>();
            Func<object, object> person = delegate(object p)
            {
                var puuid = Json.Str(p, "puuid");
                if (!string.IsNullOrEmpty(puuid)) who.Add(puuid);
                var id = Json.Str(p, "championId");
                if (id != null) champs.Add(id);
                return Pick(p, "puuid", "championId", "spell1Id", "spell2Id", "gameName", "tagLine", "riotIdGameName", "riotIdTagLine");
            };
            // Fair play: nobody may learn picks their own client hides, and both teams see the site.
            // So from champ select only names and sides are sent, never champions.
            Func<object, object> faceless = delegate(object p)
            {
                var puuid = Json.Str(p, "puuid");
                if (!string.IsNullOrEmpty(puuid)) who.Add(puuid);
                return Pick(p, "puuid", "team", "isBot", "gameName", "tagLine");
            };

            var r = Dict("phase", phase);
            if (session != null)
            {
                var gd = Json.Dict(session, "gameData");
                var g = Pick(gd, "isCustomGame");
                g["queue"] = Pick(Json.Dict(gd, "queue"), "gameMode", "mapId");
                // In champ select, League still reports the id and the players of the game before.
                if (phase != "ChampSelect")
                {
                    g["gameId"] = Json.Get(gd, "gameId");
                    g["teamOne"] = PickAll(gd, "teamOne", person);
                    g["teamTwo"] = PickAll(gd, "teamTwo", person);
                    g["playerChampionSelections"] = PickAll(gd, "playerChampionSelections", person);
                }
                r["session"] = Dict("gameData", g, "map", Pick(Json.Dict(session, "map"), "id", "gameMode", "name"));
            }
            if (phase == "ChampSelect")
            {
                r["champSelect"] = Dict("myTeam", PickAll(champSelect, "myTeam", faceless), "theirTeam", PickAll(champSelect, "theirTeam", faceless));
                var cfg = Json.Dict(lob, "gameConfig");
                r["lobby"] = Dict("gameConfig", Dict("customTeam100", PickAll(cfg, "customTeam100", faceless), "customTeam200", PickAll(cfg, "customTeam200", faceless)));
            }
            if (game != null)
            {
                var events = Json.List(Json.Dict(game, "events"), "Events") ?? new object[0];
                r["inGame"] = Dict(
                    "activePlayer", Pick(Json.Dict(game, "activePlayer"), "riotId", "summonerName"),
                    "gameData", Pick(Json.Dict(game, "gameData"), "gameTime", "gameMode", "mapNumber"),
                    "events", Dict("Events", events.Skip(Math.Max(0, events.Length - 150)).ToArray()),
                    "allPlayers", PickAll(game, "allPlayers", delegate(object p)
                    {
                        var d = Pick(p, "championName", "rawChampionName", "isBot", "isDead", "level", "riotId", "riotIdGameName", "riotIdTagLine", "summonerName", "team");
                        d["scores"] = Pick(Json.Dict(p, "scores"), "kills", "deaths", "assists");
                        d["items"] = PickAll(p, "items", delegate(object i) { return Pick(i, "itemID", "slot"); });
                        var sp = Json.Dict(p, "summonerSpells");
                        d["summonerSpells"] = Dict("summonerSpellOne", Pick(Json.Dict(sp, "summonerSpellOne"), "rawDisplayName"),
                            "summonerSpellTwo", Pick(Json.Dict(sp, "summonerSpellTwo"), "rawDisplayName"));
                        return d;
                    }));
            }
            if (eog != null)
            {
                var b = WithSurrender(Pick(eog, "gameId", "gameLength", "invalid"), eog);
                b["teams"] = PickAll(eog, "teams", delegate(object t)
                {
                    var d = WithSurrender(Pick(t, "teamId", "isWinningTeam"), t);
                    d["players"] = PickAll(t, "players", delegate(object p)
                    {
                        var e = WithSurrender((Dictionary<string, object>)person(p), p);
                        foreach (var kv in Pick(p, "teamId", "botPlayer", "leaver", "items")) e[kv.Key] = kv.Value;
                        var st = Json.Dict(p, "stats");
                        e["stats"] = WithSurrender(Pick(st, new[] { "LEVEL", "CHAMPIONS_KILLED", "NUM_DEATHS", "ASSISTS", "TOTAL_DAMAGE_DEALT_TO_CHAMPIONS" }
                            .Concat(Numbered("PLAYER_AUGMENT_", 1, 6)).ToArray()), st);
                        return e;
                    });
                    return d;
                });
                r["eog"] = b;
            }
            if (history != null)
            {
                var b = Pick(history, "gameId", "gameDuration", "endOfGameResult");
                b["teams"] = PickAll(history, "teams", delegate(object t) { return Pick(t, "teamId", "win"); });
                b["participantIdentities"] = PickAll(history, "participantIdentities", delegate(object p)
                {
                    return Dict("participantId", Json.Get(p, "participantId"), "player", person(Json.Dict(p, "player")));
                });
                b["participants"] = PickAll(history, "participants", delegate(object p)
                {
                    var d = (Dictionary<string, object>)person(p);
                    d["participantId"] = Json.Get(p, "participantId");
                    d["teamId"] = Json.Get(p, "teamId");
                    var st = Json.Dict(p, "stats");
                    d["stats"] = Pick(st, new[] { "champLevel", "kills", "deaths", "assists", "totalDamageDealtToChampions", "gameEndedInSurrender", "gameEndedInEarlySurrender" }
                        .Concat(Numbered("item", 0, 6)).Concat(Numbered("playerAugment", 1, 6)).ToArray());
                    return d;
                });
                r["history"] = b;
            }
            r["names"] = Names(c, who);
            r["champions"] = Champions(c, champs);
            return r;
        }

        Dictionary<string, object> Names(LcuCreds c, IEnumerable<string> puuids)
        {
            var d = new Dictionary<string, object>();
            foreach (var puuid in puuids)
            {
                if (Regex.IsMatch(puuid, "^[0-]+$")) continue; // a bot
                string id;
                DateTime last;
                if (!names.TryGetValue(puuid, out id) && !(asked.TryGetValue(puuid, out last) && (DateTime.UtcNow - last).TotalSeconds < 20))
                {
                    asked[puuid] = DateTime.UtcNow;
                    var s = Lcu.Get(c, "/lol-summoner/v2/summoners/puuid/" + Uri.EscapeDataString(puuid));
                    var name = Json.Str(s, "gameName");
                    var tag = Json.Str(s, "tagLine");
                    if (!string.IsNullOrEmpty(name) && !string.IsNullOrEmpty(tag)) names[puuid] = id = name + "#" + tag;
                }
                if (id != null) d[puuid] = id;
            }
            return d;
        }

        Dictionary<string, object> Champions(LcuCreds c, HashSet<string> ids)
        {
            var d = new Dictionary<string, object>();
            if (ids.Count == 0) return d;
            if (champions == null)
            {
                var list = Lcu.Get(c, "/lol-game-data/assets/v1/champion-summary.json") as object[];
                if (list == null) return d;
                champions = new Dictionary<string, object>();
                foreach (var ch in list)
                {
                    var id = Json.Long(ch, "id");
                    var alias = Json.Str(ch, "alias");
                    if (id.HasValue && id.Value > 0 && !string.IsNullOrEmpty(alias)) champions[id.Value.ToString()] = alias;
                }
            }
            object v;
            foreach (var id in ids) if (champions.TryGetValue(id, out v)) d[id] = v;
            return d;
        }

        static Dictionary<string, object> Dict(params object[] kv)
        {
            var d = new Dictionary<string, object>();
            for (var i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
            return d;
        }

        /* ---------- sending ---------- */

        void Send(Dictionary<string, object> reading)
        {
            lastSend = DateTime.UtcNow;
            if (settings.Paused) { Say("Not sent (paused)"); return; }
            if (string.IsNullOrEmpty(settings.Token)) { Say("Not sent (no helper token in Settings)"); return; }
            string note;
            object reply;
            int code;
            var ok = Post(settings, Dict("type", "reading", "reading", reading), out note, out reply, out code);
            if (!ok)
            {
                if (code == 429) return; // too fast: the next one will do
                backoff = DateTime.UtcNow.AddSeconds(code == 401 || code == 403 || code == 404 ? 60 : 4);
                Say("Not sent: " + note);
                return;
            }
            greeted = true;
            var was = gameStatus;
            var id = Json.Str(reply, "gameId");
            if (note == "no custom game") { gameId = null; gameStatus = null; needHistory = false; }
            else if (note.StartsWith("another helper") || note.StartsWith("not in this game")) gameStatus = "other";
            else
            {
                gameStatus = note;
                if (id != null) gameId = id;
                needHistory = Json.Bool(reply, "history") == true;
                if (note == "ended" && was != "ended") endedAt = DateTime.UtcNow;
            }
            Say(note == "select" ? "Sent: champ select" : note == "loading" ? "Sent: loading screen" : note == "playing" ? "Sending the game"
                : note == "ended" ? (needHistory ? "Game over, waiting for the final details" : "Game over, everything sent") : "Server: " + note);
        }

        public static bool Post(Settings s, Dictionary<string, object> body, out string note, out object reply, out int code)
        {
            reply = null;
            code = 0;
            Uri uri;
            if (!Uri.TryCreate(s.Server, UriKind.Absolute, out uri) || uri.Scheme != "https") { note = "server URL must start with https://"; return false; }
            var req = (HttpWebRequest)WebRequest.Create(uri);
            req.Method = "POST";
            req.ContentType = "application/json; charset=utf-8";
            req.Timeout = 10000;
            req.ReadWriteTimeout = 10000;
            req.UserAgent = "BridgeNightHelper/" + Program.Version;
            req.ServicePoint.Expect100Continue = false;
            req.Headers["Authorization"] = "Bearer " + s.Token;
            var bytes = Encoding.UTF8.GetBytes(Json.Write(body));
            try
            {
                using (var st = req.GetRequestStream()) st.Write(bytes, 0, bytes.Length);
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                {
                    code = (int)res.StatusCode;
                    reply = Json.Parse(r.ReadToEnd());
                    note = Json.Str(reply, "note") ?? "sent";
                    return Json.Bool(reply, "ok") ?? true;
                }
            }
            catch (WebException e)
            {
                var res = e.Response as HttpWebResponse;
                if (res == null) { note = "no connection to the server"; return false; }
                code = (int)res.StatusCode;
                note = "error " + code;
                try
                {
                    using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                        note = Json.Str(Json.Parse(r.ReadToEnd()), "note") ?? note;
                }
                catch { }
                return false;
            }
        }
    }

}
