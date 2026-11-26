// Bridge Night Helper: the Settings and Help pages.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace BridgeNight
{
    class SettingsPage : Page
    {
        InputBox server, token;
        DotLabel connState;
        ToggleSwitch alerts, autostart, paused, autoUpdate, live, record;
        Segmented every;
        Label version, updState;
        FlatButton check;
        bool syncing;

        public SettingsPage(MainWindow w) : base(w, "Settings")
        {
            Heading("Settings", "Settings");
            const int col = 382, right = X0 + 394;

            var conn = Ui.Card(this, "Connection", X0, Y0, col, 276);
            connState = new DotLabel { Bounds = Theme.R(180, 14, 186, 22), Font = Theme.Small, ForeColor = Theme.Good, BackColor = Theme.Card, TextAlign = ContentAlignment.MiddleRight };
            conn.Controls.Add(connState);
            L(conn, "Server URL", Theme.Small, Theme.Ink2, 16, 44, 300, 20);
            server = new InputBox("Server URL") { Bounds = Theme.R(14, 64, col - 28, 38) };
            server.Box.Text = S.Server;
            conn.Controls.Add(server);
            L(conn, "Helper token", Theme.Small, Theme.Ink2, 16, 110, 300, 20);
            token = new InputBox("Helper token") { Bounds = Theme.R(14, 130, col - 28, 38) };
            token.Box.Text = S.Token;
            token.Box.UseSystemPasswordChar = true;
            conn.Controls.Add(token);
            L(conn, "Make it on the site's Helper page. Stored encrypted for your Windows account.", Theme.Small, Theme.Mute, 16, 174, col - 32, 40);
            var test = Ui.ButtonRight(conn, "Save and test", true, col - 14, 226);
            test.Click += delegate { if (SaveConnection()) TestConnection(); };
            var save = Ui.ButtonRight(conn, "Save", false, 0, 226);
            save.Left = test.Left - Theme.Px(8) - save.Width;
            save.Click += delegate { SaveConnection(); };

            var al = Ui.Card(this, "Alerts", X0, Y0 + 290, col, 96);
            alerts = Ui.SwitchRow(al, null, "Pop-up when a result is saved", null, 42, col);
            alerts.CheckedChanged += delegate { if (!syncing) { S.ResultAlerts = alerts.Checked; Save(); } };

            var win = Ui.Card(this, null, X0, Y0 + 400, col, 144);
            autostart = Ui.SwitchRow(win, null, "Start with Windows", "When you sign in", 14, col);
            autostart.CheckedChanged += delegate
            {
                if (syncing) return;
                try { Settings.Autostart = autostart.Checked; }
                catch (Exception e) { MessageBox.Show("Could not change that: " + e.Message, Program.Title); }
            };
            Ui.Divider(win, 16, 72, col - 32);
            paused = Ui.SwitchRow(win, null, "Pause sending games", "Same as Pause in the tray menu", 84, col);
            paused.CheckedChanged += delegate { if (!syncing) Win.SetPausedAction(paused.Checked); };

            var ver = Ui.Card(this, null, right, Y0, col, 168);
            ver.Paint += delegate (object o, PaintEventArgs e)
            {
                e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                Theme.DrawLogo(e.Graphics, Theme.R(16, 18, 48, 48));
            };
            version = L(ver, "Version " + Program.Version, Theme.Strong, Theme.Ink, 78, 18, 180, 24);
            updState = L(ver, "", Theme.Small, Theme.Mute, 78, 42, 180, 40);
            check = Ui.ButtonRight(ver, "Check now", false, col - 16, 22);
            check.Click += delegate
            {
                if (Updater.NewVersion != "") InstallUpdate(Win);
                else { Updater.CheckNow(); Ui.Set(updState, "Checking…"); }
            };
            Ui.Divider(ver, 16, 96, col - 32);
            autoUpdate = Ui.SwitchRow(ver, null, "Update automatically", "Never during a game", 106, col);
            autoUpdate.CheckedChanged += delegate { if (!syncing) { S.AutoUpdate = autoUpdate.Checked; Save(); } };

            var perf = Ui.Card(this, "Performance", right, Y0 + 182, col, 204);
            live = Ui.SwitchRow(perf, null, "Live measuring", null, 40, col);
            live.CheckedChanged += delegate { if (!syncing) { S.LiveMeasure = live.Checked; Save(); } };
            Ui.Divider(perf, 16, 88, col - 32);
            L(perf, "Measure every", Theme.Body, Theme.Ink, 16, 104, 200, 24).TextAlign = ContentAlignment.MiddleLeft;
            every = new Segmented("Measure every", new[] { "1s", "2s", "5s" }, 9);
            every.Location = new Point(Theme.Px(col - 16) - every.Width, Theme.Px(99));
            every.Changed += delegate
            {
                if (syncing) return;
                S.MeasureEvery = every.Selected == 0 ? 1 : every.Selected == 1 ? 2 : 5;
                PerfMon.IntervalSeconds = S.MeasureEvery;
                Save();
            };
            perf.Controls.Add(every);
            Ui.Divider(perf, 16, 144, col - 32);
            record = Ui.SwitchRow(perf, null, "Record last game", null, 152, col);
            record.CheckedChanged += delegate { if (!syncing) { S.RecordLastGame = record.Checked; Save(); } };

            Ui.Icon(this, "\uEA18", Theme.Good, right, Y0 + 404);
            L(this, "Reads the League client, never controls it. Custom games only.", Theme.Small, Theme.Mute, right + 30, Y0 + 402, 240, 40);
            Ui.Link(this, "Source on GitHub", right + col, Y0 + 402).Click += delegate { Ui.Open(MainWindow.RepoUrl); };
        }

        void Save() { try { S.Save(); } catch (Exception e) { Win.Log("Could not save settings: " + e.Message); } }

        /// Update now: asks the Updater; it refuses during a game and says why.
        public static void InstallUpdate(MainWindow win)
        {
            string note;
            var ok = Updater.InstallNow(out note);
            if (!ok) MessageBox.Show(win, string.IsNullOrEmpty(note) ? "The update could not start. The Log on the Help page says why." : note, Program.Title);
            win.Log("Update now: " + (ok ? "started" : "not started") + (string.IsNullOrEmpty(note) ? "" : " (" + note + ")"));
        }

        bool SaveConnection()
        {
            var url = server.Box.Text.Trim();
            if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                MessageBox.Show(this, "The server URL must start with https://", Program.Title);
                return false;
            }
            S.Server = url;
            S.Token = token.Box.Text.Trim();
            try { S.Save(); Win.Log("Settings saved"); return true; }
            catch (Exception e) { MessageBox.Show(this, "Could not save: " + e.Message, Program.Title); return false; }
        }

        void TestConnection()
        {
            var s = S;
            var log = Win.Log;
            Ui.Set(connState, "Testing…");
            ThreadPool.QueueUserWorkItem(delegate
            {
                string note;
                object reply;
                int code;
                var d = new Dictionary<string, object>();
                d["type"] = "hello";
                var ok = Watcher.Post(s, d, out note, out reply, out code);
                log("Connection test: " + note);
                HelperStatus.SetSent(ok, "Connection test: " + note);
                try { BeginInvoke((Action)delegate { Tick(); MessageBox.Show(this, ok ? "Works! " + note : "Not working: " + note, Program.Title); }); }
                catch (InvalidOperationException) { } // window closed meanwhile
            });
        }

        public void SyncPaused(bool p) { syncing = true; paused.Checked = p; syncing = false; }

        public override void Shown()
        {
            syncing = true;
            alerts.Checked = S.ResultAlerts;
            try { autostart.Checked = Settings.Autostart; } catch { }
            paused.Checked = S.Paused;
            autoUpdate.Checked = S.AutoUpdate;
            live.Checked = S.LiveMeasure;
            every.Selected = S.MeasureEvery == 1 ? 0 : S.MeasureEvery == 5 ? 2 : 1;
            record.Checked = S.RecordLastGame;
            syncing = false;
        }

        public override void Tick()
        {
            var st = HelperStatus.Read();
            if (connState.Text != "Testing…" || st.ServerOk.HasValue)
            {
                if (string.IsNullOrEmpty(S.Token)) { Ui.Set(connState, "No token yet", Theme.Warn); connState.Dot = Theme.Warn; }
                else if (st.ServerOk == true) { Ui.Set(connState, "Connected", Theme.Good); connState.Dot = Theme.Good; }
                else if (st.ServerOk == false) { Ui.Set(connState, "Not connected", Theme.Bad); connState.Dot = Theme.Bad; }
                else { Ui.Set(connState, "Not checked yet", Theme.Mute); connState.Dot = Theme.Mute; }
            }
            connState.Width = Math.Min(Theme.Px(186), TextRenderer.MeasureText(connState.Text, connState.Font).Width + Theme.Px(24));
            connState.Left = connState.Parent.Width - Theme.Px(16) - connState.Width;
            var nv = Updater.NewVersion;
            Ui.Set(version, nv != "" ? "Version " + nv.TrimStart('v', 'V') + " is ready" : "Version " + Program.Version);
            Ui.Set(updState, nv != "" ? "You have " + Program.Version + ". " + Updater.State : Updater.State == "" ? "Checks GitHub on start and once a day." : Updater.State);
            check.Text = nv != "" ? "Update now" : "Check now";
            check.Primary = nv != "";
            check.FitWidth();
            check.Left = check.Parent.Width - Theme.Px(16) - check.Width;
            updState.Width = check.Left - updState.Left - Theme.Px(8);
            version.Width = updState.Width;
        }
    }

    /// One heading of the Help accordion.
    class HelpRow : PaintedControl
    {
        readonly string glyph;
        public bool Open;

        public HelpRow(string text, string glyph)
        {
            Text = text;
            this.glyph = glyph;
            AccessibleName = text;
            Size = new Size(Theme.Px(438), Theme.Px(46));
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            var ink = Hover || Open ? Theme.Ink : Theme.Ink2;
            if (Hover) using (var path = Theme.Round(new RectangleF(0, Theme.Px(3), Width - 1, Height - Theme.Px(6)), Theme.Px(Theme.ControlRadius)))
                using (var b = new SolidBrush(Theme.NavActive)) { g.SmoothingMode = SmoothingMode.AntiAlias; g.FillPath(b, path); }
            TextRenderer.DrawText(g, glyph, Theme.Glyph, new Rectangle(Theme.Px(8), 0, Theme.Px(24), Height), ink, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, Text, Theme.Body, new Rectangle(Theme.Px(44), 0, Width - Theme.Px(80), Height), Theme.Ink, TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
            TextRenderer.DrawText(g, Open ? "\uE70D" : "\uE76C", Theme.GlyphSmall, new Rectangle(Width - Theme.Px(34), 0, Theme.Px(24), Height), Theme.Mute,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            Ring(g, new RectangleF(Theme.Px(2), Theme.Px(4), Width - Theme.Px(4), Height - Theme.Px(8)), Theme.Px(Theme.ControlRadius));
        }
    }

    class HelpPage : Page
    {
        static readonly string[][] FairPlay =
        {
            new[] { "Reads, never controls", "It only reads the League client on this PC. It never clicks, picks or changes anything." },
            new[] { "No champions during champ select", "Picks are sent on the loading screen, once everyone can see them. Nothing the client hides is shown." },
            new[] { "Custom games only", "Normal, ranked and other queue games are ignored. Only custom games go to Bridge Night." },
        };

        static readonly string[][] Sections =
        {
            new[] { "Home", "\uE80F", "Home shows whether the League client, this helper and the site are connected. The tiles mute your mic, switch the sound output and show game mode and updates. \"Last sent\" is what reached the site. Below: your ping to EUW, how busy this PC is, and how it handled your last game." },
            new[] { "Performance", "\uE9D9", "Live shows processor, graphics card, memory and graphics memory while the page is open. Last game is a light record of your last custom game and says what held your PC back. Apps lists what uses the most memory (Close asks the app politely) and what starts with Windows. Measuring stops when you leave the page; switch it off or slow it down with Measure and 1s / 2s / 5s." },
            new[] { "Network", "\uE839", "Ping, jitter and packet loss to the EUW game server, measured once a second while the page is open. \"Where the time goes\" checks each step (this PC, your router, your internet provider, Riot), so you can see where lag comes from." },
            new[] { "Game mode", "\uE7FC", "Before game night lists things to sort out first, like a pending Windows restart. When a game starts, the helper can turn music down (if you switch that on) and puts it back after the game. Gamer fixes change one Windows setting for your account only. No admin rights are needed." },
            new[] { "Audio", "\uE7F6", "Ctrl+Alt+M mutes your microphone in Windows, so every app goes quiet at once. Ctrl+Alt+H switches between headset, speakers and monitor. A short sound and a small \"Muted\" badge show when you are muted; both can be switched off." },
            new[] { "Settings", "\uE713", "Your helper token connects this PC to your Bridge Night account; make it on the site's Helper page. Updates come from GitHub, are checked with their SHA-256 fingerprint and install by themselves, never during a game. Switch that off to update by hand." },
            new[] { "Fair play", "\uEA18", "" },
        };

        readonly List<HelpRow> rows = new List<HelpRow>();
        readonly Label body;
        readonly Card accordion;
        int open = -1;
        readonly ListBox logBox = new ListBox();
        FlatButton copy;
        readonly System.Windows.Forms.Timer copied = new System.Windows.Forms.Timer { Interval = 1500 };

        public HelpPage(MainWindow w, List<string> lines) : base(w, "Help")
        {
            Heading("Help", null);
            var tour = Ui.ButtonRight(this, "Replay the tour", false, X0 + W0, 22);
            tour.Glyph = "\uE768";
            tour.FitWidth();
            tour.Left = Theme.Px(X0 + W0) - tour.Width;
            tour.Click += delegate { Win.ShowPage(Win.Home); Win.ShowTour(); };

            accordion = Ui.Card(this, null, X0, Y0, 470, 544);
            body = L(accordion, "", Theme.Body, Theme.Ink2, 60, 0, 390, 100);
            body.Visible = false;
            for (var i = 0; i < Sections.Length; i++)
            {
                var row = new HelpRow(Sections[i][0], Sections[i][1]) { Left = Theme.Px(16) };
                var k = i;
                row.Click += delegate { Toggle(k); };
                accordion.Controls.Add(row);
                rows.Add(row);
            }
            Layout2();

            const int rx = X0 + 482, rw = 294;
            var keys = Ui.Card(this, "Hotkeys", rx, Y0, rw, 120);
            KeyRow(keys, "Mute or unmute mic", new[] { "Ctrl", "Alt", "M" }, 44, rw);
            KeyRow(keys, "Next sound output", new[] { "Ctrl", "Alt", "H" }, 80, rw);

            var site = Ui.Card(this, "Launcher or site?", rx, Y0 + 132, rw, 140);
            L(site, "Teams, history, stats, rivals and builds live on the site. The helper only does what needs your PC.",
                Theme.Small, Theme.Ink2, 16, 42, rw - 32, 60);
            Ui.Link(site, "Open the site  ↗", rw - 12, 104).Click += delegate { Ui.Open(MainWindow.SiteUrl); };

            var log = Ui.Card(this, "Log", rx, Y0 + 284, rw, 186);
            var folder = Ui.ButtonRight(log, "Open folder", false, rw - 12, 8);
            folder.Click += delegate
            {
                try { Directory.CreateDirectory(Settings.Dir); Process.Start("explorer.exe", "\"" + Settings.Dir + "\""); }
                catch (Exception e) { MessageBox.Show("Could not open the folder: " + e.Message, Program.Title); }
            };
            copy = Ui.ButtonRight(log, "Copy", false, 0, 8);
            copy.Left = folder.Left - Theme.Px(6) - copy.Width;
            copy.Click += delegate { CopyLog(); };
            copied.Tick += delegate { copied.Stop(); copy.Text = "Copy"; };
            logBox.Bounds = Theme.R(12, 50, rw - 22, 126);
            logBox.BorderStyle = BorderStyle.None;
            logBox.BackColor = Theme.Card;
            logBox.ForeColor = Theme.Ink;
            logBox.IntegralHeight = false;
            logBox.HorizontalScrollbar = false;
            logBox.DrawMode = DrawMode.OwnerDrawFixed;
            logBox.ItemHeight = Theme.Px(22);
            logBox.AccessibleName = "Log messages";
            logBox.DrawItem += DrawLogLine;
            // Dark scroll bars on Windows 10/11; older versions keep the default ones.
            logBox.HandleCreated += delegate { try { SetWindowTheme(logBox.Handle, "DarkMode_Explorer", null); } catch { } };
            foreach (var l in lines) AddLogItem(l);
            log.Controls.Add(logBox);
            ScrollLog();

            var stuck = Ui.Card(this, null, rx, Y0 + 482, rw, 62);
            Ui.Icon(stuck, "\uE8BD", Theme.Ink2, 14, 19);
            L(stuck, "Still stuck?", Theme.Strong, Theme.Ink, 48, 10, 140, 22);
            L(stuck, "Ask in our Discord", Theme.Small, Theme.Mute, 48, 32, 150, 20);
            Ui.ButtonRight(stuck, "Discord  ↗", false, rw - 12, 14).Click += delegate { Ui.Open(MainWindow.DiscordUrl); };
        }

        static void KeyRow(Control card, string text, string[] keys, int y, int w)
        {
            L(card, text, Theme.Body, Theme.Ink, 16, y, 150, 26).TextAlign = ContentAlignment.MiddleLeft;
            var k = new KeysView(keys);
            k.Location = new Point(Theme.Px(w - 16) - k.Width, Theme.Px(y + 1));
            card.Controls.Add(k);
        }

        static string SectionText(int i)
        {
            if (Sections[i][0] != "Fair play") return Sections[i][2];
            var parts = new List<string>();
            foreach (var f in FairPlay) parts.Add(f[0] + ". " + f[1]);
            return string.Join("\n\n", parts);
        }

        void Toggle(int i) { open = open == i ? -1 : i; Layout2(); }

        /// Opens the section of that name (the "?" next to a page title).
        public void Open(string section)
        {
            for (var i = 0; i < Sections.Length; i++) if (Sections[i][0] == section) open = i;
            Layout2();
        }

        void Layout2()
        {
            var y = Theme.Px(10);
            for (var i = 0; i < rows.Count; i++)
            {
                rows[i].Top = y;
                rows[i].Open = i == open;
                rows[i].AccessibleDescription = i == open ? "Open" : "Closed";
                rows[i].Invalidate();
                y += rows[i].Height;
                if (i == open)
                {
                    body.Text = SectionText(i);
                    var size = TextRenderer.MeasureText(body.Text, body.Font, new Size(body.Width, 1000), TextFormatFlags.WordBreak);
                    body.Height = size.Height + Theme.Px(4);
                    body.Top = y;
                    y += body.Height + Theme.Px(12);
                }
            }
            body.Visible = open >= 0;
        }

        /* ---------------------------------------------------------------- log */

        [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)]
        static extern int SetWindowTheme(IntPtr hwnd, string appName, string idList);

        void CopyLog()
        {
            if (logBox.Items.Count == 0) return;
            var all = new string[logBox.Items.Count];
            logBox.Items.CopyTo(all, 0);
            try
            {
                Clipboard.SetText(string.Join(Environment.NewLine, all));
                copy.Text = "Copied";
                copied.Start();
            }
            catch (Exception e) { MessageBox.Show("Could not copy: " + e.Message, Program.Title); }
        }

        static void SplitLine(string line, out string time, out string text)
        {
            var i = line.IndexOf("  ", StringComparison.Ordinal);
            time = i > 0 ? line.Substring(0, i) : "";
            text = i > 0 ? line.Substring(i + 2) : line;
        }

        void DrawLogLine(object sender, DrawItemEventArgs e)
        {
            if (e.Index < 0) return;
            var g = e.Graphics;
            var selected = (e.State & DrawItemState.Selected) != 0;
            using (var b = new SolidBrush(selected ? Theme.NavActive : Theme.Card)) g.FillRectangle(b, e.Bounds);
            string time, text;
            SplitLine((string)logBox.Items[e.Index], out time, out text);
            var tw = Theme.Px(66);
            var bad = text.IndexOf("error", StringComparison.OrdinalIgnoreCase) >= 0 || text.IndexOf("fail", StringComparison.OrdinalIgnoreCase) >= 0 ||
                text.StartsWith("Not sent:", StringComparison.OrdinalIgnoreCase) || text.StartsWith("Connection test: Not", StringComparison.OrdinalIgnoreCase);
            const TextFormatFlags flags = TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis;
            TextRenderer.DrawText(g, time, Theme.Mono, new Rectangle(e.Bounds.X + Theme.Px(4), e.Bounds.Y, tw, e.Bounds.Height), Theme.Mute, flags);
            TextRenderer.DrawText(g, text, Theme.Small, new Rectangle(e.Bounds.X + Theme.Px(4) + tw, e.Bounds.Y, Math.Max(1, e.Bounds.Width - tw), e.Bounds.Height),
                bad ? Theme.Bad : Theme.Ink, flags);
        }

        void AddLogItem(string line)
        {
            logBox.Items.Add(line);
            string time, text;
            SplitLine(line, out time, out text);
        }

        public void AddLog(string line) { AddLogItem(line); while (logBox.Items.Count > 200) logBox.Items.RemoveAt(0); ScrollLog(); }
        void ScrollLog() { if (logBox.Items.Count > 0) logBox.TopIndex = logBox.Items.Count - 1; }

        protected override void Dispose(bool disposing) { if (disposing) copied.Dispose(); base.Dispose(disposing); }
    }
}
