// Bridge Night Helper: the live status shared between the logic (Watcher, written on its timer thread)
// and the windows (HelperUi, read on the UI thread with a timer). Plain fields under one lock, C# 5.

using System;

namespace BridgeNight
{
    static class HelperStatus
    {
        static readonly object gate = new object();

        static bool leagueConnected;
        static string phase = "";
        static bool customGame;
        static bool? serverOk;           // null = not checked yet
        static DateTime? lastSentAt;     // local time
        static string lastSent = "";     // e.g. "Game result 7700002: result saved"
        static string lastError = "";
        static int queued;               // results waiting to be resent
        static string updateVersion = ""; // newer helper version on GitHub, "" = none

        public sealed class Snapshot
        {
            public bool LeagueConnected; public string Phase; public bool CustomGame; public bool? ServerOk;
            public DateTime? LastSentAt; public string LastSent; public string LastError; public int Queued; public string UpdateVersion;
        }

        public static Snapshot Read()
        {
            lock (gate)
            {
                return new Snapshot
                {
                    LeagueConnected = leagueConnected, Phase = phase, CustomGame = customGame, ServerOk = serverOk,
                    LastSentAt = lastSentAt, LastSent = lastSent, LastError = lastError, Queued = queued, UpdateVersion = updateVersion
                };
            }
        }

        public static void SetLeague(bool connected, string currentPhase, bool custom)
        {
            lock (gate) { leagueConnected = connected; phase = currentPhase ?? ""; customGame = custom; }
        }

        public static void SetSent(bool ok, string what)
        {
            lock (gate)
            {
                serverOk = ok;
                if (ok) { lastSentAt = DateTime.Now; lastSent = what ?? ""; lastError = ""; }
                else lastError = what ?? "";
            }
        }

        /// Result of the "hello" server check: changes only whether the server is reachable, not the last sent item.
        public static void SetServer(bool ok, string note)
        {
            lock (gate) { serverOk = ok; lastError = ok ? "" : note ?? ""; }
        }

        // The game's own live data (Live Client Data, custom games only, from the loading screen on), for the Live page.
        // The Watcher replaces the whole object each time, it never changes one in place, so readers can use it freely.
        static object game;
        static DateTime gameAt;

        public static void SetGame(object data) { lock (gate) { game = data; gameAt = DateTime.UtcNow; } }
        public static object Game(out DateTime readAt) { lock (gate) { readAt = gameAt; return game; } }

        public static void SetQueued(int n) { lock (gate) { queued = n; } }
        public static void SetUpdate(string version) { lock (gate) { updateVersion = version ?? ""; } }
    }
}
