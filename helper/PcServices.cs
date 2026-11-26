// Bridge Night Helper 0.7: the PC features behind the window (Performance, Network, Game mode, Audio, Updates).
// This file is the CONTRACT between the window (HelperUi.cs, Ui*.cs) and the features. The window only uses
// what is declared here. The bodies live in PcPerf.cs, PcNet.cs, PcGameMode.cs, PcAudio.cs, PcUpdater.cs
// (partial classes), but every public name and signature below stays as it is. No admin rights anywhere.
// Everything is safe to call on the UI thread: slow work runs on a background thread and the result is read
// from the properties. C# 5 only.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Threading;

namespace BridgeNight
{
    /* ------------------------------------------------------------------ the one entry point */

    static partial class PcServices
    {
        static Settings settings;
        static Action<string> logger;
        static SynchronizationContext ui;
        static DateTime? gameStartedAt;
        static DateTime nextGameCheck = DateTime.MinValue;
        static readonly Cached<bool> leagueRunning = new Cached<bool>("game check", 1, GameProcessRunning); // asked every 2 s
        static volatile bool gameRunning;
        // Break reminder: play time adds up over a session; a session ends after an hour without a game.
        static TimeSpan sessionPlay = TimeSpan.Zero;
        static DateTime lastGameEnd = DateTime.MinValue;
        static bool breakReminded;
        static int measureEvery; // Settings.MeasureEvery as last given to PerfMon

        /// Called once by TrayApp after the settings are loaded. Starts hotkeys (if on) and the update schedule.
        public static void Start(Settings settings, Action<string> log)
        {
            PcServices.settings = settings;
            logger = log;
            ui = SynchronizationContext.Current;
            if (ui == null && Thread.CurrentThread.GetApartmentState() == ApartmentState.STA) ui = new System.Windows.Forms.WindowsFormsSynchronizationContext();
            Safe("updater start", Updater.OnStart);
            Safe("hotkeys", AudioCtl.SyncHotkeys);
            Safe("perf preload", PerfMon.Preload);
        }

        /// Called by TrayApp every second on the UI thread. Notices game start/end (the "League of Legends" game
        /// process) and then: records the last-game report, applies/restores game mode, holds updates.
        public static void Tick()
        {
            if (settings == null) return;
            if (settings.MeasureEvery != measureEvery) PerfMon.IntervalSeconds = measureEvery = settings.MeasureEvery;
            Safe("hotkeys", AudioCtl.SyncHotkeys);
            Safe("update schedule", Updater.OnTick);
            var now = DateTime.Now;
            if (now < nextGameCheck) return;
            nextGameCheck = now.AddSeconds(2);
            bool running = leagueRunning.Get(); // the process list is read on a background thread, at most 2 s old
            if (running && !gameRunning) Safe("game start", OnGameStart);
            else if (!running && gameRunning) Safe("game end", delegate { OnGameEnd(true); });
            if (gameRunning && settings.BreakReminder && !breakReminded && gameStartedAt.HasValue
                && sessionPlay + (now - gameStartedAt.Value) >= TimeSpan.FromHours(2))
            {
                breakReminded = true;
                RaiseNotify("Time for a short break", "You have played for 2 hours. Stand up, drink some water and rest your eyes.");
            }
        }

        /// Called on exit: restores anything game mode changed, unregisters hotkeys, stops measuring.
        public static void Stop()
        {
            if (gameRunning) Safe("game end", delegate { OnGameEnd(false); });
            Safe("game mode restore", GameMode.Restore);
            Safe("hotkeys", AudioCtl.UnregisterHotkeys);
            Safe("perf stop", PerfMon.StopAll);
            Safe("net stop", NetCheck.StopAll);
        }

        /// Local time the current game started; null when no game is running.
        public static DateTime? GameStartedAt { get { return gameStartedAt; } }

        /// Raised (on the UI thread) for short pop-ups: game mode switched on, update installed, break reminder.
        public static event Action<string, string> Notify; // (title, text)

        /* ---- internals shared by the Pc*.cs files */

        internal static Settings Options { get { return settings; } }
        internal static bool GameRunning { get { return gameRunning; } }

        internal static void Log(string line)
        {
            var l = logger;
            if (l == null) return;
            try { l(Scrub(line)); } catch { }
        }

        static readonly Regex Ipv4 = new Regex(@"(?<![\d.])\d{1,3}(\.\d{1,3}){3}(?![\d.])");
        static readonly Regex Email = new Regex(@"[\w.+-]+@[\w-]+(\.[\w-]+)+");

        /// Log lines and error texts may be shared for help: nothing in them may point to this PC or person
        /// (user folder, Windows user and PC name, IP or email addresses; error messages often name file paths).
        internal static string Scrub(string text)
        {
            if (string.IsNullOrEmpty(text)) return text;
            try
            {
                var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                if (home.Length > 3) text = Regex.Replace(text, Regex.Escape(home), "%USERPROFILE%", RegexOptions.IgnoreCase);
                foreach (var name in new[] { Environment.UserName, Environment.MachineName })
                    if (!string.IsNullOrEmpty(name) && name.Length >= 3)
                        text = Regex.Replace(text, @"(?<![\w])" + Regex.Escape(name) + @"(?![\w])", "<private>", RegexOptions.IgnoreCase);
                text = Email.Replace(text, "<email>");
                return Ipv4.Replace(text, "<ip>");
            }
            catch { return text; }
        }

