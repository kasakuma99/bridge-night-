// Bridge Night Helper: Game mode page. Checks before game night, gamer fixes for this Windows user, and the
// in-game change (music quieter, only if switched on) that is always put back exactly when the game ends.
// No admin rights. Towards League only one read-only GET (the patch version) while the client runs.

using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

namespace BridgeNight
{
    static partial class GameMode
    {
        /* ---- Windows functions */

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct DevMode
        {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
            public short SpecVersion, DriverVersion, Size, DriverExtra;
            public int Fields, PositionX, PositionY, DisplayOrientation, DisplayFixedOutput;
            public short Color, Duplex, YResolution, TTOption, Collate;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string FormName;
            public short LogPixels;
            public int BitsPerPel, PelsWidth, PelsHeight, DisplayFlags, DisplayFrequency;
            public int ICMMethod, ICMIntent, MediaType, DitherType, Reserved1, Reserved2, PanningWidth, PanningHeight;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct StickyKeys { public uint Size; public uint Flags; }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern bool EnumDisplaySettings(string device, int mode, ref DevMode dm);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int ChangeDisplaySettingsEx(string device, ref DevMode dm, IntPtr hwnd, int flags, IntPtr param);
        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SystemParametersInfo(int action, int param, int[] value, int winIni);
        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SystemParametersInfo(int action, int param, ref StickyKeys value, int winIni);

        const int EnumCurrent = -1, DmPelsWidth = 0x80000, DmPelsHeight = 0x100000, DmBitsPerPel = 0x40000, DmFrequency = 0x400000;
        const int CdsUpdateRegistry = 1, DmInterlaced = 2;
        const int SpiGetMouse = 3, SpiSetMouse = 4, SpiGetStickyKeys = 0x3A, SpiSetStickyKeys = 0x3B;
        const int SpifUpdateIniFile = 1, SpifSendChange = 2;
        const uint SkfHotkeyActive = 4;

        /* ---- before game night */

        static string leagueVersion;
        static DateTime leagueAt = DateTime.MinValue;
        static bool leagueBusy;

        static List<PcCheck> BeforeNightImpl()
        {
            var list = new List<PcCheck>();
            bool restart = PerfMon.RestartPending;
            list.Add(new PcCheck
            {
                Id = "restart", Problem = restart,
                Title = restart ? "Windows wants to restart" : "No Windows restart pending",
                Detail = restart ? "Restart before the games so Windows does not do it in the middle of one." : "Windows will not interrupt game night."
            });

            RefreshLeagueVersion();
            var v = leagueVersion;
            list.Add(new PcCheck
            {
                Id = "patch", Title = "League patch",
                Detail = string.IsNullOrEmpty(v) ? "Open the League client to see its patch." : "Version " + v + ". Everyone in the lobby needs the same patch."
            });

            try
            {
                var sys = Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.System));
                var d = new DriveInfo(sys);
                float free = d.AvailableFreeSpace / PcNative.Gb;
                bool low = free < 10;
                list.Add(new PcCheck
                {
                    Id = "space", Problem = low, Title = low ? "Little free space on " + sys.TrimEnd('\\') : "Enough free space",
                    Detail = free.ToString("0") + " GB free on " + sys.TrimEnd('\\') + (low ? ". League patches and Windows need room." : ".")
                });
            }
            catch (Exception e) { PcServices.Log("Could not read the free space: " + e.Message); }
            return list;
        }

        /// The patch version comes from the League client (read-only GET); Lcu.Find is slow, so it runs in the background.
        static void RefreshLeagueVersion()
        {
            lock (gate)
            {
                if (leagueBusy || DateTime.Now - leagueAt < TimeSpan.FromSeconds(60)) return;
                leagueBusy = true;
                leagueAt = DateTime.Now;
            }
            PcServices.Background("league version", delegate
            {
                try
                {
                    var c = Lcu.Find();
                    var v = c == null ? null : Lcu.Get(c, "/lol-patch/v1/game-version") as string;
                    if (!string.IsNullOrEmpty(v)) leagueVersion = v; // e.g. "15.23.712.1234"
                }
                finally { lock (gate) leagueBusy = false; }
            });
        }

        /* ---- gamer fixes */

        static List<PcCheck> FixesImpl()
        {
            var list = new List<PcCheck>();
            try
            {
                DevMode cur, best;
                if (Modes(out cur, out best))
                {
                    bool low = best.DisplayFrequency > cur.DisplayFrequency;
                    list.Add(new PcCheck
                    {
                        Id = "refresh", Problem = low,
                        Title = low ? "Monitor at " + cur.DisplayFrequency + " Hz" : "Monitor at its best refresh rate (" + cur.DisplayFrequency + " Hz)",
                        Detail = low ? "It can do " + best.DisplayFrequency + " Hz at this resolution. Smoother picture, less delay." : "",
                        FixLabel = low ? "Set " + best.DisplayFrequency + " Hz" : ""
                    });
                }
            }
            catch (Exception e) { PcServices.Log("Could not read the monitor modes: " + e.Message); }

            try
            {
                var m = new int[3];
                if (SystemParametersInfo(SpiGetMouse, 0, m, 0))
                {
                    bool on = m[2] != 0;
                    list.Add(new PcCheck
                    {
                        Id = "mouse", Problem = on,
                        Title = on ? "Mouse acceleration is on" : "Mouse acceleration is off",
                        Detail = on ? "\"Enhance pointer precision\" makes aiming less exact." : "",
                        FixLabel = on ? "Turn off" : ""
                    });
                }
            }
            catch (Exception e) { PcServices.Log("Could not read the mouse settings: " + e.Message); }

            try
            {
                var sk = new StickyKeys { Size = (uint)Marshal.SizeOf(typeof(StickyKeys)) };
                if (SystemParametersInfo(SpiGetStickyKeys, (int)sk.Size, ref sk, 0))
                {
                    bool on = (sk.Flags & SkfHotkeyActive) != 0;
                    list.Add(new PcCheck
                    {
                        Id = "sticky", Problem = on,
                        Title = on ? "Sticky Keys pop-up is on" : "Sticky Keys pop-up is off",
                        Detail = on ? "Pressing Shift five times opens it in the middle of a fight." : "",
                        FixLabel = on ? "Turn off" : ""
                    });
                }
            }
            catch (Exception e) { PcServices.Log("Could not read Sticky Keys: " + e.Message); }
            return list;
        }

