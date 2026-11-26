// Bridge Night Helper: Audio page. Mic mute and the output switch are done in Windows itself (Core Audio),
// so every app follows. Hotkeys Ctrl+Alt+M (mic) and Ctrl+Alt+H (next output). No admin rights.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace BridgeNight
{
    static partial class AudioCtl
    {
        const int Render = 0, Capture = 1, Active = 1;
        const int Console = 0, Multimedia = 1, Communications = 2;

        static string MicNameImpl()
        {
            try { using (var d = CoreAudio.Default(Capture)) return d == null ? "" : d.Name; }
            catch (Exception e) { return Fail("mic name", e, ""); }
        }

        static bool MicMutedImpl()
        {
            try
            {
                using (var d = CoreAudio.Default(Capture))
                {
                    if (d == null) return false;
                    var v = d.Volume();
                    bool m;
                    return v != null && v.GetMute(out m) == 0 && m;
                }
            }
            catch (Exception e) { return Fail("mic state", e, false); }
        }

        static bool ToggleMicImpl()
        {
            try
            {
                using (var d = CoreAudio.Default(Capture))
                {
                    if (d == null) return false;
                    var v = d.Volume();
                    bool m;
                    if (v == null || v.GetMute(out m) != 0) return false;
                    var ctx = Guid.Empty;
                    if (v.SetMute(!m, ref ctx) != 0) return m;
                    PcServices.Log(!m ? "Mic muted" : "Mic on");
                    var s = PcServices.Options;
                    if (s != null && s.MuteSound)
                        try { (!m ? System.Media.SystemSounds.Hand : System.Media.SystemSounds.Asterisk).Play(); } catch { }
                    RaiseChanged();
                    return !m;
                }
            }
            catch (Exception e) { return Fail("mic mute", e, false); }
        }

        // The meter object is kept for a few seconds: MicLevel is read many times a second by the small meter.
        // It only moves while some app (Discord, the game) records from the mic; the helper never records itself.
        static CoreAudio.IAudioMeterInformation meter;
        static DateTime meterAt = DateTime.MinValue;

        static float MicLevelImpl()
        {
            try
            {
                if (meter == null || DateTime.UtcNow - meterAt > TimeSpan.FromSeconds(5))
                {
                    meterAt = DateTime.UtcNow;
                    meter = null;
                    using (var d = CoreAudio.Default(Capture)) if (d != null) meter = d.Meter();
                }
                float p;
                return meter != null && meter.GetPeakValue(out p) == 0 ? Math.Max(0, Math.Min(1, p)) : 0;
            }
            catch { meter = null; return 0; }
        }

        static List<AudioDevice> OutputsImpl()
        {
            var list = new List<AudioDevice>();
            try
            {
                string def = "";
                using (var d = CoreAudio.Default(Render)) if (d != null) def = d.Id;
                foreach (var d in CoreAudio.All(Render))
                    using (d) list.Add(new AudioDevice { Id = d.Id, Name = d.Name, IsDefault = d.Id == def });
            }
            catch (Exception e) { Fail("outputs", e, 0); }
            return list;
        }

        static string OutputNameImpl()
        {
            try { using (var d = CoreAudio.Default(Render)) return d == null ? "" : d.Name; }
            catch (Exception e) { return Fail("output name", e, ""); }
        }

        static bool SetOutputImpl(string id)
        {
            if (string.IsNullOrEmpty(id)) return false;
            try
            {
                var pc = (CoreAudio.IPolicyConfig)new CoreAudio.PolicyConfigClient();
                try
                {
                    bool ok = pc.SetDefaultEndpoint(id, Console) == 0;
                    ok &= pc.SetDefaultEndpoint(id, Multimedia) == 0;
                    ok &= pc.SetDefaultEndpoint(id, Communications) == 0;
                    PcServices.Log(ok ? "Sound output: " + OutputNameImpl() : "Windows refused to switch the sound output");
                    RaiseChanged();
                    return ok;
                }
                finally { Marshal.ReleaseComObject(pc); }
            }
            catch (Exception e) { return Fail("output switch", e, false); }
        }

        static bool NextOutputImpl()
        {
            var list = OutputsImpl();
            if (list.Count < 2) return false;
            int cur = list.FindIndex(delegate(AudioDevice d) { return d.IsDefault; });
            return SetOutputImpl(list[(cur + 1) % list.Count].Id);
        }

        static T Fail<T>(string what, Exception e, T value)
        {
            PcServices.Log("Audio (" + what + "): " + e.Message);
            return value;
        }

        /* ---- hotkeys */

        static HotkeyWindow hotkeys;

        /// Registers or unregisters the hotkeys to match Settings.Hotkeys (called by PcServices on the UI thread).
        internal static void SyncHotkeys()
        {
            var s = PcServices.Options;
            bool want = s != null && s.Hotkeys;
            if (want && hotkeys == null) hotkeys = new HotkeyWindow();
            else if (!want && hotkeys != null) UnregisterHotkeys();
        }

        internal static void UnregisterHotkeys()
        {
            if (hotkeys == null) return;
            var h = hotkeys;
            hotkeys = null;
            h.Dispose();
        }

        sealed class HotkeyWindow : NativeWindow, IDisposable
        {
            [DllImport("user32.dll", SetLastError = true)]
            static extern bool RegisterHotKey(IntPtr hwnd, int id, int modifiers, int key);
            [DllImport("user32.dll")]
            static extern bool UnregisterHotKey(IntPtr hwnd, int id);

            const int WmHotkey = 0x0312, ModAlt = 1, ModControl = 2, ModNoRepeat = 0x4000;
            const int MicId = 1, OutputId = 2;
            readonly bool mic, output;

            public HotkeyWindow()
            {
                var cp = new CreateParams();
                cp.Parent = new IntPtr(-3); // HWND_MESSAGE: an invisible window that only receives messages
                CreateHandle(cp);
                mic = Register(MicId, Keys.M, "Ctrl+Alt+M");
                output = Register(OutputId, Keys.H, "Ctrl+Alt+H");
            }

            bool Register(int id, Keys key, string name)
            {
                if (RegisterHotKey(Handle, id, ModControl | ModAlt | ModNoRepeat, (int)key)) return true;
                PcServices.Log("Hotkey " + name + " is taken by another program (code " + Marshal.GetLastWin32Error() + ")");
                return false;
            }

            protected override void WndProc(ref Message m)
            {
                if (m.Msg == WmHotkey)
                {
                    int id = m.WParam.ToInt32();
                    if (id == MicId) PcServices.Safe("hotkey mic", delegate { ToggleMicImpl(); });
                    else if (id == OutputId) PcServices.Safe("hotkey output", delegate { NextOutputImpl(); });
                    return;
                }
                base.WndProc(ref m);
            }

            public void Dispose()
            {
                if (Handle == IntPtr.Zero) return;
                if (mic) UnregisterHotKey(Handle, MicId);
                if (output) UnregisterHotKey(Handle, OutputId);
                DestroyHandle();
            }
        }
    }

    /// Music apps' own volume (Windows volume mixer), lowered during games and put back afterwards.
    static class AudioSessions
    {
        static readonly HashSet<string> MusicApps = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Spotify", "AppleMusic", "iTunes", "Deezer", "TIDAL", "Amazon Music", "foobar2000", "vlc", "AIMP", "MusicBee", "Winamp", "YouTube Music"
        };

        public sealed class Volume { public CoreAudio.ISimpleAudioVolume Control; public string App; }

        /// Lowers every music app session louder than `level`; returns what it changed with the old volume.
        public static List<KeyValuePair<Volume, float>> Lower(float level)
        {
            var changed = new List<KeyValuePair<Volume, float>>();
            foreach (var v in MusicSessions())
            {
                float old;
                if (v.Control.GetMasterVolume(out old) != 0 || old <= level) continue;
                var ctx = Guid.Empty;
                if (v.Control.SetMasterVolume(level, ref ctx) == 0) changed.Add(new KeyValuePair<Volume, float>(v, old));
            }
            foreach (var c in changed) PcServices.Log("Music quieter: " + c.Key.App + " at 30 % for the game");
            return changed;
        }

        public static void Restore(List<KeyValuePair<Volume, float>> changed)
        {
            foreach (var c in changed)
            {
                try
                {
                    var ctx = Guid.Empty;
                    c.Key.Control.SetMasterVolume(c.Value, ref ctx);
                    PcServices.Log("Music quieter: " + c.Key.App + " back to " + Math.Round(c.Value * 100) + " %");
                }
                catch { } // the app may have closed: nothing to put back
            }
        }

        /// Read-only: the music app sessions on the default output (used by Lower and the self-test).
        public static List<Volume> MusicSessions()
        {
            var list = new List<Volume>();
            using (var d = CoreAudio.Default(0))
            {
                if (d == null) return list;
                var mgr = d.Sessions();
                CoreAudio.IAudioSessionEnumerator en;
                if (mgr == null || mgr.GetSessionEnumerator(out en) != 0) return list;
                int n;
                en.GetCount(out n);
                for (int i = 0; i < n; i++)
                {
                    try
                    {
                        CoreAudio.IAudioSessionControl2 s;
                        if (en.GetSession(i, out s) != 0 || s == null) continue;
                        uint pid;
                        if (s.GetProcessId(out pid) != 0 || pid == 0) continue;
                        string name;
                        try { using (var p = Process.GetProcessById((int)pid)) name = p.ProcessName; } catch { continue; }
                        if (!MusicApps.Contains(name)) continue;
                        var vol = s as CoreAudio.ISimpleAudioVolume;
                        if (vol != null) list.Add(new Volume { Control = vol, App = name });
                    }
                    catch { }
                }
            }
            return list;
        }
    }

    /// The Windows Core Audio interfaces the helper needs (declared in Windows' own order).
    static class CoreAudio
    {
        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
        [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] public class PolicyConfigClient { }

        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceEnumerator
        {
            [PreserveSig] int EnumAudioEndpoints(int flow, int stateMask, out IMMDeviceCollection devices);
            [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
        }

        [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceCollection
        {
            [PreserveSig] int GetCount(out int count);
            [PreserveSig] int Item(int index, out IMMDevice device);
        }

        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        internal interface IMMDevice
        {
            [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
            [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
            [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct PropertyKey { public Guid Format; public int Id; }

        [StructLayout(LayoutKind.Sequential)]
        internal struct PropVariant { public ushort Type; public ushort R1, R2, R3; public IntPtr Value; public IntPtr Value2; }

        [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        internal interface IPropertyStore
        {
            [PreserveSig] int GetCount(out int count);
            [PreserveSig] int GetAt(int index, out PropertyKey key);
            [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        }

        [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        public interface IAudioEndpointVolume
        {
            [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
            [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
            [PreserveSig] int GetChannelCount(out int count);
            [PreserveSig] int SetMasterVolumeLevel(float db, ref Guid context);
            [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
            [PreserveSig] int GetMasterVolumeLevel(out float db);
            [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
            [PreserveSig] int SetChannelVolumeLevel(int channel, float db, ref Guid context);
            [PreserveSig] int SetChannelVolumeLevelScalar(int channel, float level, ref Guid context);
            [PreserveSig] int GetChannelVolumeLevel(int channel, out float db);
            [PreserveSig] int GetChannelVolumeLevelScalar(int channel, out float level);
            [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
            [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
        }

        [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        public interface IAudioMeterInformation
        {
            [PreserveSig] int GetPeakValue(out float peak);
        }

        [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        public interface IAudioSessionManager2
        {
            [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr control);
            [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr volume);
            [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
        }

        [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        public interface IAudioSessionEnumerator
        {
            [PreserveSig] int GetCount(out int count);
            [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
        }

        [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        public interface IAudioSessionControl2
        {
            // IAudioSessionControl
            [PreserveSig] int GetState(out int state);
            [PreserveSig] int GetDisplayName(out IntPtr name);
            [PreserveSig] int SetDisplayName(IntPtr name, ref Guid context);
            [PreserveSig] int GetIconPath(out IntPtr path);
            [PreserveSig] int SetIconPath(IntPtr path, ref Guid context);
            [PreserveSig] int GetGroupingParam(out Guid group);
            [PreserveSig] int SetGroupingParam(ref Guid group, ref Guid context);
            [PreserveSig] int RegisterAudioSessionNotification(IntPtr events);
            [PreserveSig] int UnregisterAudioSessionNotification(IntPtr events);
            // IAudioSessionControl2
            [PreserveSig] int GetSessionIdentifier(out IntPtr id);
            [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
            [PreserveSig] int GetProcessId(out uint pid);
        }

        [ComImport, Guid("87CE5498-68D6-44E5-9215-6F4BE6E28A0A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        public interface ISimpleAudioVolume
        {
            [PreserveSig] int SetMasterVolume(float level, ref Guid context);
            [PreserveSig] int GetMasterVolume(out float level);
        }

        /// The well-known undocumented interface Windows' own sound settings use to set the default device.
        [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        public interface IPolicyConfig
        {
            [PreserveSig] int GetMixFormat(string id, IntPtr format);
            [PreserveSig] int GetDeviceFormat(string id, int defaultFormat, IntPtr format);
            [PreserveSig] int ResetDeviceFormat(string id);
            [PreserveSig] int SetDeviceFormat(string id, IntPtr endpointFormat, IntPtr mixFormat);
            [PreserveSig] int GetProcessingPeriod(string id, int defaultPeriod, IntPtr defaultP, IntPtr minP);
            [PreserveSig] int SetProcessingPeriod(string id, IntPtr period);
            [PreserveSig] int GetShareMode(string id, IntPtr mode);
            [PreserveSig] int SetShareMode(string id, IntPtr mode);
            [PreserveSig] int GetPropertyValue(string id, IntPtr key, IntPtr value);
            [PreserveSig] int SetPropertyValue(string id, IntPtr key, IntPtr value);
            [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
        }

        [DllImport("ole32.dll")]
        static extern int PropVariantClear(ref PropVariant pv);

        const int ClsCtxAll = 23, StgmRead = 0, VtLpwstr = 31;
        static readonly Guid FriendlyNameFormat = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"); // PKEY_Device_FriendlyName, 14

        /// One endpoint (speaker, headset, mic). Dispose releases the COM object.
        public sealed class Device : IDisposable
        {
            readonly IMMDevice dev;
            internal Device(IMMDevice d) { dev = d; }

            public string Id { get { string id; return dev.GetId(out id) == 0 ? id ?? "" : ""; } }

            public string Name
            {
                get
                {
                    IPropertyStore store;
                    if (dev.OpenPropertyStore(StgmRead, out store) != 0 || store == null) return "";
                    try
                    {
                        var key = new PropertyKey { Format = FriendlyNameFormat, Id = 14 };
                        PropVariant v;
                        if (store.GetValue(ref key, out v) != 0) return "";
                        try { return v.Type == VtLpwstr ? Marshal.PtrToStringUni(v.Value) ?? "" : ""; }
                        finally { PropVariantClear(ref v); }
                    }
                    finally { Marshal.ReleaseComObject(store); }
                }
            }

            object Activate(string iid)
            {
                var g = new Guid(iid);
                object o;
                return dev.Activate(ref g, ClsCtxAll, IntPtr.Zero, out o) == 0 ? o : null;
            }

            public IAudioEndpointVolume Volume() { return Activate("5CDF2C82-841E-4546-9722-0CF74078229A") as IAudioEndpointVolume; }
            public IAudioMeterInformation Meter() { return Activate("C02216F6-8C67-4B5B-9D00-D008E73E0064") as IAudioMeterInformation; }
            public IAudioSessionManager2 Sessions() { return Activate("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F") as IAudioSessionManager2; }

            public void Dispose() { try { Marshal.ReleaseComObject(dev); } catch { } }
        }

        static IMMDeviceEnumerator Enumerator() { return (IMMDeviceEnumerator)new MMDeviceEnumerator(); }

        /// Default endpoint (flow 0 = output, 1 = mic) for the console role, or null when there is none.
        public static Device Default(int flow)
        {
            var en = Enumerator();
            try
            {
                IMMDevice d;
                return en.GetDefaultAudioEndpoint(flow, 0, out d) == 0 && d != null ? new Device(d) : null;
            }
            finally { Marshal.ReleaseComObject(en); }
        }

        /// Active endpoints of one flow.
        public static List<Device> All(int flow)
        {
            var list = new List<Device>();
            var en = Enumerator();
            try
            {
                IMMDeviceCollection c;
                if (en.EnumAudioEndpoints(flow, 1, out c) != 0 || c == null) return list;
                int n;
                c.GetCount(out n);
                for (int i = 0; i < n; i++)
                {
                    IMMDevice d;
                    if (c.Item(i, out d) == 0 && d != null) list.Add(new Device(d));
                }
                Marshal.ReleaseComObject(c);
            }
            finally { Marshal.ReleaseComObject(en); }
            return list;
        }
    }
}