        /// Runs on the UI thread (the one that called Start); directly when there is none (tests).
        internal static void OnUi(Action a)
        {
            var c = ui;
            if (c == null) { Safe("ui", a); return; }
            c.Post(delegate { Safe("ui", a); }, null);
        }

        internal static void RaiseNotify(string title, string text)
        {
            OnUi(delegate { var n = Notify; if (n != null) n(title, text); });
        }

        internal static void Safe(string what, Action a)
        {
            try { a(); }
            catch (Exception e) { Log(what + " failed: " + e.Message); }
        }

        /// Starts a low-priority background thread that never takes the process down.
        internal static Thread Background(string name, Action a)
        {
            var t = new Thread(delegate() { Safe(name, a); });
            t.Name = name;
            t.IsBackground = true;
            t.Priority = ThreadPriority.BelowNormal;
            t.Start();
            return t;
        }

        static bool GameProcessRunning()
        {
            try
            {
                var ps = Process.GetProcessesByName("League of Legends");
                foreach (var p in ps) p.Dispose();
                return ps.Length > 0;
            }
            catch { return false; }
        }

        static void OnGameStart()
        {
            var now = DateTime.Now;
            if (now - lastGameEnd > TimeSpan.FromHours(1)) { sessionPlay = TimeSpan.Zero; breakReminded = false; }
            gameRunning = true;
            gameStartedAt = now;
            Log("Game started");
            if (settings.RecordLastGame) PerfMon.BeginRecording();
            if (settings.GameModeAuto && GameMode.Apply())
                RaiseNotify("Game mode on", GameMode.ActiveText);
        }

        static void OnGameEnd(bool allowUpdate)
        {
            var now = DateTime.Now;
            if (gameStartedAt.HasValue) sessionPlay += now - gameStartedAt.Value;
            gameRunning = false;
            gameStartedAt = null;
            lastGameEnd = now;
            Log("Game ended");
            PerfMon.EndRecording();
            GameMode.Restore();
            if (allowUpdate) Updater.OnGameEnded(); // not while the helper is closing
        }
    }

    /* ------------------------------------------------------------------ Performance */

    sealed class PerfSample
    {
        public DateTime At;
        public float? Cpu, Gpu;               // percent
        public float? GpuTempC;               // AMD driver; null when not available
        public float MemUsedGb, MemTotalGb;
        public float? VramUsedGb, VramTotalGb;
        public float[] CpuThreads;            // percent per logical processor (may be empty)
        public float DiskReadMBs, DiskWriteMBs, NetDownMBs, NetUpMBs;
        public float MemCachedGb, MemFreeGb;
    }

    sealed class AppUse { public string Name; public float MemGb; public float CpuPercent; public bool CanClose; }
    sealed class StartupApp { public string Name; public string Where; }          // read-only list
    sealed class DriveUse { public string Name; public float FreeGb, TotalGb; }

    sealed class GameReport
    {
        public DateTime Start, End;
        public List<PerfSample> Samples = new List<PerfSample>(); // thinned to at most ~300 points
        public float CpuAvg, CpuPeak, GpuAvg, GpuPeak, MemPeakGb, MemTotalGb;
        public float? VramPeakGb, GpuTempPeakC;
        public string Limit = "";     // plain words: what limited the PC ("Nothing: your PC had room to spare")
    }

    static partial class PerfMon
    {
        /// Live measuring for the open Performance page / Home tile. Start/Stop are reference counted per caller key.
        public static void Start(string who) { StartImpl(who); }
        public static void Stop(string who) { StopImpl(who); }
        public static int IntervalSeconds { get { return interval; } set { interval = value <= 1 ? 1 : value >= 5 ? 5 : 2; wake.Set(); } } // 1, 2 or 5

        public static PerfSample Latest { get { lock (gate) return history.Count == 0 ? null : history[history.Count - 1]; } }
        /// Samples of the last `seconds` seconds, oldest first.
        public static List<PerfSample> History(int seconds) { return HistoryImpl(seconds); }
        /// One plain-words hint about the latest sample, or null (e.g. "Chrome holds 2.1 GB").
        public static string Tip() { return TipImpl(); }

        /// The getters below return at once with the last result from a background thread (refreshed while they are
        /// called: apps every 3 s, open apps 5 s, startup apps and drives 30 s). Empty / null until the first is ready.
        /// Biggest apps by memory, at most 12, with CPU % since the previous refresh.
        public static List<AppUse> TopApps(int count) { return TopAppsImpl(count); }
        /// NEW in 0.7: apps with a window, like the taskbar (one per program, Windows' own parts left out); null until known.
        public static int? OpenApps { get { return OpenAppsImpl(); } }
        /// Asks the app to close (CloseMainWindow), never kills League or system processes. False if refused.
        public static bool CloseApp(string name) { return CloseAppImpl(name); }
        public static List<StartupApp> StartupApps() { return StartupAppsImpl(); }
        public static List<DriveUse> Drives() { return DrivesImpl(); }
        public static TimeSpan Uptime { get { return UptimeImpl(); } }
        public static bool RestartPending { get { return RestartPendingImpl(); } }