        /// Current mode of the main monitor and the fastest mode with the same resolution and colors.
        static bool Modes(out DevMode cur, out DevMode best)
        {
            cur = NewMode();
            best = NewMode();
            if (!EnumDisplaySettings(null, EnumCurrent, ref cur)) return false;
            best = cur;
            var m = NewMode();
            for (int i = 0; EnumDisplaySettings(null, i, ref m); i++)
            {
                if (m.PelsWidth == cur.PelsWidth && m.PelsHeight == cur.PelsHeight && m.BitsPerPel == cur.BitsPerPel
                    && (m.DisplayFlags & DmInterlaced) == 0 && m.DisplayFrequency > best.DisplayFrequency) best = m;
                m = NewMode();
            }
            return true;
        }

        static DevMode NewMode() { var d = new DevMode(); d.Size = (short)Marshal.SizeOf(typeof(DevMode)); return d; }

        static bool FixImpl(string id, out string note)
        {
            note = "";
            try
            {
                if (id == "refresh")
                {
                    DevMode cur, best;
                    if (!Modes(out cur, out best)) { note = "Windows did not tell the monitor modes."; return false; }
                    if (best.DisplayFrequency <= cur.DisplayFrequency) { note = "Already at " + cur.DisplayFrequency + " Hz."; return true; }
                    best.Fields = DmPelsWidth | DmPelsHeight | DmBitsPerPel | DmFrequency;
                    int r = ChangeDisplaySettingsEx(null, ref best, IntPtr.Zero, CdsUpdateRegistry, IntPtr.Zero);
                    note = r == 0 ? "Monitor set to " + best.DisplayFrequency + " Hz." : "Windows refused the change (code " + r + ").";
                    return Done(r == 0, note);
                }
                if (id == "mouse")
                {
                    var m = new int[3];
                    if (!SystemParametersInfo(SpiGetMouse, 0, m, 0)) { note = "Windows did not tell the mouse settings."; return false; }
                    m[2] = 0; // keep the two thresholds, switch acceleration off
                    bool ok = SystemParametersInfo(SpiSetMouse, 0, m, SpifUpdateIniFile | SpifSendChange);
                    note = ok ? "Mouse acceleration is off." : "Windows refused the change.";
                    return Done(ok, note);
                }
                if (id == "sticky")
                {
                    var sk = new StickyKeys { Size = (uint)Marshal.SizeOf(typeof(StickyKeys)) };
                    if (!SystemParametersInfo(SpiGetStickyKeys, (int)sk.Size, ref sk, 0)) { note = "Windows did not tell the Sticky Keys settings."; return false; }
                    sk.Flags &= ~SkfHotkeyActive;
                    bool ok = SystemParametersInfo(SpiSetStickyKeys, (int)sk.Size, ref sk, SpifUpdateIniFile | SpifSendChange);
                    note = ok ? "The Sticky Keys pop-up is off." : "Windows refused the change.";
                    return Done(ok, note);
                }
                note = "Unknown fix.";
                return false;
            }
            catch (Exception e)
            {
                note = "That did not work: " + PcServices.Scrub(e.Message);
                PcServices.Log("Fix " + id + " failed: " + e.Message);
                return false;
            }
        }

        static bool Done(bool ok, string note) { PcServices.Log("Fix: " + note); return ok; }

        /* ---- in game */

        static readonly object gate = new object();
        static List<KeyValuePair<AudioSessions.Volume, float>> quieted; // music sessions and their volume before

        /// Applies what the settings ask for (music quieter, only if switched on). True if anything changed.
        internal static bool Apply()
        {
            var s = PcServices.Options;
            if (s == null) return false;
            lock (gate)
            {
                if (s.MusicQuieter && quieted == null) PcServices.Safe("music quieter", delegate { quieted = AudioSessions.Lower(0.3f); });
                return ActiveImpl();
            }
        }

        /// Puts back exactly what Apply changed. Safe to call any time.
        internal static void Restore()
        {
            lock (gate)
            {
                if (quieted != null)
                {
                    var q = quieted;
                    quieted = null;
                    PcServices.Safe("music restore", delegate { AudioSessions.Restore(q); });
                }
            }
        }

        static bool ActiveImpl() { lock (gate) return quieted != null && quieted.Count > 0; }

        static string ActiveTextImpl() { lock (gate) return quieted != null && quieted.Count > 0 ? "Music at 30 %" : ""; }
    }
}
