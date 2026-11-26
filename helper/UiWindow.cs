// Bridge Night Helper: the main window. Own title bar (with the mini-window button), sidebar, and the pages
// (UiHome.cs, UiPerformance.cs, UiPcPages.cs, UiSettingsHelp.cs). Pop-ups and the tour: UiPopups.cs.
// Layout numbers are 96-dpi units, turned into device pixels with Theme.Px / Theme.R.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace BridgeNight
{
    /// One page of the window. Enter/Leave run when it becomes visible on screen or stops being visible;
    /// Tick runs once a second while it is visible. Measuring only happens between Enter and Leave.
    class Page : Backdrop
    {
        public const int X0 = 24, W0 = 776, Y0 = 76, PageW = 824, PageH = 640;
        protected readonly MainWindow Win;
        protected readonly Settings S;

        public Page(MainWindow win, string name)
        {
            Win = win;
            S = win.Settings;
            Bounds = Theme.R(MainWindow.SidebarW, MainWindow.TitleH, PageW, PageH);
            Visible = false;
            AccessibleName = name;
            AccessibleRole = AccessibleRole.PropertyPage;
        }

        public virtual void Shown() { }
        public virtual void Hidden() { }
        public virtual void Tick() { }

        /// Page title with the small "?" that opens Help at `help`.
        protected void Heading(string text, string help)
        {
            var l = Ui.Label(this, text, Theme.H1, Theme.Ink, X0, 18, 400, 44);
            l.AutoSize = true;
            l.Height = Theme.Px(44);
            if (help == null) return;
            var q = new IconButton("?", "Help for " + text, 26) { Round = true, Plain = true };
            q.Location = new Point(l.Right + Theme.Px(10), l.Top + (l.Height - q.Height) / 2 + Theme.Px(1));
            q.Click += delegate { Win.OpenHelp(help); };
            Controls.Add(q);
        }

        protected static Label L(Control parent, string text, Font font, Color color, int x, int y, int w, int h)
        {
            return Ui.Label(parent, text, font, color, x, y, w, h);
        }
    }

    class MainWindow : Form
    {
        public const int SidebarW = 216, TitleH = 40;
        public const string SiteUrl = "https://bridge-night.bridge-night.workers.dev";
        public const string ReleasesUrl = "https://github.com/kasakuma99/bridge-night-/releases";
        public const string RepoUrl = "https://github.com/kasakuma99/bridge-night-";
        public const string DiscordUrl = "https://discord.gg/mEAF2C9Qq";

        public readonly Settings Settings;
        public readonly Action<bool> SetPausedAction;
        public readonly Action<string> Log;
        public readonly Action OpenMini;

        readonly List<NavItem> nav = new List<NavItem>();
        readonly List<Page> pages = new List<Page>();
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        Page current, live;
        Control pill;
        int ticks;
        TourOverlay tour;

        public HomePage Home;
        public PerformancePage Performance;
        public NetworkPage Network;
        public GameModePage GameModeP;
        public AudioPage Audio;
        public HelpPage Help;
        public SettingsPage SettingsP;

        public MainWindow(Settings s, List<string> lines, Action<bool> onPause, Action<string> log, Action openMini)
        {
            Settings = s;
            SetPausedAction = onPause;
            Log = log;
            OpenMini = openMini;

            SuspendLayout();
            AutoScaleMode = AutoScaleMode.None;
            Font = Theme.Body;
            Text = Program.Title;
            Icon = Theme.LargeIcon;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(Theme.Px(Theme.WindowW), Theme.Px(Theme.WindowH));
            BackColor = Theme.Base;
            ForeColor = Theme.Ink;
            DoubleBuffered = true;
            KeyPreview = true;

            BuildTitleBar();
            Home = Add(new HomePage(this));
            Performance = Add(new PerformancePage(this));
            Network = Add(new NetworkPage(this));
            GameModeP = Add(new GameModePage(this));
            Audio = Add(new AudioPage(this));
            Help = Add(new HelpPage(this, lines));
            SettingsP = Add(new SettingsPage(this));
            BuildSidebar();
            ResumeLayout(false);

            ShowPage(string.IsNullOrEmpty(s.Token) ? (Page)SettingsP : Home);
            timer.Interval = 1000;
            timer.Tick += delegate { OnTick(); };
            AudioCtl.Changed += OnAudioChanged;
            Updater.Changed += OnUpdaterChanged;
        }

        T Add<T>(T page) where T : Page
        {
            pages.Add(page);
            Controls.Add(page);
            return page;
        }

        /* ------------------------------------------------------------ title bar */

        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        /// Lets a borderless window be dragged by `c`.
        public static void MakeDraggable(Control c, Form f)
        {
            c.MouseDown += delegate (object o, MouseEventArgs e)
            {
                if (e.Button != MouseButtons.Left) return;
                ReleaseCapture();
                SendMessage(f.Handle, 0xA1, (IntPtr)2, IntPtr.Zero); // WM_NCLBUTTONDOWN on the caption
            };
        }

        void BuildTitleBar()
        {
            var bar = new Backdrop { Bounds = Theme.R(0, 0, Theme.WindowW, TitleH), AccessibleName = "Title bar" };
            bar.Paint += delegate (object o, PaintEventArgs e)
            {
                e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                Theme.DrawLogo(e.Graphics, Theme.R(14, 12, 16, 16));
                TextRenderer.DrawText(e.Graphics, Program.Title, Theme.Small, new Point(Theme.Px(40), Theme.Px(11)), Theme.Ink2, TextFormatFlags.NoPrefix);
            };
            MakeDraggable(bar, this);
            var close = new IconButton("\uE8BB", "Close to the tray", 34) { Plain = true };
            close.Location = new Point(Theme.Px(Theme.WindowW - 6 - 34), Theme.Px(3));
            close.Click += delegate { Hide(); };
            var min = new IconButton("\uE921", "Minimize", 34) { Plain = true };
            min.Location = new Point(close.Left - Theme.Px(38), close.Top);
            min.Click += delegate { WindowState = FormWindowState.Minimized; };
            var mini = new IconButton("\uE944", "Mini window", 34) { Plain = true };
            mini.Location = new Point(min.Left - Theme.Px(38), close.Top);
            mini.Click += delegate { if (OpenMini != null) OpenMini(); };
            var tip = new ToolTip();
            tip.SetToolTip(mini, "Mini window: a slim strip that stays on top");
            tip.SetToolTip(min, "Minimize");
            tip.SetToolTip(close, "Close (keeps running by the clock)");
            bar.Controls.Add(mini);
            bar.Controls.Add(min);
            bar.Controls.Add(close);
            Controls.Add(bar);
        }

        /* ------------------------------------------------------------ sidebar */

        void BuildSidebar()
        {
            var side = new Backdrop { Bounds = Theme.R(0, TitleH, SidebarW, Theme.WindowH - TitleH), AccessibleName = "Pages" };
            side.Paint += delegate (object o, PaintEventArgs e)
            {
                var g = e.Graphics;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                Theme.DrawLogo(g, Theme.R(20, 8, 40, 40));
                TextRenderer.DrawText(g, "Bridge Night", Theme.CardTitle, new Point(Theme.Px(70), Theme.Px(8)), Theme.Ink, TextFormatFlags.NoPrefix);
                TextRenderer.DrawText(g, "Helper " + Program.Version, Theme.Small, new Point(Theme.Px(70), Theme.Px(29)), Theme.Mute, TextFormatFlags.NoPrefix);
                using (var p = new Pen(Theme.Border))
                    g.DrawLine(p, Theme.Px(24), Theme.Px(112), Theme.Px(SidebarW - 24), Theme.Px(112));
            };
            AddNav(side, "Home", "\uE80F", Home, 64);
            AddNav(side, "Performance", "\uE9D9", Performance, 124);
            AddNav(side, "Network", "\uE839", Network, 164);
            AddNav(side, "Game mode", "\uE7FC", GameModeP, 204);
            AddNav(side, "Audio", "\uE7F6", Audio, 244);
            AddNav(side, "Help", "\uE897", Help, 482);
            AddNav(side, "Settings", "\uE713", SettingsP, 522);
            pill = new StatusPill(this) { Bounds = Theme.R(10, 574, SidebarW - 20, 44) };
            side.Controls.Add(pill);
            Controls.Add(side);
        }

        void AddNav(Control side, string text, string glyph, Page page, int y)
        {
            var item = new NavItem(text, glyph) { Location = new Point(Theme.Px(8), Theme.Px(y)), Tag = page };
            item.Click += delegate { ShowPage(page); };
            side.Controls.Add(item);
            nav.Add(item);
        }

        public void ShowPage(Page page)
        {
            if (current != null && current != page) current.Visible = false;
            current = page;
            page.Visible = true;
            foreach (var n in nav) n.Selected = n.Tag == page;
            UpdateLive();
        }

        public void OpenHelp(string section) { Help.Open(section); ShowPage(Help); }
        public void OpenPerformance(int tab) { Performance.Tab = tab; ShowPage(Performance); }

        /// Starts/stops the visible page's live views: only while the window is on screen and not minimized.
        void UpdateLive()
        {
            var want = Visible && WindowState != FormWindowState.Minimized ? current : null;
            if (want == live) return;
            if (live != null) live.Hidden();
            live = want;
            if (live != null) { live.Shown(); live.Tick(); UpdateBadges(); pill.Invalidate(); }
            if (live != null) timer.Start(); else timer.Stop();
        }

        void OnTick()
        {
            if (live == null) return;
            live.Tick();
            pill.Invalidate();
            if (++ticks % 30 == 0) UpdateBadges();
        }

        /// Game mode nav badge: how many checks found a problem.
        void UpdateBadges()
        {
            var n = 0;
            try
            {
                foreach (var c in GameMode.BeforeNight()) if (c.Problem) n++;
                foreach (var c in GameMode.Fixes()) if (c.Problem) n++;
            }
            catch { }
            foreach (var item in nav) if (item.Tag == GameModeP) item.Badge = n > 0 ? n.ToString() : "";
        }

        void OnAudioChanged() { if (live == Audio || live == Home) live.Tick(); }
        void OnUpdaterChanged() { if (live == Home || live == SettingsP) live.Tick(); }

        protected override void OnVisibleChanged(EventArgs e) { base.OnVisibleChanged(e); UpdateLive(); }
        protected override void OnResize(EventArgs e) { base.OnResize(e); if (IsHandleCreated) UpdateLive(); }

        /* ------------------------------------------------------------ tour */

        public void ShowTour()
        {
            if (tour != null) return;
            tour = new TourOverlay(this);
            Controls.Add(tour);
            tour.BringToFront();
            tour.Focus();
        }

        public void TourClosed()
        {
            if (tour == null) return;
            Controls.Remove(tour);
            tour.Dispose();
            tour = null;
            Settings.TourDone = true;
            try { Settings.Save(); } catch { }
        }

        /* ------------------------------------------------------------ calls from the tray */

        public void AddLog(string line) { Help.AddLog(line); }
        public void SetStatus(string s) { pill.Invalidate(); }
        public void SetPaused(bool p) { SettingsP.SyncPaused(p); if (live != null) live.Tick(); pill.Invalidate(); }

        /* ------------------------------------------------------------ window */

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        /// Windows 11: rounded corners and a thin border colour for borderless windows (ignored elsewhere).
        public static void RoundCorners(Form f)
        {
            try
            {
                var round = 2; // DWMWCP_ROUND
                DwmSetWindowAttribute(f.Handle, 33, ref round, 4);
                var border = Theme.BorderHi.R | Theme.BorderHi.G << 8 | Theme.BorderHi.B << 16;
                DwmSetWindowAttribute(f.Handle, 34, ref border, 4);
            }
            catch { }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.Style |= 0x20000 | 0x80000;  // WS_MINIMIZEBOX | WS_SYSMENU: taskbar click minimizes and restores
                cp.ClassStyle |= 0x20000;        // CS_DROPSHADOW
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); RoundCorners(this); }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (var p = new Pen(Theme.BorderHi)) e.Graphics.DrawRectangle(p, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.Escape)
            {
                if (tour != null) TourClosed(); else Hide(); // Escape closes to the tray, like the X
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // Closing the window keeps the helper running in the tray.
            if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); }
            base.OnFormClosing(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (live != null) { live.Hidden(); live = null; }
                timer.Dispose();
                AudioCtl.Changed -= OnAudioChanged;
                Updater.Changed -= OnUpdaterChanged;
            }
            base.Dispose(disposing);
        }
    }

    /// Sidebar status pill: "Sending · custom games", "Paused · nothing is sent" or "In game · 14:20". Click = Home.
    class StatusPill : PaintedControl
    {
        readonly MainWindow win;

        public StatusPill(MainWindow win) { this.win = win; AccessibleName = "Sending status"; }

        void Read(out Color dot, out string bold, out string rest)
        {
            var start = PcServices.GameStartedAt;
            if (win.Settings.Paused) { dot = Theme.Warn; bold = "Paused"; rest = "nothing is sent"; }
            else if (string.IsNullOrEmpty(win.Settings.Token)) { dot = Theme.Warn; bold = "No token"; rest = "see Settings"; }
            else if (start.HasValue) { dot = Theme.Good; bold = "In game"; rest = Ui.Clock(DateTime.Now - start.Value); }
            else { dot = Theme.Good; bold = "Sending"; rest = "custom games"; }
        }

        protected override void OnClick(EventArgs e) { win.ShowPage(win.Home); base.OnClick(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            Color dot; string bold, rest;
            Read(out dot, out bold, out rest);
            AccessibleDescription = bold + ", " + rest;
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new RectangleF(.5f, .5f, Width - 1.5f, Height - 1.5f);
            using (var path = Theme.Round(r, Theme.Px(Theme.CardRadius)))
            {
                using (var b = new SolidBrush(Hover ? Theme.NavActive : Theme.NavHover)) g.FillPath(b, path);
                using (var p = new Pen(Theme.Border)) g.DrawPath(p, path);
            }
            var d = Theme.Px(8);
            var c = new RectangleF(Theme.Px(14), (Height - d) / 2f, d, d);
            using (var halo = new SolidBrush(Color.FromArgb(60, dot))) g.FillEllipse(halo, RectangleF.Inflate(c, 3 * Theme.Scale, 3 * Theme.Scale));
            using (var b = new SolidBrush(dot)) g.FillEllipse(b, c);
            var x = Theme.Px(32);
            var bw = TextRenderer.MeasureText(g, bold, Theme.SmallStrong, Size.Empty, TextFormatFlags.NoPadding).Width;
            const TextFormatFlags f = TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis;
            TextRenderer.DrawText(g, bold, Theme.SmallStrong, new Rectangle(x, 0, bw + 2, Height), Theme.Ink, f);
            TextRenderer.DrawText(g, " · " + rest, Theme.Small, new Rectangle(x + bw, 0, Width - x - bw - Theme.Px(8), Height), Theme.Ink2, f);
            Ring(g, r, Theme.Px(Theme.CardRadius));
        }
    }
}
