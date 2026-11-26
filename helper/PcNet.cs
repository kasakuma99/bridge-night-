// Bridge Night Helper: Network page. Pings the EUW game server once a second while the page is open, and on
// request finds where the time goes (this PC, router, provider, Riot) with TTL-limited pings. No admin rights.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Threading;

namespace BridgeNight
{
    static partial class NetCheck
    {
        // The address commonly used for EUW ping tests (Riot's game servers in Amsterdam).
        const string Target = "104.160.141.3";
        // Riot's network may drop pings (seen 2026-11: no answer at all). Then the helper pings a data centre
        // in Amsterdam next to the EUW servers instead and says so in TargetName.
        const string Fallback = "speedtest.ams1.nl.leaseweb.net";
        const string RiotName = "Riot " + ServerName, FallbackName = "Amsterdam, next to " + ServerName + " (Riot does not answer pings)";
        static volatile string activeTarget = Target, activeName = RiotName;

        static readonly object gate = new object();
        static readonly Dictionary<string, int> users = new Dictionary<string, int>();
        static readonly List<KeyValuePair<DateTime, int?>> pings = new List<KeyValuePair<DateTime, int?>>();
        static readonly AutoResetEvent wake = new AutoResetEvent(false);
        static Thread pinger;
        static volatile bool tracing;
        static List<NetHop> hops = new List<NetHop>();

        static void StartImpl(string who)
        {
            lock (gate)
            {
                int n;
                users.TryGetValue(who ?? "", out n);
                users[who ?? ""] = n + 1;
                if (pinger == null) pinger = PcServices.Background("net ping", Loop);
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
            wake.Set();
        }

        internal static void StopAll() { lock (gate) users.Clear(); wake.Set(); }

        static void Loop()
        {
            try
            {
                using (var ping = new Ping())
                {
                    var clock = Stopwatch.StartNew();
                    activeTarget = Target;
                    activeName = RiotName;
                    int riotTries = 0;
                    bool riotAnswered = false;
                    while (true)
                    {
                        lock (gate) if (users.Count == 0) return;
                        var started = clock.ElapsedMilliseconds;
                        int? ms = null;
                        try
                        {
                            var r = ping.Send(activeTarget, 1000);
                            if (r.Status == IPStatus.Success) ms = (int)r.RoundtripTime;
                        }
                        catch { } // no network at all: counts as lost
                        if (activeTarget == Target && !riotAnswered)
                        {
                            riotAnswered = ms.HasValue;
                            if (!riotAnswered && ++riotTries == 3 && UseFallback(ping)) { lock (gate) pings.Clear(); continue; }
                        }
                        lock (gate)
                        {
                            var now = DateTime.Now;
                            pings.Add(new KeyValuePair<DateTime, int?>(now, ms));
                            while (pings.Count > 0 && now - pings[0].Key > TimeSpan.FromMinutes(10)) pings.RemoveAt(0);
                        }
                        var wait = 1000 - (int)(clock.ElapsedMilliseconds - started);
                        if (wait > 0) wake.WaitOne(wait);
                    }
                }
            }
            finally
            {
                lock (gate)
                {
                    if (pinger == Thread.CurrentThread) pinger = null;
                    if (users.Count > 0 && pinger == null) pinger = PcServices.Background("net ping", Loop);
                }
            }
        }

        /// Switches to the Amsterdam address if it answers (if nothing answers, the internet is down: stay on Riot).
        static bool UseFallback(Ping ping)
        {
            var ip = Resolve(Fallback);
            if (ip == null) return false;
            try { if (ping.Send(ip, 1000).Status != IPStatus.Success) return false; } catch { return false; }
            activeTarget = ip;
            activeName = FallbackName;
            PcServices.Log("Network: Riot's EUW server does not answer pings, measuring to Amsterdam next to it instead");
            return true;
        }

        static string Resolve(string host)
        {
            try
            {
                foreach (var a in Dns.GetHostAddresses(host))
                    if (a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork) return a.ToString();
            }
            catch { }
            return null;
        }

        static List<KeyValuePair<DateTime, int?>> HistoryImpl(int seconds)
        {
            var from = DateTime.Now.AddSeconds(-seconds);
            var list = new List<KeyValuePair<DateTime, int?>>();
            lock (gate) foreach (var p in pings) if (p.Key >= from) list.Add(p);
            return list;
        }

        static NetReport CurrentImpl()
        {
            var last = HistoryImpl(60);
            int? latest = null;
            var recent = DateTime.Now.AddSeconds(-5);
            for (int i = last.Count - 1; i >= 0 && last[i].Key >= recent; i--) if (last[i].Value.HasValue) { latest = last[i].Value; break; }
            return Report(last, latest, OnWifi());
        }

        /// Pure: turns the pings of the last minute into numbers and one plain-words verdict.
        internal static NetReport Report(List<KeyValuePair<DateTime, int?>> last, int? latest, bool wifi)
        {
            var r = new NetReport { PingMs = latest };
            int lost = 0, diffs = 0;
            long diffSum = 0;
            int? prev = null;
            foreach (var p in last)
            {
                if (!p.Value.HasValue) { lost++; continue; }
                if (prev.HasValue) { diffSum += Math.Abs(p.Value.Value - prev.Value); diffs++; }
                prev = p.Value;
            }
            if (diffs > 0) r.JitterMs = (int)Math.Round((double)diffSum / diffs);
            r.LossPercent = last.Count == 0 ? 0 : 100f * lost / last.Count;
            r.Verdict = Verdict(last.Count, r.PingMs, r.JitterMs, r.LossPercent, wifi, out r.Ok);
            return r;
        }

        internal static string Verdict(int samples, int? ping, int? jitter, float loss, bool wifi, out bool ok)
        {
            ok = false;
            if (samples == 0) { ok = true; return "Measuring"; }
            if (samples >= 3 && loss >= 99.9f) return "No answer from the " + ServerName + " server. Check your internet connection.";
            if (loss >= 2) return wifi ? "Your Wi-Fi is dropping packets. A cable or a spot closer to the router helps."
                                       : "Packets get lost on the way to " + ServerName + ".";
            if (ping > 100) return "High ping to " + ServerName + " (" + ping + " ms).";
            if (jitter > 15) return wifi ? "Your ping jumps around on Wi-Fi (jitter " + jitter + " ms). A cable helps."
                                         : "Your ping jumps around (jitter " + jitter + " ms).";
            ok = true;
            return "All good";
        }

        static bool OnWifi()
        {
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                    if (ni.OperationalStatus == OperationalStatus.Up && ni.NetworkInterfaceType == NetworkInterfaceType.Wireless80211
                        && ni.GetIPProperties().GatewayAddresses.Count > 0) return true;
            }
            catch { }
            return false;
        }

