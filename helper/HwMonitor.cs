// Bridge Night Helper: CPU and GPU load for the small gauges in the sidebar. Read-only, no admin rights.
//  * CPU: GetSystemTimes (kernel32), works in every Windows language (performance counter names are translated).
//  * GPU: the "GPU Engine" performance counters (3D engines, like Task Manager), busiest graphics card.
//    Read all at once with ReadCategory: one counter object per instance (often 600+) cost ~180 ms CPU per reading.
// Both are "load since the last call", so every caller needs its own HwReader: the sidebar uses the shared
// one behind HwMonitor, PerfMon (PcPerf.cs) has its own on its sampler thread.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace BridgeNight
{
    static class HwMonitor
    {
        static readonly HwReader shared = new HwReader();

        /// CPU load in percent since the last call; null on the first call or if Windows refuses.
        public static float? CpuPercent() { return shared.CpuPercent(); }

        /// GPU 3D load in percent of the busiest graphics card; null if this Windows has no GPU counters.
        public static float? GpuPercent() { return shared.GpuPercent(); }
    }

    sealed class HwReader
    {
        [StructLayout(LayoutKind.Sequential)]
        struct FileTime { public uint Low; public uint High; }

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetSystemTimes(out FileTime idle, out FileTime kernel, out FileTime user);

        static long Ticks(FileTime t) { return ((long)t.High << 32) | t.Low; }

        readonly object gate = new object();
        long lastIdle, lastBusyTotal;
        PerformanceCounterCategory gpuCategory;
        InstanceDataCollection lastGpu; // previous raw samples, per engine instance
        bool gpuMissing;

        public float? CpuPercent()
        {
            lock (gate)
            {
                FileTime i, k, u;
                if (!GetSystemTimes(out i, out k, out u)) return null;
                long idle = Ticks(i), total = Ticks(k) + Ticks(u); // kernel time includes idle time
                long dIdle = idle - lastIdle, dTotal = total - lastBusyTotal;
                bool first = lastBusyTotal == 0;
                lastIdle = idle;
                lastBusyTotal = total;
                if (first || dTotal <= 0) return null;
                return Clamp(100f * (dTotal - dIdle) / dTotal);
            }
        }

        public float? GpuPercent()
        {
            lock (gate)
            {
                if (gpuMissing) return null;
                try
                {
                    if (gpuCategory == null) gpuCategory = new PerformanceCounterCategory("GPU Engine");
                    var now = gpuCategory.ReadCategory()["Utilization Percentage"];
                    var before = lastGpu;
                    lastGpu = now;
                    if (now == null) { gpuMissing = true; return null; }
                    if (before == null) return null; // load is "since the last call": nothing to compare yet
                    var perAdapter = new Dictionary<string, float>();
                    foreach (InstanceData d in now.Values)
                    {
                        if (d.InstanceName.IndexOf("engtype_3D", StringComparison.OrdinalIgnoreCase) < 0) continue;
                        var old = before[d.InstanceName]; // null when the process behind it just started
                        if (old == null) continue;
                        float v;
                        try { v = CounterSample.Calculate(old.Sample, d.Sample); } catch { continue; }
                        var a = Adapter(d.InstanceName);
                        float sum;
                        perAdapter.TryGetValue(a, out sum);
                        perAdapter[a] = sum + v;
                    }
                    float max = 0;
                    foreach (var v in perAdapter.Values) if (v > max) max = v;
                    return Clamp(max);
                }
                catch
                {
                    gpuMissing = true; // category missing (old Windows / driver): stop trying
                    return null;
                }
            }
        }

        /// Instance names look like "pid_1234_luid_0x00000000_0x0000D1A2_phys_0_eng_0_engtype_3D".
        static string Adapter(string instance)
        {
            int s = instance.IndexOf("luid_", StringComparison.OrdinalIgnoreCase);
            int e = s < 0 ? -1 : instance.IndexOf("_phys", s, StringComparison.OrdinalIgnoreCase);
            return s >= 0 && e > s ? instance.Substring(s, e - s) : "";
        }

        /// Frees the counters (the sampler calls this when measuring stops).
        public void Reset()
        {
            lock (gate)
            {
                lastGpu = null;
                lastIdle = lastBusyTotal = 0;
            }
        }

        static float Clamp(float v) { return v < 0 ? 0 : v > 100 ? 100 : v; }
    }
}
