// Bridge Night Helper: the main window (sidebar + Status, Setup, Settings, Log and About pages).
// Layout is in 96-dpi pixels; AutoScaleMode.Dpi scales it, painting code scales with Theme.Px.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace BridgeNight
{
    class SettingsForm : Form
    {
        const string ReleasesUrl = "https://github.com/kasakuma99/bridge-night-/releases";
        const string RepoUrl = "https://github.com/kasakuma99/bridge-night-";
        const int SidebarWidth = 220, PageWidth = 740, PageHeight = 620, Inner = 676, Left0 = 32, Top0 = 104;
        static readonly Font StepTitle = new Font("Segoe UI Semibold", 12f);

        static readonly string[][] SetupSteps =
        {
            new[] { "Paste token", "Make it on the site's Helper page, then paste it in Settings." },
            new[] { "Save and test", "Click \"Save and test connection\" on the Settings page." },
            new[] { "Play", "Keep the BN icon by the clock running. Custom games only." },
        };

        static readonly string[][] FairPlay =
        {
            new[] { "Reads, never controls", "It only reads the League client on this PC. It never clicks, picks or changes anything." },
            new[] { "No champions during champ select", "Picks are sent on the loading screen, once everyone can see them. Nothing the client hides is shown." },
            new[] { "Custom games only", "Normal, ranked and other queue games are ignored. Only custom games go to Bridge Night." },
        };

        readonly Settings settings;
        readonly Action<bool> onPause;
        readonly Action<string> log;
        readonly List<NavItem> nav = new List<NavItem>();
        readonly List<Control> pages = new List<Control>();
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();

        // Settings page
        InputBox server, token;
        ToggleSwitch paused, autostart;
        bool syncing;
        // Status page
        Card banner, leagueCard, serverCard, queueCard, sendCard;
        Label bannerTitle, phaseValue, customValue, sentValue, sentWhat, errorText, queueText, sendTitle, sendText;
        string lastLog;
        DotLabel leagueBig, serverBig, footer;
        Gauge cpuGauge, gpuGauge;
        int hwTick;
        const int GaugeTop = 446;
        FlatButton pauseButton, copyButton;
        // Log page
        readonly ListBox logBox = new ListBox();
        int logExtent;
        DateTime copiedUntil;

        public SettingsForm(Settings s, List<string> lines, string statusText, Action<bool> onPause, Action<string> log)
        {
            settings = s;
            this.onPause = onPause;
            this.log = log;

            SuspendLayout();
            AutoScaleDimensions = new SizeF(96f, 96f);
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = Theme.Body;
            Text = Program.Title + " " + Program.Version;
            Icon = Theme.LargeIcon;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(SidebarWidth + PageWidth, PageHeight);
            BackColor = Theme.Sidebar;
            ForeColor = Theme.Ink;
            DoubleBuffered = true;

            BuildSidebar(statusText);
            BuildStatus();
            BuildSetup();
            BuildSettings();
            BuildLog(lines);
            BuildAbout();
            ResumeLayout(false);

            ShowPage(string.IsNullOrEmpty(s.Token) ? 1 : 0);
            UpdatePauseUi();
            RefreshStatus();
            timer.Interval = 500;
            timer.Tick += delegate
            {
                RefreshStatus();
                // CPU/GPU gauges: once a second, and only while the window is open (no cost in the tray).
                if (Visible && ++hwTick % 2 == 0)
                {
                    cpuGauge.Value = HwMonitor.CpuPercent();
                    gpuGauge.Value = HwMonitor.GpuPercent();
                }
            };
            timer.Start();
        }

        /* ------------------------------------------------------------ building blocks */

        static Label AddLabel(Control parent, string text, Font font, Color color, int x, int y, int w, int h)
        {
            var l = new Label { Text = text, Font = font, ForeColor = color, Bounds = new Rectangle(x, y, w, h), AutoEllipsis = true, UseMnemonic = false };
            if (parent is SkyPanel) l.BackColor = Color.Transparent;
            parent.Controls.Add(l);
            return l;
        }

        static Card AddCard(Control parent, string title, int x, int y, int w, int h)
        {
            var c = new Card(title) { Bounds = new Rectangle(x, y, w, h) };
            parent.Controls.Add(c);
            return c;
        }

        static void AddDivider(Control parent, int x, int y, int w)
        {
            parent.Controls.Add(new Panel { BackColor = Theme.Border, Bounds = new Rectangle(x, y, w, 1) });
        }

        /// A "Name ........ value" row; returns the value label.
        static Label AddRow(Control parent, string name, int y)
        {
            AddLabel(parent, name, Theme.Body, Theme.Mute, 20, y, 130, 24).TextAlign = ContentAlignment.MiddleLeft;
            var v = AddLabel(parent, "", Theme.Strong, Theme.Ink, 150, y, parent.Width - 170, 24);
            v.TextAlign = ContentAlignment.MiddleRight;
            v.AccessibleName = name;
            return v;
        }

        static FlatButton AddButton(Control parent, string text, bool primary, int x, int y)
        {
            var b = new FlatButton(text, primary) { Location = new Point(x, y) };
            parent.Controls.Add(b);
            return b;
        }

        SkyPanel AddPage(string title, string subtitle)
        {
            var p = new SkyPanel { Bounds = new Rectangle(SidebarWidth, 0, PageWidth, PageHeight), Visible = false, AccessibleName = title, AccessibleRole = AccessibleRole.PropertyPage };
            AddLabel(p, title, Theme.H1, Theme.Ink, Left0, 26, Inner, 40);
            AddLabel(p, subtitle, Theme.Body, Theme.Mute, Left0, 66, Inner, 24);
            Controls.Add(p);
            pages.Add(p);
            return p;
        }

        static void GradientText(Graphics g, string text, string family, FontStyle style, float pt, PointF at)
        {
            using (var f = new FontFamily(family))
            using (var path = new GraphicsPath())
            {
                path.AddString(text, f, (int)style, pt * 96f / 72f * Theme.Scale, at, StringFormat.GenericTypographic);
                using (var b = Theme.Sunset(path.GetBounds(), 0f)) g.FillPath(b, path);
            }
        }

        static void Open(string url)
        {
            try { Process.Start(url); } catch (Exception e) { MessageBox.Show("Could not open the browser: " + e.Message, "Bridge Night Helper"); }
        }

        /* ------------------------------------------------------------ sidebar */

        void BuildSidebar(string statusText)
        {
            var side = new Panel { Bounds = new Rectangle(0, 0, SidebarWidth, PageHeight), BackColor = Theme.Sidebar };
            side.Paint += delegate (object o, PaintEventArgs e)
            {
                var g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                Theme.DrawMark(g, new RectangleF(Theme.Px(20), Theme.Px(24), Theme.Px(38), Theme.Px(38)));
                GradientText(g, "Bridge Night", "Segoe UI Semibold", FontStyle.Regular, 13f, new PointF(Theme.Px(68), Theme.Px(24)));
                TextRenderer.DrawText(g, "Helper  v" + Program.Version, Theme.Small, new Point(Theme.Px(68), Theme.Px(46)), Theme.Mute);
                TextRenderer.DrawText(g, "THIS PC", Theme.Caps, new Point(Theme.Px(22), Theme.Px(GaugeTop - 24)), Theme.Mute);
                using (var p = new Pen(Theme.Border)) g.DrawLine(p, side.Width - 1, 0, side.Width - 1, side.Height);
            };
            string[][] items = { new[] { "Status", "\uE9D9" }, new[] { "Setup", "\uE9D5" }, new[] { "Settings", "\uE713" }, new[] { "Log", "\uE8A5" }, new[] { "About", "\uE946" } };
            for (var i = 0; i < items.Length; i++)
            {
                var item = new NavItem(items[i][0], items[i][1]) { Location = new Point(12, 92 + i * 46) };
                var page = i;
                item.Click += delegate { ShowPage(page); };
                side.Controls.Add(item);
                nav.Add(item);
            }
            cpuGauge = new Gauge("CPU") { Bounds = new Rectangle(22, GaugeTop, 80, 80), BackColor = Theme.Sidebar };
            gpuGauge = new Gauge("GPU") { Bounds = new Rectangle(118, GaugeTop, 80, 80), BackColor = Theme.Sidebar };
            side.Controls.Add(cpuGauge);
            side.Controls.Add(gpuGauge);
            footer = new DotLabel { Bounds = new Rectangle(20, PageHeight - 48, SidebarWidth - 36, 24), Font = Theme.Small, ForeColor = Theme.Mute, Text = statusText, AccessibleName = "Helper status" };
            side.Controls.Add(footer);
            Controls.Add(side);
        }

        void ShowPage(int index)
        {
            for (var i = 0; i < pages.Count; i++)
            {
                pages[i].Visible = i == index;
                nav[i].Selected = i == index;
            }
        }

        /* ------------------------------------------------------------ status page */

        void BuildStatus()
        {
            var p = AddPage("Status", "What the helper sees right now. Updates by itself.");

            banner = AddCard(p, null, Left0, Top0, Inner, 64);
            banner.Glow = true;
            banner.Visible = false;
            bannerTitle = AddLabel(banner, "", Theme.Strong, Theme.Ink, 20, 11, 440, 22);
            AddLabel(banner, "A newer Bridge Night Helper is ready on GitHub.", Theme.Small, Theme.Mute, 20, 33, 440, 20);
            var get = new FlatButton("Get the update", true);
            get.Location = new Point(Inner - 17 - get.Width, 11);
            get.Click += delegate { Open(ReleasesUrl); };
            banner.Controls.Add(get);

            const int half = 330, right = Left0 + half + 16;
            leagueCard = AddCard(p, "League client", Left0, Top0, half, 210);
            leagueBig = new DotLabel { Bounds = new Rectangle(20, 42, half - 40, 32), Font = Theme.Big, ForeColor = Theme.Ink, AccessibleName = "League client" };
            leagueCard.Controls.Add(leagueBig);
            AddDivider(leagueCard, 20, 86, half - 40);
            phaseValue = AddRow(leagueCard, "Phase", 100);
            customValue = AddRow(leagueCard, "Custom game", 130);
            AddLabel(leagueCard, "Only custom games are sent.", Theme.Small, Theme.Mute, 20, 170, half - 40, 20);

            serverCard = AddCard(p, "Server", right, Top0, half, 210);
            serverBig = new DotLabel { Bounds = new Rectangle(20, 42, half - 40, 32), Font = Theme.Big, ForeColor = Theme.Ink, AccessibleName = "Server" };
            serverCard.Controls.Add(serverBig);
            AddDivider(serverCard, 20, 86, half - 40);
            sentValue = AddRow(serverCard, "Last check", 100);
            sentWhat = AddLabel(serverCard, "", Theme.Small, Theme.Mute, 20, 128, half - 40, 20);
            errorText = AddLabel(serverCard, "", Theme.Small, Theme.Mute, 20, 154, half - 40, 40);

            queueCard = AddCard(p, "Last message", Left0, Top0 + 226, half, 160);
            queueText = AddLabel(queueCard, "Nothing yet.", Theme.Body, Theme.Ink, 20, 40, half - 40, 100);
            queueText.AccessibleName = "Last message from the helper";

            sendCard = AddCard(p, "Sending", right, Top0 + 226, half, 160);
            sendTitle = AddLabel(sendCard, "", Theme.Big, Theme.Ink, 20, 38, half - 40, 30);
            sendText = AddLabel(sendCard, "", Theme.Small, Theme.Mute, 20, 68, half - 40, 20);
            pauseButton = AddButton(sendCard, "Pause sending", false, 17, 100);
            pauseButton.Size = new Size(half - 34, 46);
            pauseButton.Click += delegate { onPause(!settings.Paused); };
        }

        static void Set(Label l, string text) { if (l.Text != text) l.Text = text; }
        static void Set(Label l, string text, Color color) { Set(l, text); if (l.ForeColor != color) l.ForeColor = color; }

        static string When(DateTime t) { return t.Date == DateTime.Today ? t.ToString("HH:mm:ss") : t.ToString("d MMM, HH:mm"); }

        void RefreshStatus()
        {
            var s = HelperStatus.Read();

            Set(leagueBig, s.LeagueConnected ? "Connected" : "Waiting for League");
            leagueBig.Dot = s.LeagueConnected ? Theme.Teal : Theme.Amber;
            // LCU phases are CamelCase ("ChampSelect"): show them as words.
            Set(phaseValue, string.IsNullOrEmpty(s.Phase) ? "-" : Regex.Replace(s.Phase, "(?<=[a-z])(?=[A-Z])", " "));
            Set(customValue, !s.LeagueConnected ? "-" : s.CustomGame ? "Yes" : "No", s.CustomGame ? Theme.Amber : Theme.Ink);

            if (s.ServerOk == null) { Set(serverBig, "Not checked yet"); serverBig.Dot = Theme.Mute; }
            else if (s.ServerOk.Value) { Set(serverBig, "OK"); serverBig.Dot = Theme.Teal; }
            else { Set(serverBig, "Problem"); serverBig.Dot = Theme.Coral; }
            Set(sentValue, s.LastSentAt.HasValue ? When(s.LastSentAt.Value) : "Nothing yet");
            Set(sentWhat, s.LastSent ?? "");
            if (string.IsNullOrEmpty(s.LastError)) Set(errorText, "No errors.", Theme.Mute);
            else Set(errorText, "Last error: " + s.LastError, Theme.Coral);

            if (lastLog != null) Set(queueText, lastLog);

            var update = !string.IsNullOrEmpty(s.UpdateVersion);
            if (update) Set(bannerTitle, "Update available: v" + s.UpdateVersion.TrimStart('v', 'V'));
            if (banner.Visible != update)
            {
                banner.Visible = update;
                var shift = (update ? 1 : -1) * (banner.Height + Theme.Px(16));
                foreach (var c in new Control[] { leagueCard, serverCard, queueCard, sendCard }) c.Top += shift;
            }

            footer.Dot = settings.Paused ? Theme.Coral : s.LeagueConnected ? Theme.Teal : Theme.Amber;
            if (copiedUntil != DateTime.MinValue && DateTime.Now > copiedUntil) { copyButton.Text = "Copy log"; copiedUntil = DateTime.MinValue; }
        }

        void UpdatePauseUi()
        {
            var p = settings.Paused;
            Set(sendTitle, p ? "Paused" : "Sending is on", p ? Theme.Amber : Theme.Ink);
            Set(sendText, p ? "Nothing is sent until you resume." : "Your custom games go to Bridge Night.");
            pauseButton.Text = p ? "Resume sending" : "Pause sending";
            pauseButton.Primary = p;
        }

        /* ------------------------------------------------------------ setup page */

        void BuildSetup()
        {
            var p = AddPage("Setup", "Three steps, once. After that the helper works on its own.");
            var cards = new List<Card>();
            for (var i = 0; i < SetupSteps.Length; i++)
            {
                var c = AddCard(p, null, Left0, Top0 + i * 104, Inner, 88);
                var number = (i + 1).ToString();
                c.Paint += delegate (object o, PaintEventArgs e)
                {
                    e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    var badge = new RectangleF(Theme.Px(24), Theme.Px(24), Theme.Px(40), Theme.Px(40));
                    using (var b = Theme.Sunset(badge, 45f)) e.Graphics.FillEllipse(b, badge);
                    TextRenderer.DrawText(e.Graphics, number, StepTitle, Rectangle.Round(badge), Theme.OnAccent,
                        TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
                };
                AddLabel(c, SetupSteps[i][0], StepTitle, Theme.Ink, 84, 19, 420, 26).AccessibleName = "Step " + number + ": " + SetupSteps[i][0];
                AddLabel(c, SetupSteps[i][1], Theme.Body, Theme.Mute, 84, 46, i == 0 ? 420 : 572, 24);
                cards.Add(c);
            }
            var open = new FlatButton("Open Settings", false);
            open.Location = new Point(Inner - 17 - open.Width, 23);
            open.Click += delegate { ShowPage(2); };
            cards[0].Controls.Add(open);

            // Short sunset lines join the step badges.
            p.Paint += delegate (object o, PaintEventArgs e)
            {
                using (var pen = new Pen(Color.FromArgb(160, Theme.Amber), 2 * Theme.Scale))
                    for (var i = 0; i + 1 < cards.Count; i++)
                    {
                        var x = cards[i].Left + Theme.Px(44);
                        e.Graphics.DrawLine(pen, x, cards[i].Bottom, x, cards[i + 1].Top);
                    }
            };
        }

        /* ------------------------------------------------------------ settings page */

        void BuildSettings()
        {
            var p = AddPage("Settings", "Connection to the Bridge Night site and how the helper runs.");

            var conn = AddCard(p, "Connection", Left0, Top0, Inner, 216);
            AddLabel(conn, "Server URL", Theme.Strong, Theme.Ink, 20, 40, 300, 22);
            server = new InputBox("Server URL") { Bounds = new Rectangle(17, 62, Inner - 34, 42) };
            server.Box.Text = settings.Server;
            conn.Controls.Add(server);
            AddLabel(conn, "Helper token", Theme.Strong, Theme.Ink, 20, 112, 300, 22);
            token = new InputBox("Helper token") { Bounds = new Rectangle(17, 134, Inner - 34, 42) };
            token.Box.Text = settings.Token;
            token.Box.UseSystemPasswordChar = true;
            conn.Controls.Add(token);
            AddLabel(conn, "Make it on the site's Helper page (\"Your helper token\"). Stored encrypted for your Windows account.",
                Theme.Small, Theme.Mute, 20, 182, Inner - 40, 22);

            var beh = AddCard(p, "Behaviour", Left0, Top0 + 232, Inner, 160);
            paused = AddToggle(beh, "Pause sending", "Nothing is sent while paused. Same as Pause in the tray menu.", 40);
            paused.Checked = settings.Paused;
            paused.CheckedChanged += delegate { if (!syncing) onPause(paused.Checked); };
            AddDivider(beh, 20, 96, Inner - 40);
            autostart = AddToggle(beh, "Start with Windows", "Starts the helper when you sign in to Windows.", 106);
            try { autostart.Checked = Settings.Autostart; } catch { }
            autostart.CheckedChanged += delegate
            {
                try { Settings.Autostart = autostart.Checked; } catch (Exception e) { MessageBox.Show("Could not change that: " + e.Message); }
            };

            var actions = AddCard(p, null, Left0, Top0 + 408, Inner, 68);
            AddLabel(actions, "Saving uses the new settings right away.", Theme.Small, Theme.Mute, 20, 24, 300, 20);
            var test = new FlatButton("Save and test connection", true);
            test.Location = new Point(Inner - 17 - test.Width, 13);
            test.Click += delegate { SaveSettings(); TestConnection(); };
            var save = new FlatButton("Save", false);
            save.Location = new Point(test.Left - 8 - save.Width, 13);
            save.Click += delegate { SaveSettings(); };
            actions.Controls.Add(test);
            actions.Controls.Add(save);
        }

        static ToggleSwitch AddToggle(Control card, string title, string help, int y)
        {
            AddLabel(card, title, Theme.Strong, Theme.Ink, 20, y, 520, 22);
            AddLabel(card, help, Theme.Small, Theme.Mute, 20, y + 23, 540, 20);
            var t = new ToggleSwitch(title) { AccessibleDescription = help };
            t.Location = new Point(card.Width - 15 - t.Width, y + 4);
            card.Controls.Add(t);
            return t;
        }

        void SaveSettings()
        {
            var url = server.Box.Text.Trim();
            if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                MessageBox.Show("The server URL must start with https://", "Bridge Night Helper");
                return;
            }
            settings.Server = url;
            settings.Token = token.Box.Text.Trim();
            try { settings.Save(); log("Settings saved"); }
            catch (Exception e) { MessageBox.Show("Could not save: " + e.Message); }
        }

        void TestConnection()
        {
            var s = settings;
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
                BeginInvoke((Action)delegate { MessageBox.Show(this, ok ? "Works! " + note : "Not working: " + note, Program.Title); });
            });
        }

        /* ------------------------------------------------------------ log page */

        [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)]
        static extern int SetWindowTheme(IntPtr hwnd, string appName, string idList);

        void BuildLog(List<string> lines)
        {
            var p = AddPage("Log", "The last 200 messages. The full log is helper-log.txt in the log folder.");
            var card = AddCard(p, "Last messages", Left0, Top0, Inner, 392);
            logBox.Bounds = new Rectangle(20, 42, Inner - 36, 334);
            logBox.BorderStyle = BorderStyle.None;
            logBox.BackColor = Theme.Surface;
            logBox.ForeColor = Theme.Ink;
            logBox.IntegralHeight = false;
            logBox.HorizontalScrollbar = true;
            logBox.DrawMode = DrawMode.OwnerDrawFixed;
            logBox.ItemHeight = Theme.Px(24);
            logBox.AccessibleName = "Log messages";
            logBox.DrawItem += DrawLogLine;
            // Dark scroll bars on Windows 10/11; older versions keep the default ones.
            logBox.HandleCreated += delegate { try { SetWindowTheme(logBox.Handle, "DarkMode_Explorer", null); } catch { } };
            foreach (var l in lines) AddLogItem(l);
            if (lines.Count > 0) lastLog = lines[lines.Count - 1];
            card.Controls.Add(logBox);

            var actions = AddCard(p, null, Left0, Top0 + 408, Inner, 68);
            AddLabel(actions, "Your helper token is never written to the log.", Theme.Small, Theme.Mute, 20, 24, 320, 20);
            var folder = new FlatButton("Open log folder", false);
            folder.Location = new Point(Inner - 17 - folder.Width, 13);
            folder.Click += delegate
            {
                try
                {
                    var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BridgeNightHelper");
                    Directory.CreateDirectory(dir);
                    Process.Start("explorer.exe", "\"" + dir + "\"");
                }
                catch (Exception e) { MessageBox.Show("Could not open the folder: " + e.Message, "Bridge Night Helper"); }
            };
            copyButton = new FlatButton("Copy log", false);
            copyButton.Location = new Point(folder.Left - 8 - copyButton.Width, 13);
            copyButton.Click += delegate
            {
                if (logBox.Items.Count == 0) return;
                var all = new string[logBox.Items.Count];
                logBox.Items.CopyTo(all, 0);
                try
                {
                    Clipboard.SetText(string.Join(Environment.NewLine, all));
                    copyButton.Text = "Copied";
                    copiedUntil = DateTime.Now.AddSeconds(1.5);
                }
                catch (Exception e) { MessageBox.Show("Could not copy: " + e.Message, "Bridge Night Helper"); }
            };
            actions.Controls.Add(copyButton);
            actions.Controls.Add(folder);
            ScrollLog();
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
            using (var b = new SolidBrush(selected ? Theme.NavActive : Theme.Surface)) g.FillRectangle(b, e.Bounds);
            string time, text;
            SplitLine((string)logBox.Items[e.Index], out time, out text);
            var tw = Theme.Px(78);
            var bad = text.IndexOf("error", StringComparison.OrdinalIgnoreCase) >= 0 || text.IndexOf("fail", StringComparison.OrdinalIgnoreCase) >= 0 ||
                text.StartsWith("Connection test: Not", StringComparison.OrdinalIgnoreCase);
            const TextFormatFlags flags = TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine;
            TextRenderer.DrawText(g, time, Theme.Mono, new Rectangle(e.Bounds.X + Theme.Px(4), e.Bounds.Y, tw, e.Bounds.Height), Theme.Mute, flags);
            TextRenderer.DrawText(g, text, Theme.Body, new Rectangle(e.Bounds.X + Theme.Px(4) + tw, e.Bounds.Y, Math.Max(1, e.Bounds.Width - tw), e.Bounds.Height),
                bad ? Theme.Coral : Theme.Ink, flags);
        }

        void AddLogItem(string line)
        {
            logBox.Items.Add(line);
            string time, text;
            SplitLine(line, out time, out text);
            var w = Theme.Px(90) + TextRenderer.MeasureText(text, Theme.Body).Width;
            if (w > logExtent) { logExtent = w; logBox.HorizontalExtent = w; }
        }

        public void AddLog(string line) { lastLog = line; AddLogItem(line); while (logBox.Items.Count > 200) logBox.Items.RemoveAt(0); ScrollLog(); }
        void ScrollLog() { if (logBox.Items.Count > 0) logBox.TopIndex = logBox.Items.Count - 1; }

        /* ------------------------------------------------------------ about page */

        void BuildAbout()
        {
            var p = AddPage("About", "What the helper does, and what it never does.");
            var hero = AddCard(p, null, Left0, Top0, Inner, 128);
            hero.Paint += delegate (object o, PaintEventArgs e)
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                Theme.DrawMark(e.Graphics, new RectangleF(Theme.Px(24), Theme.Px(24), Theme.Px(80), Theme.Px(80)));
                GradientText(e.Graphics, "Bridge Night Helper", "Segoe UI Semibold", FontStyle.Regular, 20f, new PointF(Theme.Px(124), Theme.Px(24)));
            };
            AddLabel(hero, "Version " + Program.Version, Theme.Body, Theme.Mute, 124, 62, 300, 22);
            AddLabel(hero, "Closing this window keeps it running by the clock. To quit: right-click the BN icon, Exit.",
                Theme.Small, Theme.Mute, 124, 88, 380, 34);
            var gh = new FlatButton("Open on GitHub", false);
            gh.Location = new Point(Inner - 17 - gh.Width, 43);
            gh.Click += delegate { Open(RepoUrl); };
            hero.Controls.Add(gh);

            var fair = AddCard(p, "Fair play", Left0, Top0 + 144, Inner, 252);
            for (var i = 0; i < FairPlay.Length; i++)
            {
                var y = 42 + i * 68;
                AddLabel(fair, "\uE73E", Theme.Glyph, Theme.Orange, 20, y, 24, 22).AccessibleName = "";
                AddLabel(fair, FairPlay[i][0], Theme.Strong, Theme.Ink, 52, y, Inner - 72, 22);
                AddLabel(fair, FairPlay[i][1], Theme.Body, Theme.Mute, 52, y + 23, Inner - 72, 40);
            }
        }

        /* ------------------------------------------------------------ window */

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try
            {
                // Dark title bar: attribute 20 on Windows 10 20H1+ and 11, 19 on older Windows 10 builds.
                var on = 1;
                if (DwmSetWindowAttribute(Handle, 20, ref on, 4) != 0) DwmSetWindowAttribute(Handle, 19, ref on, 4);
                // Windows 11 only (ignored elsewhere): caption in the sidebar violet, title in off-white. COLORREF is 0x00BBGGRR.
                var caption = Theme.Sidebar.R | Theme.Sidebar.G << 8 | Theme.Sidebar.B << 16;
                var ink = Theme.Ink.R | Theme.Ink.G << 8 | Theme.Ink.B << 16;
                DwmSetWindowAttribute(Handle, 35, ref caption, 4);
                DwmSetWindowAttribute(Handle, 36, ref ink, 4);
            }
            catch { }
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.Escape) { Hide(); return true; } // Escape closes to the tray, like the X
            return base.ProcessCmdKey(ref msg, keyData);
        }

        public void SetStatus(string s) { footer.Text = s; }

        public void SetPaused(bool p)
        {
            syncing = true; // the tray already saved it; don't send it back through onPause
            paused.Checked = p;
            syncing = false;
            UpdatePauseUi();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // Closing the window keeps the helper running in the tray.
            if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); }
            base.OnFormClosing(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) timer.Dispose();
            base.Dispose(disposing);
        }
    }
}