        /* ---- trace */

        static void TraceNowImpl()
        {
            lock (gate)
            {
                if (tracing) return;
                tracing = true;
            }
            PcServices.Background("net trace", delegate
            {
                try
                {
                    var result = Trace();
                    lock (gate) hops = result;
                }
                finally { tracing = false; }
            });
        }

        static List<NetHop> Trace()
        {
            var list = new List<NetHop>();
            using (var ping = new Ping())
            {
                list.Add(Measure(ping, "This PC", "127.0.0.1"));
                var gw = Gateway();
                list.Add(gw == null ? new NetHop { Name = "Your router", LossPercent = 100 } : Measure(ping, "Your router", gw));
                list.Add(Provider(ping));
                var riot = Measure(ping, RiotName, Target);
                if (!riot.Ms.HasValue)
                {
                    var ip = Resolve(Fallback);
                    var near = ip == null ? null : Measure(ping, FallbackName, ip);
                    if (near != null && near.Ms.HasValue) riot = near;
                }
                list.Add(riot);
            }
            return list;
        }

        static NetHop Measure(Ping ping, string name, string address)
        {
            const int count = 5;
            int ok = 0;
            long sum = 0;
            for (int i = 0; i < count; i++)
            {
                try
                {
                    var r = ping.Send(address, 1000);
                    if (r.Status == IPStatus.Success) { ok++; sum += r.RoundtripTime; }
                }
                catch { }
            }
            return new NetHop { Name = name, Ms = ok == 0 ? (int?)null : (int)(sum / ok), LossPercent = 100f * (count - ok) / count };
        }

        /// The first public address on the way to Riot: the provider's first router. It often ignores direct pings,
        /// so its time is taken from the "time expired" answers (timed here: Windows reports 0 for those).
        static NetHop Provider(Ping ping)
        {
            var hop = new NetHop { Name = "Internet provider", LossPercent = 100 };
            for (int ttl = 1; ttl <= 12; ttl++)
            {
                IPAddress addr;
                long ms;
                if (!Probe(ping, ttl, out addr, out ms)) continue;
                if (addr == null || IsPrivate(addr)) continue;
                var direct = Measure(ping, hop.Name, addr.ToString());
                if (direct.Ms.HasValue) return direct;
                int ok = 0;
                long sum = 0;
                for (int i = 0; i < 5; i++) if (Probe(ping, ttl, out addr, out ms)) { ok++; sum += ms; }
                hop.Ms = ok == 0 ? (int?)null : (int)(sum / ok);
                hop.LossPercent = 100f * (5 - ok) / 5;
                return hop;
            }
            return hop;
        }

        static bool Probe(Ping ping, int ttl, out IPAddress from, out long ms)
        {
            from = null;
            ms = 0;
            try
            {
                var sw = Stopwatch.StartNew();
                var r = ping.Send(Target, 1000, new byte[32], new PingOptions(ttl, true));
                ms = sw.ElapsedMilliseconds;
                if (r.Status != IPStatus.TtlExpired && r.Status != IPStatus.Success) return false;
                from = r.Address;
                return true;
            }
            catch { return false; }
        }

        internal static bool IsPrivate(IPAddress a)
        {
            var b = a.GetAddressBytes();
            if (b.Length != 4) return true; // only IPv4 is traced
            return b[0] == 10 || b[0] == 127 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168)
                || (b[0] == 100 && b[1] >= 64 && b[1] <= 127) || (b[0] == 169 && b[1] == 254);
        }

        static string Gateway()
        {
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    foreach (var g in ni.GetIPProperties().GatewayAddresses)
                        if (g.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any))
                            return g.Address.ToString();
                }
            }
            catch { }
            return null;
        }
    }
}
