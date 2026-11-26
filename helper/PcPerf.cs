// Bridge Night Helper: Performance page. One background sampler that only runs while the page (or another
// caller) has called PerfMon.Start, or while a game is being recorded. Read-only, no admin rights, and
// language-neutral (no translated performance counter names except the GPU ones HwMonitor already uses).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Management;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace BridgeNight
{
    static partial class PerfMon
    {
        static readonly object gate = new object();
        static readonly List<PerfSample> history = new List<PerfSample>();
        static readonly Dictionary<string, int> users = new Dictionary<string, int>();
        static readonly AutoResetEvent wake = new AutoResetEvent(false);
        static int interval = 1;
        static Thread sampler;
        static bool recording;
        static List<PerfSample> recorded;
        static DateTime recordStart, lastRecorded;
        static readonly TimeSpan Keep = TimeSpan.FromMinutes(10);
        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        static void StartImpl(string who)
        {
            lock (gate)
            {
                int n;
                users.TryGetValue(who ?? "", out n);
                users[who ?? ""] = n + 1;
                EnsureSampler();
            }
        }

        static void StopImpl(string who)
        {
            lock (gate)
            {
                int n;
                if (!users.TryGetValue(who ?? "", out n)) return;
                if (n <= 1) users.Remove(who ?? ""); else users[who ?? ""] = n - 1;
            }
            wake.Set(); // lets the sampler notice it can stop
        }

        internal static void StopAll()
        {
            lock (gate) { users.Clear(); recording = false; }
            wake.Set();
        }

        internal static void BeginRecording()
        {
            lock (gate)
            {
                recording = true;
                recorded = new List<PerfSample>();
                recordStart = DateTime.Now;
                lastRecorded = DateTime.MinValue;
                EnsureSampler();
            }
        }

        /// Ends the recording and saves the report (background thread, the file write is small).
        internal static void EndRecording()
        {
            List<PerfSample> samples;
            DateTime start;
            lock (gate)
            {
                if (!recording) return;
                recording = false;
                samples = recorded;
                start = recordStart;
                recorded = null;
            }
            wake.Set();
            var end = DateTime.Now;
            if (samples == null || samples.Count < 2) return;
            PcServices.Background("save game report", delegate { SaveReport(BuildReport(samples, start, end)); });
        }

        static void EnsureSampler()
        {
            if (sampler != null) return;
            sampler = PcServices.Background("perf sampler", Sample);
        }

        static void Sample()
        {
            var hw = new HwReader();
            var probe = new PerfProbe();
            try
            {
                hw.CpuPercent();
                hw.GpuPercent(); // both are "since the last call": prime them so the first sample has values
                probe.Prime();
                wake.WaitOne(1000);
                while (true)
                {
                    int period;
                    lock (gate)
                    {
                        bool live = users.Count > 0;
                        if (!live && !recording) return;
                        period = live ? interval : 5;
                    }
                    var took = Stopwatch.StartNew();
                    var s = probe.Read(hw);
                    lock (gate)
                    {
                        history.Add(s);
                        while (history.Count > 0 && s.At - history[0].At > Keep) history.RemoveAt(0);
                        if (recording && (s.At - lastRecorded).TotalSeconds >= 4.5 && recorded.Count < 5000)
                        {
                            recorded.Add(s);
                            lastRecorded = s.At;
                        }
                    }
                    // Keep a steady beat: a reading takes ~200 ms (WMI), so wait only for the rest of the period.
                    wake.WaitOne(Math.Max(50, period * 1000 - (int)took.ElapsedMilliseconds));
                }
            }
            finally
            {
                hw.Reset();
                probe.Dispose();
                lock (gate)
                {
                    if (sampler == Thread.CurrentThread) sampler = null;
                    if (users.Count > 0 || recording) EnsureSampler(); // someone started while this one was stopping
                }
            }
        }

        static List<PerfSample> HistoryImpl(int seconds)
        {
            var from = DateTime.Now.AddSeconds(-seconds);
            var list = new List<PerfSample>();
            lock (gate) foreach (var s in history) if (s.At >= from) list.Add(s);
            return list;
        }

        /* ---- tip */

        static string bigName;
        static float bigGb;
        static DateTime bigAt = DateTime.MinValue;

        static string TipImpl()
        {
            var s = Latest;
            if (s == null) return null;
            try
            {
                if (s.MemTotalGb > 0 && s.MemUsedGb / s.MemTotalGb >= 0.85f && DateTime.Now - bigAt > TimeSpan.FromSeconds(30))
                {
                    var top = apps.Get(); // sorted by memory; filled in the background
                    if (top != null)
                    {
                        bigAt = DateTime.Now;
                        bigName = top.Count > 0 ? top[0].Name : null;
                        bigGb = top.Count > 0 ? top[0].MemGb : 0;
                    }
                }
            }
            catch { }
            return TipText(s, bigName, bigGb);
        }

        internal static string TipText(PerfSample s, string biggestApp, float biggestGb)
        {
            if (s == null) return null;
            if (s.MemTotalGb > 0 && s.MemUsedGb / s.MemTotalGb >= 0.85f)
                return biggestApp != null
                    ? "Memory is almost full: " + biggestApp + " holds " + biggestGb.ToString("0.0", Inv) + " GB"
                    : "Memory is almost full. Close apps you don't need.";
            if (s.GpuTempC >= 85)
                return "The graphics card is hot (" + s.GpuTempC.Value.ToString("0", Inv) + " °C). Check that its fans are free of dust.";
            if (s.Cpu >= 90) return "The processor is at its limit. Close apps you don't need before the game.";
            if (s.Gpu >= 95) return "The graphics card is at its limit. Lower the graphics settings or cap the FPS.";
            if (s.VramTotalGb > 0 && s.VramUsedGb / s.VramTotalGb >= 0.9f) return "Video memory is almost full. Lower the texture quality in League.";
            return null;
        }

        /* ---- last game */

        internal static List<PerfSample> Thin(List<PerfSample> s, int max)
        {
            if (s.Count <= max || max < 2) return new List<PerfSample>(s);
            var r = new List<PerfSample>(max);
            for (int i = 0; i < max; i++) r.Add(s[(int)((long)i * (s.Count - 1) / (max - 1))]);
            return r;
        }

        internal static string LimitText(List<PerfSample> s, float memTotalGb)
        {
            int n = 0, cpuHigh = 0, gpuHigh = 0;
            float memPeak = 0;
            foreach (var p in s)
            {
                if (p.MemUsedGb > memPeak) memPeak = p.MemUsedGb;
                if (!p.Cpu.HasValue && !p.Gpu.HasValue) continue;
                n++;
                float thread = 0;
                if (p.CpuThreads != null) foreach (var t in p.CpuThreads) if (t > thread) thread = t;
                if (p.Cpu >= 90 || thread >= 95) cpuHigh++;
                if (p.Gpu >= 95) gpuHigh++;
            }
            if (memTotalGb > 0 && memPeak / memTotalGb >= 0.92f)
                return "Memory full: Windows had to make room. Close apps before the game.";
            if (n == 0) return "Not enough data";
            float c = (float)cpuHigh / n, g = (float)gpuHigh / n;
            if (g >= 0.25f && g >= c) return "GPU-bound: the graphics card was the limit. Lower the graphics settings or cap the FPS.";
            if (c >= 0.25f) return "CPU-bound: the processor was the limit. Close apps running in the background.";
            return "Nothing: your PC had room to spare";
        }

        internal static GameReport BuildReport(List<PerfSample> s, DateTime start, DateTime end)
        {
            var r = new GameReport { Start = start, End = end };
            double cpuSum = 0, gpuSum = 0;
            int cpuN = 0, gpuN = 0;
            foreach (var p in s)
            {
                if (p.Cpu.HasValue) { cpuSum += p.Cpu.Value; cpuN++; if (p.Cpu > r.CpuPeak) r.CpuPeak = p.Cpu.Value; }
                if (p.Gpu.HasValue) { gpuSum += p.Gpu.Value; gpuN++; if (p.Gpu > r.GpuPeak) r.GpuPeak = p.Gpu.Value; }
                if (p.MemUsedGb > r.MemPeakGb) r.MemPeakGb = p.MemUsedGb;
                if (p.MemTotalGb > 0) r.MemTotalGb = p.MemTotalGb;
                if (p.VramUsedGb.HasValue && (!r.VramPeakGb.HasValue || p.VramUsedGb > r.VramPeakGb)) r.VramPeakGb = p.VramUsedGb;
                if (p.GpuTempC.HasValue && (!r.GpuTempPeakC.HasValue || p.GpuTempC > r.GpuTempPeakC)) r.GpuTempPeakC = p.GpuTempC;
            }
            r.CpuAvg = cpuN == 0 ? 0 : (float)(cpuSum / cpuN);
            r.GpuAvg = gpuN == 0 ? 0 : (float)(gpuSum / gpuN);
            r.Limit = LimitText(s, r.MemTotalGb);
            r.Samples = Thin(s, 300);
            return r;
        }

        static readonly object fileGate = new object();
        static string GamesFile { get { return Path.Combine(Settings.Dir, "games.json"); } }

        static List<GameReport> games; // games.json in memory, newest first; read once, then kept in step by SaveReport

        static void SaveReport(GameReport r)
        {
            lock (fileGate)
            {
                var list = Games();
                list.Insert(0, r);
                if (list.Count > 5) list.RemoveRange(5, list.Count - 5);
                var arr = new List<object>();
                foreach (var g in list) arr.Add(ToJson(g));
                Directory.CreateDirectory(Settings.Dir);
                File.WriteAllText(GamesFile, Json.Write(arr), Encoding.UTF8);
            }
            PcServices.Log("Saved the performance report of the game: " + r.Limit);
        }

        /// A copy, so the window can keep it. PcServices.Start reads the file in the background first.
        static List<GameReport> LastGamesImpl() { lock (fileGate) return new List<GameReport>(Games()); }

        static List<GameReport> Games() // caller holds fileGate
        {
            if (games != null) return games;
            games = new List<GameReport>();
            try
            {
                if (!File.Exists(GamesFile)) return games;
                var arr = Json.Parse(File.ReadAllText(GamesFile, Encoding.UTF8)) as object[];
                if (arr == null) return games;
                foreach (var o in arr) { var g = FromJson(o); if (g != null) games.Add(g); }
            }
            catch (Exception e) { PcServices.Log("Could not read games.json: " + e.Message); }
            return games;
        }

        /// Called once by PcServices.Start: fills the caches on background threads, so the first page has data.
        internal static void Preload()
        {
            PcServices.Background("read games", delegate { LastGamesImpl(); });
            startup.Get();
            drives.Get();
        }

        /* ---- caches for the window: the getters return at once, the work runs on a background thread */

        static readonly Cached<List<AppUse>> apps = new Cached<List<AppUse>>("list apps", 3, delegate
        {
            var l = Group(true, AppsKept); // CPU % since the previous refresh
            if (l.Count > AppsKept) l.RemoveRange(AppsKept, l.Count - AppsKept);
            return l;
        });
        static readonly Cached<int?> openApps = new Cached<int?>("count open apps", 5, CountOpenApps);
        static readonly Cached<List<StartupApp>> startup = new Cached<List<StartupApp>>("startup apps", 30, StartupAppsRead);
        static readonly Cached<List<DriveUse>> drives = new Cached<List<DriveUse>>("drives", 30, DrivesRead);
        const int AppsKept = 12;

        static int? OpenAppsImpl() { return openApps.Get(); }

        static readonly HashSet<string> WindowsParts = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { "ApplicationFrameHost", "TextInputHost", "ShellExperienceHost", "StartMenuExperienceHost", "SearchHost", "explorer" };

        /// Apps with a window, like the taskbar shows; not the 300+ background processes Windows always runs.
        static int? CountOpenApps()
        {
            var windows = PcNative.MainWindows();
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var p in Process.GetProcesses())
                using (p)
                {
                    bool titled;
                    if (windows.TryGetValue(p.Id, out titled) && titled && !WindowsParts.Contains(p.ProcessName)) names.Add(p.ProcessName);
                }
            return names.Count;
        }

        // Saved samples leave out the per-thread values to keep the file small.
        static Dictionary<string, object> ToJson(GameReport g)
        {
            var d = new Dictionary<string, object>();
            d["start"] = g.Start.ToString("o", Inv);
            d["end"] = g.End.ToString("o", Inv);
            d["cpuAvg"] = g.CpuAvg; d["cpuPeak"] = g.CpuPeak; d["gpuAvg"] = g.GpuAvg; d["gpuPeak"] = g.GpuPeak;
            d["memPeak"] = g.MemPeakGb; d["memTotal"] = g.MemTotalGb; d["vramPeak"] = g.VramPeakGb; d["tempPeak"] = g.GpuTempPeakC;
            d["limit"] = g.Limit;
            var ss = new List<object>();
            foreach (var s in g.Samples)
            {
                var x = new Dictionary<string, object>();
                x["t"] = s.At.ToString("o", Inv);
                x["c"] = s.Cpu; x["g"] = s.Gpu; x["gt"] = s.GpuTempC; x["mu"] = s.MemUsedGb; x["mt"] = s.MemTotalGb;
                x["vu"] = s.VramUsedGb; x["vt"] = s.VramTotalGb; x["dr"] = s.DiskReadMBs; x["dw"] = s.DiskWriteMBs;
                x["nd"] = s.NetDownMBs; x["nu"] = s.NetUpMBs; x["mc"] = s.MemCachedGb; x["mf"] = s.MemFreeGb;
                ss.Add(x);
            }
            d["samples"] = ss;
            return d;
        }

        static GameReport FromJson(object o)
        {
            try
            {
                var g = new GameReport
                {
                    Start = Time(Json.Str(o, "start")), End = Time(Json.Str(o, "end")),
                    CpuAvg = F(o, "cpuAvg") ?? 0, CpuPeak = F(o, "cpuPeak") ?? 0, GpuAvg = F(o, "gpuAvg") ?? 0, GpuPeak = F(o, "gpuPeak") ?? 0,
                    MemPeakGb = F(o, "memPeak") ?? 0, MemTotalGb = F(o, "memTotal") ?? 0, VramPeakGb = F(o, "vramPeak"), GpuTempPeakC = F(o, "tempPeak"),
                    Limit = Json.Str(o, "limit") ?? ""
                };
                var ss = Json.List(o, "samples");
                if (ss != null)
                    foreach (var x in ss)
                        g.Samples.Add(new PerfSample
                        {
                            At = Time(Json.Str(x, "t")), Cpu = F(x, "c"), Gpu = F(x, "g"), GpuTempC = F(x, "gt"),
                            MemUsedGb = F(x, "mu") ?? 0, MemTotalGb = F(x, "mt") ?? 0, VramUsedGb = F(x, "vu"), VramTotalGb = F(x, "vt"),
                            DiskReadMBs = F(x, "dr") ?? 0, DiskWriteMBs = F(x, "dw") ?? 0, NetDownMBs = F(x, "nd") ?? 0, NetUpMBs = F(x, "nu") ?? 0,
                            MemCachedGb = F(x, "mc") ?? 0, MemFreeGb = F(x, "mf") ?? 0, CpuThreads = new float[0]
                        });
                return g;
            }
            catch { return null; }
        }

        static DateTime Time(string s) { return DateTime.Parse(s, Inv, DateTimeStyles.RoundtripKind); }
        static float? F(object o, string key)
        {
            var v = Json.Get(o, key);
            if (v == null) return null;
            try { return Convert.ToSingle(v, Inv); } catch { return null; }
        }

        /* ---- apps */

        // Never offered a Close button: League/Riot/Vanguard, Windows itself, and this helper.
        static readonly HashSet<string> Protected = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "League of Legends", "LeagueClient", "LeagueClientUx", "LeagueClientUxRender", "LeagueCrashHandler", "LeagueCrashHandler64",
            "RiotClientServices", "RiotClientUx", "RiotClientUxRender", "RiotClientCrashHandler", "Riot Client", "vgc", "vgtray", "vgk",
            "Idle", "System", "Registry", "Memory Compression", "smss", "csrss", "wininit", "winlogon", "services", "lsass", "LsaIso",
            "svchost", "dwm", "explorer", "fontdrvhost", "sihost", "ctfmon", "RuntimeBroker", "ShellExperienceHost", "ShellHost",
            "StartMenuExperienceHost", "SearchHost", "SearchIndexer", "TextInputHost", "audiodg", "spoolsv", "MsMpEng", "NisSrv",
            "SecurityHealthService", "SecurityHealthSystray", "conhost", "dllhost", "taskhostw", "WmiPrvSE", "smartscreen",
            "ApplicationFrameHost", "SystemSettings", "Widgets", "WidgetService", "LockApp", "UserOOBEBroker", "CompPkgSrv", "WUDFHost"
        };

        static bool IsProtected(string name)
        {
            if (Protected.Contains(name)) return true;
            if (selfName == null)
                try { using (var me = Process.GetCurrentProcess()) selfName = me.ProcessName; } // ProcessName reads all processes: once
                catch { return true; }
            return string.Equals(name, selfName, StringComparison.OrdinalIgnoreCase);
        }

        static string selfName;
        static int session = -1;

        static Dictionary<int, TimeSpan> lastCpu;
        static DateTime lastCpuAt;

        sealed class Agg { public string Name; public long Mem; public double CpuMs; public List<Process> Procs = new List<Process>(); }

        /// Groups all processes by name. withCpu: CPU % since the previous call (0 on the first call).
        static List<AppUse> Group(bool withCpu, int closeCheckCount = 0)
        {
            var all = Process.GetProcesses();
            var groups = new Dictionary<string, Agg>(StringComparer.OrdinalIgnoreCase);
            var cpuNow = new Dictionary<int, TimeSpan>();
            var now = DateTime.UtcNow;
            if (session < 0)
                try { using (var me = Process.GetCurrentProcess()) session = me.SessionId; } catch { session = 0; } // once, it never changes
            try
            {
                foreach (var p in all)
                {
                    try
                    {
                        if (p.Id == 0) continue;
                        Agg a;
                        if (!groups.TryGetValue(p.ProcessName, out a)) groups[p.ProcessName] = a = new Agg { Name = p.ProcessName };
                        a.Mem += p.WorkingSet64;
                        if (p.SessionId == session) a.Procs.Add(p);
                        if (!withCpu) continue;
                        TimeSpan t, prev;
                        try { t = p.TotalProcessorTime; } catch { continue; } // other users' and protected processes
                        cpuNow[p.Id] = t;
                        if (lastCpu != null && lastCpu.TryGetValue(p.Id, out prev) && t >= prev) a.CpuMs += (t - prev).TotalMilliseconds;
                    }
                    catch { }
                }
                double elapsedMs = withCpu && lastCpu != null ? (now - lastCpuAt).TotalMilliseconds * Environment.ProcessorCount : 0;
                if (withCpu) { lastCpu = cpuNow; lastCpuAt = now; }
                var list = new List<Agg>(groups.Values);
                list.Sort(delegate(Agg x, Agg y) { return y.Mem.CompareTo(x.Mem); });
                var result = new List<AppUse>();
                var windows = closeCheckCount > 0 ? PcNative.MainWindows() : null;
                for (int i = 0; i < list.Count; i++)
                {
                    var a = list[i];
                    var u = new AppUse { Name = a.Name, MemGb = a.Mem / PcNative.Gb };
                    if (elapsedMs > 0) u.CpuPercent = (float)Math.Min(100, 100 * a.CpuMs / elapsedMs);
                    if (i < closeCheckCount && !IsProtected(a.Name))
                        foreach (var p in a.Procs) if (windows.ContainsKey(p.Id)) { u.CanClose = true; break; }
                    result.Add(u);
                }
                return result;
            }
            finally { foreach (var p in all) p.Dispose(); }
        }

        /// The last list from the background (empty until the first one is ready), at most `count` apps.
        static List<AppUse> TopAppsImpl(int count)
        {
            var all = apps.Get();
            if (all == null) return new List<AppUse>();
            return all.GetRange(0, Math.Max(0, Math.Min(count, all.Count)));
        }

        static bool CloseAppImpl(string name)
        {
            if (string.IsNullOrEmpty(name) || IsProtected(name)) return false;
            bool asked = false;
            try
            {
                int session;
                using (var me = Process.GetCurrentProcess()) session = me.SessionId;
                foreach (var p in Process.GetProcessesByName(name))
                {
                    try { if (p.SessionId == session && p.MainWindowHandle != IntPtr.Zero && p.CloseMainWindow()) asked = true; }
                    catch { }
                    finally { p.Dispose(); }
                }
            }
            catch (Exception e) { PcServices.Log("Could not close " + name + ": " + e.Message); }
            PcServices.Log(asked ? "Asked " + name + " to close" : name + " has no window to close");
            return asked;
        }

        static List<StartupApp> StartupAppsImpl() { var l = startup.Get(); return l == null ? new List<StartupApp>() : new List<StartupApp>(l); }
        static List<DriveUse> DrivesImpl() { var l = drives.Get(); return l == null ? new List<DriveUse>() : new List<DriveUse>(l); }

        static List<StartupApp> StartupAppsRead()
        {
            var list = new List<StartupApp>();
            const string run = @"Software\Microsoft\Windows\CurrentVersion\Run";
            const string approved = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\";
            AddRun(list, Registry.CurrentUser, run, approved + "Run", "Your account");
            AddRun(list, Registry.LocalMachine, run, approved + "Run", "All users");
            AddRun(list, Registry.LocalMachine, @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run", approved + "Run32", "All users");
            AddFolder(list, Environment.SpecialFolder.Startup, Registry.CurrentUser, "Startup folder");
            AddFolder(list, Environment.SpecialFolder.CommonStartup, Registry.LocalMachine, "Startup folder (all users)");
            return list;
        }

        /// Task Manager's "Disabled" lives in StartupApproved: first byte odd = disabled.
        static bool Disabled(RegistryKey root, string approvedKey, string name)
        {
            try
            {
                using (var k = root.OpenSubKey(approvedKey))
                {
                    var b = k == null ? null : k.GetValue(name) as byte[];
                    return b != null && b.Length > 0 && (b[0] & 1) == 1;
                }
            }
            catch { return false; }
        }

        static void AddRun(List<StartupApp> list, RegistryKey root, string key, string approvedKey, string where)
        {
            try
            {
                using (var k = root.OpenSubKey(key))
                {
                    if (k == null) return;
                    foreach (var n in k.GetValueNames())
                        if (n != "" && !Disabled(root, approvedKey, n)) list.Add(new StartupApp { Name = n, Where = where });
                }
            }
            catch (Exception e) { PcServices.Log("Could not read startup apps (" + where + "): " + e.Message); }
        }

        static void AddFolder(List<StartupApp> list, Environment.SpecialFolder folder, RegistryKey root, string where)
        {
            try
            {
                var dir = Environment.GetFolderPath(folder);
                if (dir == "" || !Directory.Exists(dir)) return;
                foreach (var f in Directory.GetFiles(dir))
                {
                    var file = Path.GetFileName(f);
                    if (file.Equals("desktop.ini", StringComparison.OrdinalIgnoreCase)) continue;
                    if (Disabled(root, @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder", file)) continue;
                    list.Add(new StartupApp { Name = Path.GetFileNameWithoutExtension(f), Where = where });
                }
            }
            catch (Exception e) { PcServices.Log("Could not read the startup folder: " + e.Message); }
        }

        static List<DriveUse> DrivesRead()
        {
            var list = new List<DriveUse>();
            try
            {
                foreach (var d in DriveInfo.GetDrives())
                {
                    try
                    {
                        if (d.DriveType != DriveType.Fixed || !d.IsReady) continue;
                        list.Add(new DriveUse { Name = d.Name.TrimEnd('\\'), FreeGb = d.AvailableFreeSpace / PcNative.Gb, TotalGb = d.TotalSize / PcNative.Gb });
                    }
                    catch { }
                }
            }
            catch (Exception e) { PcServices.Log("Could not list drives: " + e.Message); }
            return list;
        }

        static TimeSpan UptimeImpl()
        {
            try { return TimeSpan.FromMilliseconds(PcNative.GetTickCount64()); } catch { return TimeSpan.Zero; }
        }

        static bool RestartPendingImpl()
        {
            return KeyExists(@"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired")
                || KeyExists(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending");
        }

        static bool KeyExists(string path)
        {
            try { using (var k = Registry.LocalMachine.OpenSubKey(path)) return k != null; }
            catch { return false; }
        }
    }

    /// Everything one sample needs besides CPU/GPU load. Lives on the sampler thread only.
    sealed class PerfProbe : IDisposable
    {
        readonly int cpus = Environment.ProcessorCount;
        long[] lastIdle, lastTotal;
        readonly Stopwatch clock = Stopwatch.StartNew();
        double lastAt;
        long lastNetIn = -1, lastNetOut = -1;
        ulong lastRead, lastWrite;
        bool diskPrimed, diskMissing, vramMissing;
        ManagementObjectSearcher disk;
        readonly Dictionary<string, PerformanceCounter> vram = new Dictionary<string, PerformanceCounter>();
        DateTime vramRefresh = DateTime.MinValue;
        float? vramTotal;
        bool vramTotalRead;

        public void Prime()
        {
            lastAt = clock.Elapsed.TotalSeconds;
            Threads();
            Net(0);
            Disk(0);
        }

        public PerfSample Read(HwReader hw)
        {
            var now = clock.Elapsed.TotalSeconds;
            double dt = Math.Max(0.1, now - lastAt);
            lastAt = now;
            var s = new PerfSample { At = DateTime.Now };
            s.Cpu = hw.CpuPercent();
            s.Gpu = hw.GpuPercent();
            s.GpuTempC = AmdTemp.Read();
            s.CpuThreads = Threads();
            Memory(s);
            Vram(s);
            var n = Net(dt); s.NetDownMBs = n[0]; s.NetUpMBs = n[1];
            var d = Disk(dt); s.DiskReadMBs = d[0]; s.DiskWriteMBs = d[1];
            return s;
        }

        void Memory(PerfSample s)
        {
            try
            {
                var m = new PcNative.MemoryStatusEx { Length = (uint)Marshal.SizeOf(typeof(PcNative.MemoryStatusEx)) };
                if (!PcNative.GlobalMemoryStatusEx(ref m)) return;
                s.MemTotalGb = m.TotalPhys / PcNative.Gb;
                s.MemUsedGb = (m.TotalPhys - m.AvailPhys) / PcNative.Gb;
                float avail = m.AvailPhys / PcNative.Gb;
                PcNative.PerformanceInformation p;
                if (PcNative.GetPerformanceInfo(out p, (uint)Marshal.SizeOf(typeof(PcNative.PerformanceInformation))))
                {
                    s.MemCachedGb = (float)((double)p.SystemCache.ToUInt64() * p.PageSize.ToUInt64() / PcNative.Gb);
                    // shortcut: free = available minus cache (Task Manager's split, approximately); exact needs the memory list counters.
                    s.MemFreeGb = Math.Max(0, avail - s.MemCachedGb);
                }
                else s.MemFreeGb = avail;
            }
            catch { }
        }

        /// Per logical processor, from NtQuerySystemInformation: same in every Windows language.
        float[] Threads()
        {
            const int size = 48; // SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION
            var buf = IntPtr.Zero;
            try
            {
                buf = Marshal.AllocHGlobal(size * cpus);
                int got;
                if (PcNative.NtQuerySystemInformation(8, buf, size * cpus, out got) != 0) return new float[0];
                int n = got / size;
                var r = new float[n];
                var idle = new long[n];
                var total = new long[n];
                bool have = lastIdle != null && lastIdle.Length == n;
                for (int i = 0; i < n; i++)
                {
                    idle[i] = Marshal.ReadInt64(buf, i * size);
                    total[i] = Marshal.ReadInt64(buf, i * size + 8) + Marshal.ReadInt64(buf, i * size + 16); // kernel includes idle
                    if (!have) continue;
                    long dt = total[i] - lastTotal[i], di = idle[i] - lastIdle[i];
                    r[i] = dt <= 0 ? 0 : Math.Max(0, Math.Min(100, 100f * (dt - di) / dt));
                }
                lastIdle = idle;
                lastTotal = total;
                return have ? r : new float[0];
            }
            catch { return new float[0]; }
            finally { if (buf != IntPtr.Zero) Marshal.FreeHGlobal(buf); }
        }

        float[] Net(double dt)
        {
            try
            {
                long inB = 0, outB = 0;
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback
                        || ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
                    var st = ni.GetIPStatistics();
                    inB += st.BytesReceived;
                    outB += st.BytesSent;
                }
                var r = new float[2];
                if (lastNetIn >= 0 && dt > 0)
                {
                    r[0] = (float)(Math.Max(0, inB - lastNetIn) / dt / PcNative.Mb);
                    r[1] = (float)(Math.Max(0, outB - lastNetOut) / dt / PcNative.Mb);
                }
                lastNetIn = inB;
                lastNetOut = outB;
                return r;
            }
            catch { return new float[2]; }
        }

        /// WMI's raw disk counters: the class and property names are the same in every Windows language.
        float[] Disk(double dt)
        {
            var r = new float[2];
            if (diskMissing) return r;
            try
            {
                if (disk == null)
                    disk = new ManagementObjectSearcher(@"root\CIMV2",
                        "SELECT DiskReadBytesPersec, DiskWriteBytesPersec FROM Win32_PerfRawData_PerfDisk_PhysicalDisk WHERE Name = '_Total'");
                foreach (ManagementObject o in disk.Get())
                {
                    using (o)
                    {
                        ulong rd = Convert.ToUInt64(o["DiskReadBytesPersec"]), wr = Convert.ToUInt64(o["DiskWriteBytesPersec"]);
                        if (diskPrimed && dt > 0 && rd >= lastRead && wr >= lastWrite)
                        {
                            r[0] = (float)((rd - lastRead) / dt / PcNative.Mb);
                            r[1] = (float)((wr - lastWrite) / dt / PcNative.Mb);
                        }
                        lastRead = rd;
                        lastWrite = wr;
                        diskPrimed = true;
                    }
                }
            }
            catch (Exception e)
            {
                diskMissing = true;
                PcServices.Log("Disk speed not available: " + e.Message);
            }
            return r;
        }

        void Vram(PerfSample s)
        {
            if (!vramTotalRead) { vramTotalRead = true; vramTotal = VramTotal(); }
            s.VramTotalGb = vramTotal;
            if (vramMissing) return;
            try
            {
                if (DateTime.UtcNow > vramRefresh)
                {
                    vramRefresh = DateTime.UtcNow.AddSeconds(30);
                    var names = new HashSet<string>(new PerformanceCounterCategory("GPU Adapter Memory").GetInstanceNames());
                    foreach (var n in names)
                        if (!vram.ContainsKey(n)) vram[n] = new PerformanceCounter("GPU Adapter Memory", "Dedicated Usage", n, true);
                    foreach (var n in new List<string>(vram.Keys))
                        if (!names.Contains(n)) { vram[n].Dispose(); vram.Remove(n); }
                }
                float max = 0;
                foreach (var c in vram.Values) { try { max = Math.Max(max, c.NextValue()); } catch { } }
                s.VramUsedGb = max / PcNative.Gb;
            }
            catch (Exception e)
            {
                vramMissing = true;
                PcServices.Log("Video memory use not available: " + e.Message);
            }
        }

        /// The driver writes the card's memory size into the display class key; readable without admin.
        static float? VramTotal()
        {
            long best = 0;
            try
            {
                using (var cls = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"))
                {
                    if (cls == null) return null;
                    foreach (var sub in cls.GetSubKeyNames())
                    {
                        if (sub.Length != 4) continue; // 0000, 0001, ... ("Properties" is locked)
                        try
                        {
                            using (var k = cls.OpenSubKey(sub))
                            {
                                if (k == null) continue;
                                long v = 0;
                                var q = k.GetValue("HardwareInformation.qwMemorySize");
                                if (q is long) v = (long)q;
                                else if (q is byte[] && ((byte[])q).Length >= 8) v = BitConverter.ToInt64((byte[])q, 0);
                                if (v <= 0)
                                {
                                    var d = k.GetValue("HardwareInformation.MemorySize");
                                    if (d is int) v = (uint)(int)d;
                                    else if (d is byte[] && ((byte[])d).Length >= 4) v = BitConverter.ToUInt32((byte[])d, 0);
                                }
                                if (v > best) best = v;
                            }
                        }
                        catch { }
                    }
                }
            }
            catch (Exception e) { PcServices.Log("Video memory size not available: " + e.Message); }
            return best > 0 ? (float?)(best / PcNative.Gb) : null;
        }

        public void Dispose()
        {
            foreach (var c in vram.Values) c.Dispose();
            vram.Clear();
            if (disk != null) disk.Dispose();
        }
    }

    /// For getters the window calls on its UI thread: Get returns the last value at once (default until the first
    /// load is done) and, when that value is older than `seconds`, starts one background load. Nobody asking = no work.
    sealed class Cached<T>
    {
        readonly object gate = new object();
        readonly string name;
        readonly TimeSpan every;
        readonly Func<T> load;
        T value;
        DateTime at = DateTime.MinValue;
        bool busy;

        public Cached(string name, int seconds, Func<T> load) { this.name = name; every = TimeSpan.FromSeconds(seconds); this.load = load; }

        public T Get()
        {
            lock (gate)
            {
                if (!busy && DateTime.UtcNow - at >= every)
                {
                    busy = true;
                    PcServices.Background(name, Load);
                }
                return value;
            }
        }

        void Load()
        {
            try
            {
                var v = load();
                lock (gate) value = v;
            }
            finally { lock (gate) { at = DateTime.UtcNow; busy = false; } }
        }
    }
}
