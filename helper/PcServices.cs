// Bridge Night Helper 0.7: the PC features behind the window (Performance, Network, Game mode, Audio, Updates).
// This file is the CONTRACT between the window (HelperUi.cs, Ui*.cs) and the features. The window only uses
// what is declared here. The bodies may live in other files (partial classes or helpers), but every public
// name and signature below stays as it is. No admin rights anywhere. Everything is safe to call on the UI
// thread: slow work runs on a background thread and the result is read from the properties. C# 5 only.

using System;
using System.Collections.Generic;

namespace BridgeNight
{
    /* ------------------------------------------------------------------ the one entry point */

    static class PcServices
    {
        /// Called once by TrayApp after the settings are loaded. Starts hotkeys (if on) and the update schedule.
        public static void Start(Settings settings, Action<string> log) { }

        /// Called by TrayApp every second on the UI thread. Notices game start/end from HelperStatus.Read().Phase
        /// ("InProgress" etc.) and then: records the last-game report, applies/restores game mode, holds updates.
        public static void Tick() { }

        /// Called on exit: restores anything game mode changed, unregisters hotkeys, stops measuring.
        public static void Stop() { }

        /// Local time the current game started; null when no game is running.
        public static DateTime? GameStartedAt { get { return null; } }

        /// Raised (on the UI thread) for short pop-ups: game mode switched on, update installed, break reminder.
        public static event Action<string, string> Notify; // (title, text)

        static void Unused() { if (Notify != null) Notify("", ""); }
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

    static class PerfMon
    {
        /// Live measuring for the open Performance page / Home tile. Start/Stop are reference counted per caller key.
        public static void Start(string who) { }
        public static void Stop(string who) { }
        public static int IntervalSeconds { get { return 5; } set { } } // 1, 5 or 10

        public static PerfSample Latest { get { return null; } }
        /// Samples of the last `seconds` seconds, oldest first.
        public static List<PerfSample> History(int seconds) { return new List<PerfSample>(); }
        /// One plain-words hint about the latest sample, or null (e.g. "Chrome holds 2.1 GB").
        public static string Tip() { return null; }

        public static List<AppUse> TopApps(int count) { return new List<AppUse>(); }
        /// Asks the app to close (CloseMainWindow), never kills League or system processes. False if refused.
        public static bool CloseApp(string name) { return false; }
        public static List<StartupApp> StartupApps() { return new List<StartupApp>(); }
        public static List<DriveUse> Drives() { return new List<DriveUse>(); }
        public static TimeSpan Uptime { get { return TimeSpan.Zero; } }
        public static bool RestartPending { get { return false; } }

        /// Newest first, at most 5, kept in Settings.Dir\games.json.
        public static List<GameReport> LastGames() { return new List<GameReport>(); }
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

    static class NetCheck
    {
        public const string ServerName = "EUW";
        /// Pings the EUW game server about once a second while started (reference counted like PerfMon).
        public static void Start(string who) { }
        public static void Stop(string who) { }
        public static NetReport Current { get { return new NetReport(); } }
        /// (time, ping ms or null for lost) of the last `seconds` seconds, oldest first.
        public static List<KeyValuePair<DateTime, int?>> History(int seconds) { return new List<KeyValuePair<DateTime, int?>>(); }
        /// Where the time goes. Starts a background trace; returns the last finished result (empty until then).
        public static void TraceNow() { }
        public static bool Tracing { get { return false; } }
        public static List<NetHop> Hops { get { return new List<NetHop>(); } }
    }

    /* ------------------------------------------------------------------ Game mode */

    sealed class PcCheck
    {
        public string Id = "", Title = "", Detail = "";
        public bool Problem;
        public string FixLabel = "";  // "" = nothing to click (info only)
    }

    static class GameMode
    {
        /// Before game night: pending Windows restart, League version.
        public static List<PcCheck> BeforeNight() { return new List<PcCheck>(); }
        /// Gamer fixes: monitor below its best refresh rate, mouse acceleration on, Sticky Keys pop-up on.
        public static List<PcCheck> Fixes() { return new List<PcCheck>(); }
        /// Applies one fix for this Windows user only. Never needs admin. note = what happened, in plain words.
        public static bool Fix(string id, out string note) { note = ""; return false; }
        public static bool Active { get { return false; } }       // game mode currently applied
        public static string ActiveText { get { return ""; } }    // "High performance plan, music at 30 %"
    }

    /* ------------------------------------------------------------------ Audio */

    sealed class AudioDevice { public string Id, Name; public bool IsDefault; }

    static class AudioCtl
    {
        /// Default recording device (the mic). Muting is done in Windows, so every app goes quiet.
        public static string MicName { get { return ""; } }
        public static bool MicMuted { get { return false; } }
        public static bool ToggleMic() { return false; }   // returns the new muted state
        public static float MicLevel { get { return 0; } } // 0..1 peak, for the small meter

        public static List<AudioDevice> Outputs() { return new List<AudioDevice>(); }
        public static string OutputName { get { return ""; } }
        public static bool SetOutput(string id) { return false; }
        public static bool NextOutput() { return false; }   // cycles headset/speakers/monitor (Ctrl+Alt+H)

        /// Raised on the UI thread after mute or output changed (also by hotkey).
        public static event Action Changed;
        static void Unused() { if (Changed != null) Changed(); }
    }

    /* ------------------------------------------------------------------ Updates */

    static class Updater
    {
        /// Newer version on GitHub ("0.7.1"), or "" if none / not checked.
        public static string NewVersion { get { return ""; } }
        public static string Notes { get { return ""; } }   // release notes of NewVersion, plain text
        public static string State { get { return ""; } }   // "Up to date · checked 2 min ago", "Downloading", "Waiting for the game to end"
        public static void CheckNow() { }                    // background check of the GitHub releases
        /// Downloads, checks the SHA-256 against the release, swaps the exe and restarts. Refuses during a game.
        public static bool InstallNow(out string note) { note = ""; return false; }
        /// After an update restart: the plain-text "what changed" of the running version, else "".
        public static string WhatsNew { get { return ""; } }
        public static event Action Changed;
        static void Unused() { if (Changed != null) Changed(); }
    }
}
