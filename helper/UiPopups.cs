// Bridge Night Helper: the small windows. Mini window, tray flyout, toasts, the on-screen "Muted" badge,
// and the first-start tour (an overlay inside the main window).

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Windows.Forms;

namespace BridgeNight
{
    /// Borderless dark window that never shows in the taskbar or Alt+Tab. NoActivate ones never take focus.
    class PopupForm : Form
    {
        readonly bool noActivate, clickThrough;

        public PopupForm(bool noActivate, bool clickThrough)
        {
            this.noActivate = noActivate;
            this.clickThrough = clickThrough;
            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            BackColor = Theme.Card;
            ForeColor = Theme.Ink;
            Font = Theme.Body;
            DoubleBuffered = true;
            Text = Program.Title;
        }

        protected override bool ShowWithoutActivation { get { return noActivate; } }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x80;                                // WS_EX_TOOLWINDOW: not in Alt+Tab
                if (noActivate) cp.ExStyle |= 0x08000000;          // WS_EX_NOACTIVATE
                if (clickThrough) cp.ExStyle |= 0x80000 | 0x20;    // WS_EX_LAYERED | WS_EX_TRANSPARENT
                cp.ClassStyle |= 0x20000;                          // CS_DROPSHADOW
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); MainWindow.RoundCorners(this); }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (var p = new Pen(Theme.BorderHi)) e.Graphics.DrawRectangle(p, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
        }

        /// Bottom-right corner of the screen's work area (above the taskbar), `margin` px away.
        protected void PlaceBottomRight(int margin)
        {
            var wa = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa.Right - Width - Theme.Px(margin), wa.Bottom - Height - Theme.Px(margin));
        }
    }

    /// Slim always-on-top strip: status or game timer, mic and output buttons, ping, GPU, back to the full window.
    class MiniWindow : PopupForm
    {
        readonly Settings settings;
        readonly Action openFull;
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 1000 };
        readonly IconButton mic, output, expand;
        string title = "", sub = "", ping = "–", gpu = "–";
        Color dot = Theme.Mute;
        bool measuring;

        public MiniWindow(Settings s, Action openFull) : base(false, false)
        {
            settings = s;
            this.openFull = openFull;
            ClientSize = new Size(Theme.Px(472), Theme.Px(52));
            var wa = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa.Right - Width - Theme.Px(24), wa.Top + Theme.Px(24));
            mic = new IconButton("\uE720", "Mute or unmute mic", 32) { Location = new Point(Theme.Px(214), Theme.Px(10)) };
            mic.Click += delegate { AudioCtl.ToggleMic(); RefreshNow(); };
            output = new IconButton("\uE7F6", "Next sound output", 32) { Location = new Point(Theme.Px(252), Theme.Px(10)) };
            output.Click += delegate { AudioCtl.NextOutput(); RefreshNow(); };
            expand = new IconButton("\uE740", "Open the full window", 32) { Plain = true, Location = new Point(Theme.Px(432), Theme.Px(10)) };
            expand.Click += delegate { Hide(); if (openFull != null) openFull(); };
            Controls.Add(mic);
            Controls.Add(output);
            Controls.Add(expand);
            var tip = new ToolTip();
            tip.SetToolTip(mic, "Mute or unmute (Ctrl+Alt+M)");
            tip.SetToolTip(output, "Next sound output (Ctrl+Alt+H)");
            tip.SetToolTip(expand, "Open the full window");
            MainWindow.MakeDraggable(this, this);
            timer.Tick += delegate { RefreshNow(); };
            AccessibleName = "Bridge Night mini window";
        }

        protected override void OnVisibleChanged(EventArgs e)
        {
            base.OnVisibleChanged(e);
            if (Visible && !measuring) { PerfMon.Start("mini"); NetCheck.Start("mini"); measuring = true; RefreshNow(); timer.Start(); }
            else if (!Visible && measuring) { PerfMon.Stop("mini"); NetCheck.Stop("mini"); measuring = false; timer.Stop(); }
        }

        public void RefreshNow()
        {
            var st = HelperStatus.Read();
            var start = PcServices.GameStartedAt;
            if (start.HasValue) { title = Ui.Clock(DateTime.Now - start.Value); sub = ""; dot = Theme.Good; }
            else if (settings.Paused) { title = "Paused"; sub = "Nothing is sent"; dot = Theme.Warn; }
            else if (!st.LeagueConnected) { title = "Waiting"; sub = "for the League client"; dot = Theme.Mute; }
            else { title = "Ready"; sub = "Custom games are sent"; dot = Theme.Good; }
            var muted = AudioCtl.MicMuted;
            mic.Glyph = muted ? "\uF781" : "\uE720";
            mic.Alert = muted;
            mic.AccessibleDescription = muted ? "Muted" : "On";
            mic.Invalidate();
            var n = NetCheck.Current;
            ping = n != null && n.PingMs.HasValue ? n.PingMs.Value.ToString() : "–";
            var p = PerfMon.Latest;
            gpu = p != null && p.Gpu.HasValue ? Math.Round(p.Gpu.Value).ToString() : "–";
            AccessibleDescription = title + " " + sub + ", ping " + ping + " ms, GPU " + gpu + " %";
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Theme.DrawLogo(g, Theme.R(12, 12, 28, 28));
            var d = Theme.Px(8);
            using (var b = new SolidBrush(dot)) g.FillEllipse(b, Theme.Px(50), (Height - d) / 2f, d, d);
            const TextFormatFlags f = TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding;
            if (sub == "") TextRenderer.DrawText(g, title, Theme.Big, new Rectangle(Theme.Px(66), 0, Theme.Px(140), Height), Theme.Ink, f | TextFormatFlags.VerticalCenter);
            else
            {
                TextRenderer.DrawText(g, title, Theme.SmallStrong, new Rectangle(Theme.Px(66), Theme.Px(8), Theme.Px(140), Theme.Px(18)), Theme.Ink, f);
                TextRenderer.DrawText(g, sub, Theme.Tiny, new Rectangle(Theme.Px(66), Theme.Px(27), Theme.Px(140), Theme.Px(16)), Theme.Mute, f);
            }
            using (var p = new Pen(Theme.Border))
            {
                g.DrawLine(p, Theme.Px(206), Theme.Px(12), Theme.Px(206), Height - Theme.Px(12));
                g.DrawLine(p, Theme.Px(292), Theme.Px(12), Theme.Px(292), Height - Theme.Px(12));
                g.DrawLine(p, Theme.Px(424), Theme.Px(12), Theme.Px(424), Height - Theme.Px(12));
            }
            var x = Theme.Px(302);
            x += Value(g, ping, "ms", x);
            Value(g, gpu, "% GPU", x + Theme.Px(8));
            base.OnPaint(e);
        }

        int Value(Graphics g, string v, string unit, int x)
        {
            var vw = TextRenderer.MeasureText(g, v, Theme.SmallStrong, Size.Empty, TextFormatFlags.NoPadding).Width;
            var uw = TextRenderer.MeasureText(g, unit, Theme.Tiny, Size.Empty, TextFormatFlags.NoPadding).Width;
            TextRenderer.DrawText(g, v, Theme.SmallStrong, new Rectangle(x, 0, vw + 2, Height), Theme.Ink, TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, unit, Theme.Tiny, new Rectangle(x + vw + Theme.Px(3), Theme.Px(1), uw + 2, Height), Theme.Mute, TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            return vw + uw + Theme.Px(6);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); }
            base.OnFormClosing(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { timer.Dispose(); if (measuring) { PerfMon.Stop("mini"); NetCheck.Stop("mini"); measuring = false; } }
            base.Dispose(disposing);
        }
    }

    /// The panel by the clock after a left click on the tray icon.
    class TrayFlyout : PopupForm
    {
        readonly Settings settings;
        readonly DotLabel status;
        readonly Tile mic, output, mini, game;
        readonly FlatButton pause, open;

        public TrayFlyout(Settings s, Action openFull, Action openMini, Action<bool> setPaused, Action openGameMode) : base(false, false)
        {
            settings = s;
            ClientSize = new Size(Theme.Px(340), Theme.Px(266));
            Paint += delegate (object o, PaintEventArgs e)
            {
                e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                Theme.DrawLogo(e.Graphics, Theme.R(16, 16, 32, 32));
                TextRenderer.DrawText(e.Graphics, "Bridge Night Helper", Theme.Strong, new Point(Theme.Px(58), Theme.Px(13)), Theme.Ink, TextFormatFlags.NoPrefix);
                using (var p = new Pen(Theme.Border)) e.Graphics.DrawLine(p, 0, Theme.Px(212), Width, Theme.Px(212));
            };
            status = new DotLabel { Bounds = Theme.R(56, 34, 270, 20), Font = Theme.Small, ForeColor = Theme.Ink2, BackColor = Theme.Card, AccessibleName = "Status" };
            Controls.Add(status);
            mic = AddTile(16, 66);
            mic.Click += delegate { AudioCtl.ToggleMic(); RefreshNow(); };
            output = AddTile(174, 66);
            output.Click += delegate { AudioCtl.NextOutput(); RefreshNow(); };
            mini = AddTile(16, 138);
            mini.Set("\uE944", "", "Mini window", "Stays on top", false, false);
            mini.Click += delegate { Hide(); openMini(); };
            game = AddTile(174, 138);
            game.Click += delegate { Hide(); openGameMode(); };
            pause = Ui.Button(this, "Pause sending", false, 14, 222);
            pause.Click += delegate { setPaused(!settings.Paused); RefreshNow(); };
            open = Ui.ButtonRight(this, "Open helper", true, 326, 222);
            open.Click += delegate { Hide(); openFull(); };
        }

        Tile AddTile(int x, int y)
        {
            var t = new Tile { Bounds = Theme.R(x, y, 150, 62), Compact = true };
            Controls.Add(t);
            return t;
        }

        public void ShowNearClock()
        {
            RefreshNow();
            PlaceBottomRight(12);
            Show();
            Activate();
        }

        public void RefreshNow()
        {
            var st = HelperStatus.Read();
            var start = PcServices.GameStartedAt;
            if (settings.Paused) { status.Text = "Paused · nothing is sent"; status.Dot = Theme.Warn; }
            else if (start.HasValue) { status.Text = "In game · " + Ui.Clock(DateTime.Now - start.Value); status.Dot = Theme.Good; }
            else if (st.LeagueConnected) { status.Text = "Ready · League open"; status.Dot = Theme.Good; }
            else { status.Text = "Waiting for the League client"; status.Dot = Theme.Mute; }
            var muted = AudioCtl.MicMuted;
            var micName = AudioCtl.MicName;
            mic.Set(muted ? "\uF781" : "\uE720", "", muted ? "Mic muted" : "Mic on", micName == "" ? "Not available" : "Ctrl Alt M", false, muted);
            var outName = AudioCtl.OutputName;
            output.Set("\uE7F6", "", "Sound output", outName == "" ? "Not available" : outName, false, false);
            var active = GameMode.Active;
            game.Set("\uEC4A", "", active ? "Game mode on" : "Game mode", settings.GameModeAuto ? (active ? "Auto · on" : "Auto") : "Off", active, false);
            pause.Text = settings.Paused ? "Resume sending" : "Pause sending";
            pause.FitWidth();
        }

        protected override void OnDeactivate(EventArgs e) { base.OnDeactivate(e); Hide(); }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.Escape) { Hide(); return true; }
            return base.ProcessCmdKey(ref msg, keyData);
        }
    }

    /// Small pop-up in the bottom-right corner; hides itself after about six seconds.
    class Toast : PopupForm
    {
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 6000 };
        readonly Label title, text;
        readonly Label icon;
        public event Action Clicked;

        public Toast() : base(true, false)
        {
            ClientSize = new Size(Theme.Px(360), Theme.Px(110));
            Paint += delegate (object o, PaintEventArgs e)
            {
                e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                Theme.DrawLogo(e.Graphics, Theme.R(14, 12, 16, 16));
                TextRenderer.DrawText(e.Graphics, Program.Title + " · now", Theme.Tiny, new Point(Theme.Px(36), Theme.Px(12)), Theme.Mute, TextFormatFlags.NoPrefix);
            };
            icon = Ui.Label(this, "", Theme.Glyph, Theme.Good, 14, 44, 36, 36);
            icon.TextAlign = ContentAlignment.MiddleCenter;
            icon.BackColor = Theme.NavActive;
            icon.AccessibleRole = AccessibleRole.Graphic;
            title = Ui.Label(this, "", Theme.Strong, Theme.Ink, 62, 40, 282, 22);
            text = Ui.Label(this, "", Theme.Small, Theme.Ink2, 62, 62, 282, 40);
            var close = new IconButton("\uE8BB", "Close", 26) { Plain = true, Location = new Point(Theme.Px(326), Theme.Px(6)) };
            close.Click += delegate { Hide(); };
            Controls.Add(close);
            timer.Tick += delegate { timer.Stop(); Hide(); };
            foreach (Control c in new Control[] { this, title, text, icon }) c.Click += delegate { Hide(); if (Clicked != null) Clicked(); };
        }

        public void Pop(string glyph, Color color, string heading, string body)
        {
            Fill(glyph, color, heading, body);
            PlaceBottomRight(12);
            if (!Visible) Show();
            Invalidate(true);
            timer.Stop();
            timer.Start();
        }

        public void Fill(string glyph, Color color, string heading, string body)
        {
            icon.Text = glyph;
            icon.ForeColor = color;
            title.Text = heading;
            text.Text = body;
            AccessibleName = heading;
            AccessibleDescription = body;
        }

        protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }
    }

    /// "Microphone muted" pill at the top of the screen while the mic is muted. Clicks go through it.
    class MutedBadge : PopupForm
    {
        public MutedBadge() : base(true, true)
        {
            ClientSize = new Size(Theme.Px(320), Theme.Px(44));
            BackColor = Color.FromArgb(0x2a, 0x12, 0x1c);
            var wa = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa.Left + (wa.Width - Width) / 2, wa.Top + Theme.Px(16));
            Opacity = .95;
            AccessibleName = "Microphone muted";
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            TextRenderer.DrawText(g, "\uF781", Theme.Glyph, new Rectangle(Theme.Px(14), 0, Theme.Px(22), Height), Theme.Bad, TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "Microphone muted", Theme.Strong, new Rectangle(Theme.Px(44), 0, Theme.Px(170), Height), Theme.Ink, TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
            Ui.DrawKeys(g, new[] { "Ctrl", "Alt", "M" }, Width - Theme.Px(12), (Height - Theme.Px(22)) / 2, true);
            using (var p = new Pen(Color.FromArgb(150, Theme.Bad))) g.DrawRectangle(p, 0, 0, Width - 1, Height - 1);
        }
    }

    /// First-start tour: the window dims behind a card with four short steps. Skippable, replayable from Help.
    class TourOverlay : Control
    {
        static readonly string[][] Steps =
        {
            new[] { "Welcome", "Hi, this is your helper", "It runs quietly by the clock and does the PC things for game night. Here's what it can do in under a minute.",
                "\uE724", "Sends your custom games to Bridge Night by itself", "\uE720", "Mutes your mic everywhere with Ctrl+Alt+M", "\uE7F6", "Switches headset and speakers with Ctrl+Alt+H" },
            new[] { "Home", "Everything at a glance", "Home shows whether League, the helper and the site are connected, with your mic, sound, game mode and ping next to it.",
                "\uE769", "Pause sending any time with one click", "\uE930", "\"Last sent\" shows what reached the site", "\uE944", "The mini window stays on top while you play" },
            new[] { "Your PC", "Performance, Network, Game mode", "See what slows your PC down, where lag comes from, and fix common gamer settings with one click.",
                "\uE9D9", "Live view and a report after each game", "\uE839", "Ping and packet loss to EUW", "\uE7FC", "Game mode switches on by itself in game" },
            new[] { "Help", "Help is one click away", "Every page title has a small ? that explains the page. The Help page also has the log and a link to our Discord.",
                "\uE768", "Replay this tour from the Help page", "\uE8BB", "Closing the window keeps the helper by the clock", "\uE713", "Right-click the tray icon to exit" },
        };

        readonly MainWindow win;
        readonly Bitmap backdrop;
        readonly Panel card;
        readonly Label caption, title, text;
        readonly Label[] bulletIcons = new Label[3], bullets = new Label[3];
        readonly FlatButton skip, next;
        int step;

        public TourOverlay(MainWindow w)
        {
            win = w;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            Bounds = new Rectangle(0, Theme.Px(MainWindow.TitleH), w.ClientSize.Width, w.ClientSize.Height - Theme.Px(MainWindow.TitleH));
            AccessibleRole = AccessibleRole.Dialog;
            AccessibleName = "Welcome tour";
            // A dimmed picture of the window behind the card.
            backdrop = new Bitmap(w.ClientSize.Width, w.ClientSize.Height, PixelFormat.Format32bppPArgb);
            try { w.DrawToBitmap(backdrop, new Rectangle(Point.Empty, w.ClientSize)); } catch { }
            using (var g = Graphics.FromImage(backdrop))
            using (var b = new SolidBrush(Color.FromArgb(170, 8, 6, 12))) g.FillRectangle(b, 0, 0, backdrop.Width, backdrop.Height);

            card = new Panel { Bounds = new Rectangle((Width - Theme.Px(560)) / 2, (Height - Theme.Px(476)) / 2, Theme.Px(560), Theme.Px(476)), BackColor = Theme.Card };
            card.Paint += PaintCard;
            Controls.Add(card);
            caption = Ui.Label(card, "", Theme.Small, Theme.Mute, 32, 186, 496, 20);
            title = Ui.Label(card, "", Theme.H1, Theme.Ink, 30, 206, 500, 40);
            text = Ui.Label(card, "", Theme.Body, Theme.Ink2, 32, 250, 496, 48);
            for (var i = 0; i < 3; i++)
            {
                bulletIcons[i] = Ui.Label(card, "", Theme.Glyph, Theme.Orange, 30, 310 + i * 34, 26, 26);
                bulletIcons[i].BackColor = Theme.Card;
                bulletIcons[i].AccessibleName = "";
                bullets[i] = Ui.Label(card, "", Theme.Body, Theme.Ink, 64, 311 + i * 34, 460, 26);
            }
            next = Ui.ButtonRight(card, "Show me", true, 528, 418);
            next.Click += delegate { if (step == Steps.Length - 1) win.TourClosed(); else { step++; Show(); } };
            skip = Ui.ButtonRight(card, "Skip tour", false, 0, 418);
            skip.Click += delegate { win.TourClosed(); };
            Show();
        }

        new void Show()
        {
            var s = Steps[step];
            caption.Text = s[0] + " · " + (step + 1) + " of " + Steps.Length;
            title.Text = s[1];
            text.Text = s[2];
            for (var i = 0; i < 3; i++) { bulletIcons[i].Text = s[3 + i * 2]; bullets[i].Text = s[4 + i * 2]; }
            next.Text = step == 0 ? "Show me" : step == Steps.Length - 1 ? "Done" : "Next";
            next.FitWidth();
            next.Left = Theme.Px(528) - next.Width;
            skip.Visible = step < Steps.Length - 1;
            skip.Left = next.Left - Theme.Px(10) - skip.Width;
            card.Invalidate();
            if (IsHandleCreated) next.Focus();
        }

        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); BeginInvoke((Action)delegate { if (!IsDisposed) next.Focus(); }); }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.DrawImage(backdrop, 0, -Top);
            var r = card.Bounds;
            r.Inflate(1, 1);
            using (var p = new Pen(Theme.BorderHi)) e.Graphics.DrawRectangle(p, r.X, r.Y, r.Width - 1, r.Height - 1);
        }

        /// The art: violet-to-magenta evening sky, a moon, the bridge deck with lamps, dark water; logo top left.
        void PaintCard(object o, PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            var w = card.Width;
            var sky = new Rectangle(0, 0, w, Theme.Px(150));
            using (var b = new LinearGradientBrush(sky, Color.FromArgb(0x2a, 0x13, 0x45), Color.FromArgb(0xb0, 0x2c, 0x6c), 90f))
            {
                var blend = new ColorBlend();
                blend.Colors = new[] { Color.FromArgb(0x24, 0x10, 0x3c), Color.FromArgb(0x4a, 0x18, 0x5c), Color.FromArgb(0xc0, 0x32, 0x74) };
                blend.Positions = new[] { 0f, .55f, 1f };
                b.InterpolationColors = blend;
                g.FillRectangle(b, sky);
            }
            var moon = new RectangleF(w - Theme.Px(130), Theme.Px(28), Theme.Px(42), Theme.Px(42));
            using (var b = new SolidBrush(Color.FromArgb(40, 255, 230, 210))) g.FillEllipse(b, RectangleF.Inflate(moon, Theme.Px(10), Theme.Px(10)));
            using (var b = new SolidBrush(Color.FromArgb(0xff, 0xec, 0xdc))) g.FillEllipse(b, moon);
            var deck = Theme.Px(150);
            using (var b = new SolidBrush(Color.FromArgb(0x15, 0x0d, 0x1e))) g.FillRectangle(b, 0, deck, w, Theme.Px(30));
            using (var p = new Pen(Theme.Coral, Theme.Px(2))) g.DrawLine(p, 0, deck, w, deck);
            using (var b = new SolidBrush(Color.FromArgb(30, 255, 255, 255)))
                for (var i = 0; i < 3; i++) g.FillPie(b, i * w / 3f + Theme.Px(20), deck + Theme.Px(10), w / 3f - Theme.Px(40), Theme.Px(70), 180, 180);
            for (var i = 0; i < 6; i++)
            {
                var x = w * (i + .5f) / 6f;
                using (var p = new Pen(Color.FromArgb(0x3a, 0x22, 0x40), Theme.Px(2))) g.DrawLine(p, x, deck - Theme.Px(16), x, deck);
                using (var b = new SolidBrush(Color.FromArgb(70, 255, 200, 220))) g.FillEllipse(b, x - Theme.Px(9), deck - Theme.Px(27), Theme.Px(18), Theme.Px(18));
                using (var b = new SolidBrush(Color.FromArgb(0xff, 0xf2, 0xf6))) g.FillEllipse(b, x - Theme.Px(4), deck - Theme.Px(22), Theme.Px(8), Theme.Px(8));
            }
            using (var b = new SolidBrush(Theme.Card)) g.FillRectangle(b, 0, deck + Theme.Px(30), w, card.Height);
            Theme.DrawLogo(g, Theme.R(32, 26, 72, 72));
            // progress dots
            for (var i = 0; i < Steps.Length; i++)
            {
                var r = new RectangleF(Theme.Px(32) + i * Theme.Px(16) + (i > step ? Theme.Px(14) : 0), Theme.Px(431), i == step ? Theme.Px(24) : Theme.Px(8), Theme.Px(8));
                using (var path = Theme.Round(r, r.Height / 2))
                {
                    if (i == step) using (var b = Theme.Sunset(r, 0f)) g.FillPath(b, path);
                    else using (var b = new SolidBrush(Theme.BorderHi)) g.FillPath(b, path);
                }
            }
        }

        protected override void Dispose(bool disposing) { if (disposing) backdrop.Dispose(); base.Dispose(disposing); }
    }
}
