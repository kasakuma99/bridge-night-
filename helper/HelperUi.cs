// Bridge Night Helper: tray icon and log. Window: UiWindow.cs, controls: UiControls.cs, look: UiTheme.cs. Logic: BridgeNightHelper.cs.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.Security;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace BridgeNight
{
    /* ------------------------------------------------------------------ tray + settings window */

    class TrayApp : ApplicationContext
    {
        readonly NotifyIcon icon = new NotifyIcon();
        readonly Settings settings = Settings.Load();
        readonly List<string> logLines = new List<string>();
        readonly SynchronizationContext ui;
        readonly System.Threading.Timer timer;
        readonly Watcher watcher;
        readonly ToolStripMenuItem pauseItem;
        SettingsForm form;
        string statusText = "Starting";

        public TrayApp()
        {
            ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            icon.Icon = Theme.SmallIcon;
            icon.Text = Program.Title;
            var menu = new ContextMenuStrip();
            menu.Items.Add("Settings and log", null, delegate { ShowSettings(); });
            pauseItem = new ToolStripMenuItem("Pause sending", null, delegate { SetPaused(!settings.Paused); });
            pauseItem.Checked = settings.Paused;
            menu.Items.Add(pauseItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Exit", null, delegate { Quit(); });
            icon.ContextMenuStrip = menu;
            icon.DoubleClick += delegate { ShowSettings(); };
            icon.Visible = true;

            watcher = new Watcher(settings, Log, Status);
            Log(Program.Title + " " + Program.Version + " started");
            timer = new System.Threading.Timer(delegate { watcher.Tick(); }, null, 1000, 1500);
            if (string.IsNullOrEmpty(settings.Token)) ShowSettings();
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

        void Log(string line)
        {
            var text = DateTime.Now.ToString("HH:mm:ss") + "  " + line;
            WriteLogFile(text);
            ui.Post(delegate
            {
                logLines.Add(text);
                while (logLines.Count > 200) logLines.RemoveAt(0);
                if (form != null && !form.IsDisposed) form.AddLog(text);
            }, null);
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
        }

        void ShowSettings()
        {
            if (form == null || form.IsDisposed)
            {
                form = new SettingsForm(settings, logLines, statusText, SetPaused, Log);
            }
            form.Show();
            form.Activate();
        }

        void Quit()
        {
            timer.Dispose();
            icon.Visible = false;
            icon.Dispose();
            ExitThread();
        }
    }
}
