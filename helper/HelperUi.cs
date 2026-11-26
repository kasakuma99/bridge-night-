// Bridge Night Helper: tray icon, log, pop-ups. Window: UiWindow.cs (+ UiHome/UiPerformance/UiPcPages/UiSettingsHelp),
// small windows: UiPopups.cs, controls: UiControls.cs, look: UiTheme.cs. Logic: BridgeNightHelper.cs, PC features: PcServices.cs.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace BridgeNight
{
    /* ------------------------------------------------------------------ tray + windows */

    class TrayApp : ApplicationContext
    {
        readonly NotifyIcon icon = new NotifyIcon();
        readonly Settings settings = Settings.Load();
        readonly List<string> logLines = new List<string>();
        readonly SynchronizationContext ui;
        readonly System.Threading.Timer timer;
        readonly System.Windows.Forms.Timer pcTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        readonly Watcher watcher;
        readonly ToolStripMenuItem pauseItem;
        MainWindow form;
        MiniWindow mini;
        TrayFlyout flyout;
        Toast toast;
        MutedBadge badge;
        string statusText = "Starting";
        bool stopped;

        public TrayApp()
        {
            ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            icon.Icon = Theme.SmallIcon;
            icon.Text = Program.Title;
            var menu = new ContextMenuStrip();
            var openItem = new ToolStripMenuItem("Open", null, delegate { ShowWindow(); });
            openItem.Font = new Font(openItem.Font, FontStyle.Bold);
            menu.Items.Add(openItem);
            menu.Items.Add("Mini window", null, delegate { ShowMini(); });
            pauseItem = new ToolStripMenuItem("Pause sending", null, delegate { SetPaused(!settings.Paused); });
            pauseItem.Checked = settings.Paused;
            menu.Items.Add(pauseItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Exit", null, delegate { Quit(); });
            icon.ContextMenuStrip = menu;
            icon.MouseUp += delegate (object o, MouseEventArgs e) { if (e.Button == MouseButtons.Left) ToggleFlyout(); };
            icon.Visible = true;

            watcher = new Watcher(settings, Log, Status);
            Log(Program.Title + " " + Program.Version + " started" + (Program.UpdatedFrom != "" ? " (updated from " + Program.UpdatedFrom + ")" : ""));
            timer = new System.Threading.Timer(delegate { watcher.Tick(); }, null, 1000, 1500);

            PcServices.Notify += OnNotify;
            AudioCtl.Changed += UpdateBadge;
            try { PcServices.Start(settings, Log); }
            catch (Exception e) { Log("PC features could not start: " + e.Message); }
            pcTimer.Tick += delegate { OnPcTick(); };
            pcTimer.Start();
            // The Updater restarts the helper with Application.Exit(): clean up there too.
            Application.ApplicationExit += delegate { Stop(); };

            var whatsNew = Updater.WhatsNew;
            if (!string.IsNullOrEmpty(whatsNew)) ShowToast("\uE895", Theme.Good, "Updated to " + Program.Version, whatsNew);
            if (string.IsNullOrEmpty(settings.Token)) ShowWindow();
        }

        static readonly object fileLock = new object();
        static string LogFile { get { return Path.Combine(Settings.Dir, "helper-log.txt"); } }

        /// Also keeps a log file (no token in it), so problems can be checked after the game.
        static void WriteLogFile(string text)
        {
            try
            {
                lock (fileLock)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(LogFile));
                    var fi = new FileInfo(LogFile);
                    if (fi.Exists && fi.Length > 512 * 1024)
                    {
                        var keep = File.ReadAllLines(LogFile, Encoding.UTF8);
                        File.WriteAllLines(LogFile, keep.Skip(keep.Length / 2).ToArray(), Encoding.UTF8);
                    }
                    File.AppendAllText(LogFile, DateTime.Now.ToString("yyyy-MM-dd ") + text + Environment.NewLine, Encoding.UTF8);
                }
            }
            catch { }
        }

        static readonly string Profile = SafeRead(delegate { return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile); });
        static readonly string Machine = SafeRead(delegate { return Environment.MachineName; });
        static string SafeRead(Func<string> f) { try { return f() ?? ""; } catch { return ""; } }

        /// Error texts from Windows can contain the user folder (with the Windows user name) or the PC name.
        /// Those, and the token, never reach the log file or the Log on the Help page.
        static string Scrub(string line, string token)
        {
            if (string.IsNullOrEmpty(line)) return line ?? "";
            if (!string.IsNullOrEmpty(token) && token.Length >= 6) line = line.Replace(token, "[token]");
            if (Profile.Length > 3) line = Regex.Replace(line, Regex.Escape(Profile), "%USERPROFILE%", RegexOptions.IgnoreCase);
            if (Machine.Length >= 3) line = Regex.Replace(line, @"\b" + Regex.Escape(Machine) + @"\b", "[pc]", RegexOptions.IgnoreCase);
            return line;
        }

        void Log(string line)
        {
            line = Scrub(line, settings.Token);
            var text = DateTime.Now.ToString("HH:mm:ss") + "  " + line;
            WriteLogFile(text);
            var saved = ReportSent(line);
            ui.Post(delegate
            {
                logLines.Add(text);
                while (logLines.Count > 200) logLines.RemoveAt(0);
                if (form != null && !form.IsDisposed) form.AddLog(text);
                if (saved && settings.ResultAlerts) ShowToast("\uE930", Theme.Good, "Result saved", "Your custom game is on the site.");
            }, null);
        }

        /// The Watcher logs what the server answered; mirror it into "Last sent" for Home. True when a result was saved.
        static bool ReportSent(string line)
        {
            if (line.StartsWith("Sent: ") || line == "Sending the game" || line.StartsWith("Game over"))
            {
                HelperStatus.SetSent(true, line.StartsWith("Sent: ") ? line.Substring(6) : line);
                return line == "Game over, everything sent";
            }
            if (line.StartsWith("Not sent: ")) HelperStatus.SetSent(false, line.Substring(10));
            return false;
        }

        void Status(string s)
        {
            ReportLeague(s);
            ui.Post(delegate
            {
                if (s == statusText) return;
                statusText = s;
                var t = Program.Title + ": " + s;
                icon.Text = t.Length > 63 ? t.Substring(0, 63) : t;
                if (form != null && !form.IsDisposed) form.SetStatus(s);
            }, null);
        }

        /// The Watcher reports its state as text; turn it into the Status page's League card.
        /// "Paused" says nothing about League, so the last known state stays.
        static void ReportLeague(string s)
        {
            if (s == "Paused") return;
            if (s == "Waiting for the League client") { HelperStatus.SetLeague(false, "", false); return; }
            const string custom = "Custom game: ";
            if (s.StartsWith(custom)) HelperStatus.SetLeague(true, s.Substring(custom.Length), true);
            else HelperStatus.SetLeague(true, "", false); // "Connected to the League client", "Not a custom game"
        }

        void SetPaused(bool p)
        {
            settings.Paused = p;
            pauseItem.Checked = p;
            try { settings.Save(); } catch { }
            Log(p ? "Paused: nothing is sent" : "Sending again");
            if (form != null && !form.IsDisposed) form.SetPaused(p);
            if (mini != null && !mini.IsDisposed && mini.Visible) mini.RefreshNow();
        }

        /* ---------------------------------------------------------------- windows */

        void ShowWindow()
        {
            if (form == null || form.IsDisposed) form = new MainWindow(settings, logLines, SetPaused, Log, ShowMini);
            if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal;
            form.Show();
            form.Activate();
            if (!settings.TourDone) form.ShowTour();
        }

        void ShowPage(Func<MainWindow, Page> page)
        {
            ShowWindow();
            form.ShowPage(page(form));
        }

        void ShowMini()
        {
            if (mini == null || mini.IsDisposed) mini = new MiniWindow(settings, ShowWindow);
            if (form != null && !form.IsDisposed) form.Hide();
            mini.Show();
            mini.RefreshNow();
        }

        void ToggleFlyout()
        {
            if (flyout == null || flyout.IsDisposed)
                flyout = new TrayFlyout(settings, ShowWindow, ShowMini, SetPaused, delegate { ShowPage(f => f.GameModeP); });
            if (flyout.Visible) flyout.Hide(); else flyout.ShowNearClock();
        }

        void ShowToast(string glyph, Color color, string title, string text)
        {
            if (toast == null || toast.IsDisposed)
            {
                toast = new Toast();
                toast.Clicked += ShowWindow;
            }
            toast.Pop(glyph, color, title, text);
        }

        void OnNotify(string title, string text) { ShowToast("\uE7E7", Theme.Orange, title, text); }

        /// On-screen "Muted" badge: shown while the mic is muted and the setting is on.
        void UpdateBadge()
        {
            var want = settings.MutedBadge && AudioCtl.MicMuted;
            if (want && (badge == null || badge.IsDisposed)) badge = new MutedBadge();
            if (badge == null || badge.IsDisposed || badge.Visible == want) return;
            if (want) badge.Show(); else badge.Hide();
        }

        void OnPcTick()
        {
            try { PcServices.Tick(); }
            catch (Exception e) { Log("PC features: " + e.Message); }
            UpdateBadge();
            if (flyout != null && !flyout.IsDisposed && flyout.Visible) flyout.RefreshNow();
        }

        /* ---------------------------------------------------------------- exit */

        void Stop()
        {
            if (stopped) return;
            stopped = true;
            pcTimer.Stop();
            timer.Dispose();
            icon.Visible = false;
            icon.Dispose();
            PcServices.Notify -= OnNotify;
            AudioCtl.Changed -= UpdateBadge;
            try { PcServices.Stop(); } catch { }
            foreach (Form f in new Form[] { badge, toast, flyout, mini })
                if (f != null && !f.IsDisposed) f.Dispose();
        }

        void Quit()
        {
            Stop();
            ExitThread();
        }
    }
}
