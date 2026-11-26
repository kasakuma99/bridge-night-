// Sample data for the window previews only (render-0.7.ps1). Same names as helper/PcServices.cs, fixed numbers,
// never part of the real helper. Env vars: BN_FAKE_GAME=1 (in a game), BN_FAKE_MUTED=1, BN_FAKE_UPDATE=0.7.1.

using System;
using System.Collections.Generic;
using System.Linq;

namespace BridgeNight
{
    static class Fake
    {
        public static bool Env(string n) { return Environment.GetEnvironmentVariable(n) == "1"; }
        public static float Wave(int i, float mid, float amp, int seed) { return mid + amp * (float)(Math.Sin(i * .31 + seed) * .6 + Math.Sin(i * .07 + seed * 2) * .4); }

        public static PerfSample Sample(int i, bool game)
        {
            return new PerfSample
            {
                At = DateTime.Now.AddSeconds(i - 60), Cpu = Wave(i, game ? 48 : 24, game ? 16 : 6, 1), Gpu = game ? Math.Min(100, Wave(i, 88, 12, 2)) : Wave(i, 40, 8, 2),
                GpuTempC = game ? 72 : 61, MemUsedGb = game ? 13.4f + i % 7 * .1f : 10.1f, MemTotalGb = 16, VramUsedGb = game ? 6.4f : 3.2f, VramTotalGb = 12,
                CpuThreads = Enumerable.Range(0, 16).Select(k => (float)Math.Abs(Math.Sin(k * 1.7 + i)) * (k % 5 == 3 ? 63 : 30)).ToArray(),
                DiskReadMBs = 12, DiskWriteMBs = 3, NetDownMBs = .52f + (float)Math.Abs(Math.Sin(i * .4)) * .2f, NetUpMBs = .1f, MemCachedGb = 4.2f, MemFreeGb = 1.7f,
            };
        }
    }

    static class PcServices
    {
        public static void Start(Settings settings, Action<string> log) { }
        public static void Tick() { }
        public static void Stop() { }
        public static DateTime? GameStartedAt { get { return Fake.Env("BN_FAKE_GAME") ? (DateTime?)DateTime.Now.AddSeconds(-860) : null; } }
        public static event Action<string, string> Notify;
        static void Unused() { if (Notify != null) Notify("", ""); }
    }

    sealed class PerfSample
    {
        public DateTime At;
        public float? Cpu, Gpu;
        public float? GpuTempC;
        public float MemUsedGb, MemTotalGb;
        public float? VramUsedGb, VramTotalGb;
        public float[] CpuThreads;
        public float DiskReadMBs, DiskWriteMBs, NetDownMBs, NetUpMBs;
        public float MemCachedGb, MemFreeGb;
    }

    sealed class AppUse { public string Name; public float MemGb; public float CpuPercent; public bool CanClose; }
    sealed class StartupApp { public string Name; public string Where; }
    sealed class DriveUse { public string Name; public float FreeGb, TotalGb; }

    sealed class GameReport
    {
        public DateTime Start, End;
        public List<PerfSample> Samples = new List<PerfSample>();
        public float CpuAvg, CpuPeak, GpuAvg, GpuPeak, MemPeakGb, MemTotalGb;
        public float? VramPeakGb, GpuTempPeakC;
        public string Limit = "";
    }

    static class PerfMon
    {
        public static void Start(string who) { }
        public static void Stop(string who) { }
        static int interval = 1;
        public static int IntervalSeconds { get { return interval; } set { interval = value; } }
        public static PerfSample Latest { get { return Fake.Sample(60, Fake.Env("BN_FAKE_GAME")); } }
        public static List<PerfSample> History(int seconds) { return Enumerable.Range(0, 60).Select(i => Fake.Sample(i, false)).ToList(); }
        public static string Tip() { return "Chrome holds 2.1 GB: 13 % of your memory, more than League needs."; }
        public static List<AppUse> TopApps(int count)
        {
            return new List<AppUse>
            {
                new AppUse { Name = "Chrome", MemGb = 2.1f, CanClose = true }, new AppUse { Name = "Discord", MemGb = .64f },
                new AppUse { Name = "League client", MemGb = .56f }, new AppUse { Name = "Steam", MemGb = .41f, CanClose = true },
                new AppUse { Name = "Spotify", MemGb = .31f, CanClose = true }, new AppUse { Name = "Epic Games Launcher", MemGb = .22f, CanClose = true },
            }.Take(count).ToList();
        }
        public static bool CloseApp(string name) { return true; }
        public static List<StartupApp> StartupApps()
        {
            return new List<StartupApp> { new StartupApp { Name = "Steam", Where = "Your account" }, new StartupApp { Name = "Epic Games Launcher", Where = "Your account" },
                new StartupApp { Name = "Spotify", Where = "Your account" }, new StartupApp { Name = "Discord", Where = "Your account" }, new StartupApp { Name = "AMD Software", Where = "All users" } };
        }
        public static List<DriveUse> Drives()
        {
            return new List<DriveUse> { new DriveUse { Name = "C: Windows", FreeGb = 38, TotalGb = 476 }, new DriveUse { Name = "D: Games", FreeGb = 412, TotalGb = 931 } };
        }
        public static TimeSpan Uptime { get { return new TimeSpan(9, 4, 12, 0); } }
        public static bool RestartPending { get { return false; } }
        public static int? OpenApps { get { return 6; } }
        public static List<GameReport> LastGames()
        {
            var list = new List<GameReport>();
            float[] avg = { 86, 88, 79, 84, 81 };
            for (var k = 0; k < 5; k++)
            {
                var start = DateTime.Today.AddDays(-k * 2).AddHours(21).AddMinutes(14);
                var r = new GameReport { Start = start, End = start.AddMinutes(24.5), CpuAvg = 48, CpuPeak = 77, GpuAvg = avg[k], GpuPeak = 100, MemPeakGb = 14.7f, MemTotalGb = 16, VramPeakGb = 6.9f, GpuTempPeakC = 74,
                    Limit = "Your graphics card was the limit: above 95 % for 71 % of the game, while the processor had room. Capping League at 144 FPS keeps it cooler and quieter." };
                if (k == 0) r.Samples = Enumerable.Range(0, 150).Select(i => { var s = Fake.Sample(i, true); if (i < 8) s.Gpu = 20 + i * 8; return s; }).ToList();
                list.Add(r);
            }
            return list;
        }
    }