        /// Newest first, at most 5, kept in Settings.Dir\games.json.
        public static List<GameReport> LastGames() { return LastGamesImpl(); }
        public static int? OpenApps { get { return null; } } // stub: Agent D provides the real one
    }

    /* ------------------------------------------------------------------ Network */

    sealed class NetReport
    {
        public int? PingMs, JitterMs;
        public float LossPercent;
        public string Verdict = "";   // "All good", "Your Wi-Fi is dropping packets", ...
        public bool Ok;
    }

    sealed class NetHop { public string Name; public int? Ms; public float LossPercent; } // This PC, Your router, Internet provider, Riot EUW

    static partial class NetCheck
    {
        public const string ServerName = "EUW";
        /// Pings the EUW game server about once a second while started (reference counted like PerfMon).
        public static void Start(string who) { StartImpl(who); }
        public static void Stop(string who) { StopImpl(who); }
        public static NetReport Current { get { return CurrentImpl(); } }
        /// NEW in 0.7 (not in the first contract): what is pinged right now, "Riot EUW" or the Amsterdam fallback.
        public static string TargetName { get { return activeName; } }
        /// (time, ping ms or null for lost) of the last `seconds` seconds, oldest first.
        public static List<KeyValuePair<DateTime, int?>> History(int seconds) { return HistoryImpl(seconds); }
        /// Where the time goes. Starts a background trace; returns the last finished result (empty until then).
        public static void TraceNow() { TraceNowImpl(); }
        public static bool Tracing { get { return tracing; } }
        public static List<NetHop> Hops { get { lock (gate) return new List<NetHop>(hops); } }
    }

    /* ------------------------------------------------------------------ Game mode */

    sealed class PcCheck
    {
        public string Id = "", Title = "", Detail = "";
        public bool Problem;
        public string FixLabel = "";  // "" = nothing to click (info only)
    }

    static partial class GameMode
    {
        /// Before game night: pending Windows restart, League version.
        public static List<PcCheck> BeforeNight() { return BeforeNightImpl(); }
        /// Gamer fixes: monitor below its best refresh rate, mouse acceleration on, Sticky Keys pop-up on.
        public static List<PcCheck> Fixes() { return FixesImpl(); }
        /// Applies one fix for this Windows user only. Never needs admin. note = what happened, in plain words.
        public static bool Fix(string id, out string note) { return FixImpl(id, out note); }
        public static bool Active { get { return ActiveImpl(); } }       // game mode currently applied
        public static string ActiveText { get { return ActiveTextImpl(); } }    // "Music at 30 %"
    }

    /* ------------------------------------------------------------------ Audio */

    sealed class AudioDevice { public string Id, Name; public bool IsDefault; }

    static partial class AudioCtl
    {
        /// Default recording device (the mic). Muting is done in Windows, so every app goes quiet.
        public static string MicName { get { return MicNameImpl(); } }
        public static bool MicMuted { get { return MicMutedImpl(); } }
        public static bool ToggleMic() { return ToggleMicImpl(); }   // returns the new muted state
        public static float MicLevel { get { return MicLevelImpl(); } } // 0..1 peak, for the small meter

        public static List<AudioDevice> Outputs() { return OutputsImpl(); }
        public static string OutputName { get { return OutputNameImpl(); } }
        public static bool SetOutput(string id) { return SetOutputImpl(id); }
        public static bool NextOutput() { return NextOutputImpl(); }   // cycles headset/speakers/monitor (Ctrl+Alt+H)

        /// Raised on the UI thread after mute or output changed (also by hotkey).
        public static event Action Changed;
        static void RaiseChanged() { PcServices.OnUi(delegate { var c = Changed; if (c != null) c(); }); }
    }

    /* ------------------------------------------------------------------ Updates */

    static partial class Updater
    {
        /// Newer version on GitHub ("0.7.1"), or "" if none / not checked.
        public static string NewVersion { get { lock (gate) return newVersion; } }
        public static string Notes { get { lock (gate) return notes; } }   // release notes of NewVersion, plain text
        public static string State { get { return StateImpl(); } }   // "Up to date · checked 2 min ago", "Downloading", "Waiting for the game to end"
        public static void CheckNow() { CheckNowImpl(); }                    // background check of the GitHub releases
        /// Downloads, checks the SHA-256 against the release, swaps the exe and restarts. Refuses during a game.
        public static bool InstallNow(out string note) { return InstallNowImpl(out note); }
        /// After an update restart: the plain-text "what changed" of the running version, else "".
        public static string WhatsNew { get { return WhatsNewImpl(); } }
        public static event Action Changed;
        static void RaiseChanged() { PcServices.OnUi(delegate { var c = Changed; if (c != null) c(); }); }
    }
}