    sealed class NetReport { public int? PingMs, JitterMs; public float LossPercent; public string Verdict = ""; public bool Ok; }
    sealed class NetHop { public string Name; public int? Ms; public float LossPercent; }

    static class NetCheck
    {
        public const string ServerName = "EUW";
        public const string FastCaller = "network";
        public static string TargetName { get { return "Riot EUW"; } }
        public static void Start(string who) { }
        public static void Stop(string who) { }
        public static NetReport Current { get { return new NetReport { PingMs = 23, JitterMs = 3, LossPercent = 0, Verdict = "All good: your connection and EUW look fine", Ok = true }; } }
        public static List<KeyValuePair<DateTime, int?>> History(int seconds)
        {
            var n = Math.Min(seconds, 120);
            return Enumerable.Range(0, n).Select(i => new KeyValuePair<DateTime, int?>(DateTime.Now.AddSeconds((i - n) * seconds / (double)n),
                i == n * 2 / 5 ? 61 : i == n * 2 / 5 + 1 ? 40 : (int?)(22 + (int)(Math.Sin(i * .9) * 2)))).ToList();
        }
        public static void TraceNow() { }
        public static bool Tracing { get { return false; } }
        public static List<NetHop> Hops
        {
            get
            {
                return new List<NetHop> { new NetHop { Name = "This PC", Ms = 1 }, new NetHop { Name = "Your router", Ms = 2 },
                    new NetHop { Name = "Internet provider", Ms = 9 }, new NetHop { Name = "Riot EUW", Ms = 23 } };
            }
        }
    }

    sealed class PcCheck { public string Id = "", Title = "", Detail = ""; public bool Problem; public string FixLabel = ""; }

    static class GameMode
    {
        public static List<PcCheck> BeforeNight()
        {
            return new List<PcCheck> { new PcCheck { Id = "restart", Title = "Windows wants to restart", Detail = "Updates are waiting", Problem = true, FixLabel = "Restart now" },
                new PcCheck { Id = "league", Title = "League is up to date", Detail = "Patch 25.23" } };
        }
        public static List<PcCheck> Fixes()
        {
            return new List<PcCheck> { new PcCheck { Id = "hz", Title = "Monitor runs at 60 Hz", Detail = "LG UltraGear can do 165 Hz", Problem = true, FixLabel = "Set 165 Hz" },
                new PcCheck { Id = "mouse", Title = "Mouse acceleration is on", Detail = "\"Enhance pointer precision\"", Problem = true, FixLabel = "Turn off" },
                new PcCheck { Id = "sticky", Title = "Sticky Keys pop-up is off", Detail = "Shift 5x won't kick you out of a game" } };
        }
        public static bool Fix(string id, out string note) { note = "Done: switched off for your account."; return true; }
        public static bool Active { get { return Fake.Env("BN_FAKE_GAME"); } }
        public static string ActiveText { get { return "Music at 30 %"; } }
    }

    sealed class AudioDevice { public string Id, Name; public bool IsDefault; }

    static class AudioCtl
    {
        public static string MicName { get { return "HyperX Cloud II mic"; } }
        public static bool MicMuted { get { return Fake.Env("BN_FAKE_MUTED"); } }
        public static bool ToggleMic() { return false; }
        public static float MicLevel { get { return .55f; } }
        public static List<AudioDevice> Outputs()
        {
            return new List<AudioDevice> { new AudioDevice { Id = "1", Name = "Headset (HyperX Cloud II)", IsDefault = true },
                new AudioDevice { Id = "2", Name = "Speakers (Realtek Audio)" }, new AudioDevice { Id = "3", Name = "LG UltraGear (HDMI)" } };
        }
        public static string OutputName { get { return "Headset (HyperX Cloud II)"; } }
        public static bool SetOutput(string id) { return true; }
        public static bool NextOutput() { return true; }
        public static event Action Changed;
        static void Unused() { if (Changed != null) Changed(); }
    }

    static class Updater
    {
        public static string NewVersion { get { return Environment.GetEnvironmentVariable("BN_FAKE_UPDATE") ?? ""; } }
        public static string Notes { get { return ""; } }
        public static string State { get { return NewVersion != "" ? "Downloaded and checked" : "Up to date · checked 10 min ago"; } }
        public static void CheckNow() { }
        public static bool InstallNow(out string note) { note = ""; return false; }
        public static string WhatsNew { get { return ""; } }
        public static event Action Changed;
        static void Unused() { if (Changed != null) Changed(); }
    }
}
