// Bridge Night Helper: the Home page. One status card, four tiles, "Last sent", and ping / this PC / last game.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Windows.Forms;

namespace BridgeNight
{
    /// League client → This helper → site, as three chips with a status dot each.
    class ChainChips : Control
    {
        public readonly string[] Names = { "League client", "This helper", "bridge-night.bridge-night.workers.dev" };
        public Color[] Dots = { Theme.Mute, Theme.Mute, Theme.Mute };
        public bool Dashed;

        public ChainChips()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Card;
            TabStop = false;
            AccessibleRole = AccessibleRole.StaticText;
        }

        public void Set(Color a, Color b, Color c, bool dashed)
        {
            if (Dots[0] == a && Dots[1] == b && Dots[2] == c && Dashed == dashed) return;
            Dots = new[] { a, b, c };
            Dashed = dashed;
            Func<Color, string> word = col => col == Theme.Good ? "OK" : col == Theme.Bad ? "problem" : col == Theme.Warn ? "paused" : "waiting";
            AccessibleName = Names[0] + " " + word(a) + ", " + Names[1] + " " + word(b) + ", site " + word(c);
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var x = 0f;
            var h = Theme.Px(30);
            var y = (Height - h) / 2f;
            for (var i = 0; i < Names.Length; i++)
            {
                var tw = TextRenderer.MeasureText(Names[i], Theme.Small).Width;
                var r = new RectangleF(x, y, tw + Theme.Px(36), h);
                using (var path = Theme.Round(r, h / 2))
                {
                    using (var b = new SolidBrush(Theme.Input)) g.FillPath(b, path);
                    using (var p = new Pen(Theme.Border)) g.DrawPath(p, path);
                }
                var d = Theme.Px(7);
                using (var b = new SolidBrush(Dots[i])) g.FillEllipse(b, r.X + Theme.Px(13), r.Y + (h - d) / 2, d, d);
                TextRenderer.DrawText(g, Names[i], Theme.Small, new Rectangle((int)r.X + Theme.Px(26), (int)r.Y, tw + Theme.Px(6), (int)h), Theme.Ink2,
                    TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
                x = r.Right;
                if (i < Names.Length - 1)
                {
                    using (var p = new Pen(Theme.BorderHi, Theme.Px(1)))
                    {
                        if (i == 1 && Dashed) p.DashStyle = DashStyle.Dash;
                        g.DrawLine(p, x, y + h / 2, x + Theme.Px(24), y + h / 2);
                    }
                    x += Theme.Px(24);
                }
            }
        }
    }

    class HomePage : Page
    {
        Card hero;
        DotLabel heroTitle;
        Label sentIcon, heroSub, timer, timerCaption, sentText, pingBig, pingSub, pingState, pcNote, gameWhen, gameLimit, gameEmpty;
        ChainChips chain;
        FlatButton pause, report;
        Tile mic, output, gameMode, update;
        Chart pingChart;
        BarRow cpu, gpu, ram, vram, gameCpu, gameGpu;
        int slow;
        static readonly string[] MicKeys = { "Ctrl", "Alt", "M" }, OutKeys = { "Ctrl", "Alt", "H" };

        public HomePage(MainWindow w) : base(w, "Home")
        {
            BuildHero();
            BuildTiles();
            BuildSent();
            BuildBottom();
        }

        void BuildHero()
        {
            hero = Ui.Card(this, null, X0, 20, W0, 150);
            heroTitle = new DotLabel { Bounds = Theme.R(18, 16, 560, 44), Font = Theme.Hero, ForeColor = Theme.Ink, BackColor = Theme.Card, AccessibleName = "Status" };
            hero.Controls.Add(heroTitle);
            heroSub = L(hero, "", Theme.Body, Theme.Ink2, 22, 60, 560, 24);
            chain = new ChainChips { Bounds = Theme.R(20, 98, 560, 34) };
            hero.Controls.Add(chain);
            pause = Ui.ButtonRight(hero, "Pause sending", false, W0 - 20, 20);
            pause.Glyph = "\uE769";
            pause.FitWidth();
            pause.Left = Theme.Px(W0 - 20) - pause.Width;
            pause.Click += delegate { Win.SetPausedAction(!S.Paused); };
            timer = L(hero, "", Theme.Huge, Theme.Ink, W0 - 200, 58, 180, 54);
            timer.TextAlign = ContentAlignment.MiddleRight;
            timer.AccessibleName = "Game time";
            timerCaption = L(hero, "game time", Theme.Small, Theme.Mute, W0 - 200, 112, 180, 20);
            timerCaption.TextAlign = ContentAlignment.TopRight;
        }

        void BuildTiles()
        {
            const int w = 185, gap = 12, y = 186;
            mic = AddTile(0, w, gap, y, MicKeys);
            mic.Click += delegate { AudioCtl.ToggleMic(); Tick(); };
            output = AddTile(1, w, gap, y, OutKeys);
            output.Click += delegate { AudioCtl.NextOutput(); Tick(); };
            gameMode = AddTile(2, w, gap, y, null);
            gameMode.Click += delegate { Win.ShowPage(Win.GameModeP); };
            update = AddTile(3, w, gap, y, null);
            update.Click += delegate
            {
                if (Updater.NewVersion == "") { Win.OpenSettings("Updates"); return; }
                SettingsPopup.InstallUpdate(Win);
            };
        }

        Tile AddTile(int i, int w, int gap, int y, string[] keys)
        {
            var t = new Tile { Bounds = Theme.R(X0 + i * (w + gap), y, w, 116), Keys = keys };
            Controls.Add(t);
            return t;
        }

        void BuildSent()
        {
            var row = Ui.Card(this, null, X0, 318, W0, 50);
            sentIcon = Ui.Icon(row, "\uE930", Theme.Good, 14, 13);
            sentText = L(row, "", Theme.Body, Theme.Ink, 46, 13, 560, 24);
            sentText.TextAlign = ContentAlignment.MiddleLeft;
            sentText.AccessibleName = "Last sent";
            Ui.Link(row, "Open on the site  ↗", W0 - 14, 12).Click += delegate { Ui.Open(MainWindow.SiteUrl); };
        }

        void BuildBottom()
        {
            const int w = 250, gap = 13, y = 384, h = 236;
            var ping = Ui.Card(this, "Ping to " + NetCheck.ServerName, X0, y, w, h);
            pingState = L(ping, "", Theme.Small, Theme.Good, w - 116, 15, 100, 20);
            pingState.TextAlign = ContentAlignment.TopRight;
            pingBig = L(ping, "–", Theme.Big, Theme.Ink, 14, 44, 90, 40);
            pingBig.AccessibleName = "Ping";
            pingSub = L(ping, "", Theme.Small, Theme.Mute, 100, 60, 140, 22);
            pingChart = new Chart { Bounds = Theme.R(16, 96, w - 32, 124), Max = 60, AutoMax = true, Empty = "Measuring…" };
            ping.Controls.Add(pingChart);

            var pc = Ui.Card(this, "This PC", X0 + w + gap, y, w + 1, h);
            Ui.Link(pc, "Details", w - 14, 12).Click += delegate { Win.OpenPerformance(0); };
            cpu = Row(pc, 50, w, Theme.CpuLine);
            gpu = Row(pc, 84, w, Theme.GpuLine);
            ram = Row(pc, 118, w, Theme.MemLine);
            vram = Row(pc, 152, w, Theme.VramLine);
            pcNote = L(pc, "", Theme.Small, Theme.Mute, 16, 196, w - 32, 22);

            var game = Ui.Card(this, "Last game", X0 + 2 * (w + gap) + 1, y, w, h);
            report = Ui.Link(game, "Report", w - 14, 12);
            report.Click += delegate { Win.OpenPerformance(1); };
            gameEmpty = L(game, "Play a game to see how your PC handled it.", Theme.Body, Theme.Mute, 16, 60, w - 32, 120);
            gameEmpty.TextAlign = ContentAlignment.MiddleCenter;
            gameWhen = L(game, "", Theme.Small, Theme.Mute, 16, 42, w - 32, 20);
            gameCpu = Row(game, 70, w, Theme.CpuLine);
            gameGpu = Row(game, 104, w, Theme.GpuLine);
            gameCpu.LabelWidth = gameGpu.LabelWidth = 76;
            gameLimit = L(game, "", Theme.Small, Theme.Ink2, 16, 140, w - 32, 80);
        }

        static BarRow Row(Control card, int y, int w, Color color)
        {
            var r = new BarRow { Bounds = Theme.R(16, y, w - 32, 26), Color = color };
            card.Controls.Add(r);
            return r;
        }

        public override void Shown()
        {
            PerfMon.Start("home");
            NetCheck.Start("home");
            slow = 0;
        }

        public override void Hidden()
        {
            PerfMon.Stop("home");
            NetCheck.Stop("home");
        }

        public override void Tick()
        {
            var s = HelperStatus.Read();
            UpdateHero(s);
            UpdateTiles();
            var failed = s.ServerOk == false;
            Ui.Set(sentIcon, failed ? "" : "", failed ? Theme.Warn : s.LastSentAt.HasValue ? Theme.Good : Theme.Mute);
            if (s.LastSentAt.HasValue) Ui.Set(sentText, "Last sent: " + s.LastSent + " · " + Ui.Ago(s.LastSentAt.Value));
            else Ui.Set(sentText, "Last sent: nothing yet. Custom games are sent while you play.");
            UpdatePing();
            UpdatePc();
            if (slow++ % 30 == 0) UpdateLastGame();
        }

        void UpdateHero(HelperStatus.Snapshot s)
        {
            var start = PcServices.GameStartedAt;
            string title, sub;
            var dot = Theme.Good;
            if (string.IsNullOrEmpty(S.Token)) { title = "Add your helper token"; sub = "Paste it in Settings so your custom games reach the site."; dot = Theme.Warn; }
            else if (S.Paused) { title = "Sending is paused"; sub = "Nothing is sent until you resume."; dot = Theme.Warn; }
            else if (s.ServerOk == false && !string.IsNullOrEmpty(s.LastError)) { title = "Can't reach the site"; sub = s.LastError; dot = Theme.Bad; }
            else if (start.HasValue) { title = "Watching your game"; sub = s.CustomGame ? "Custom game. The result goes to the site when it ends." : "Not a custom game: nothing is sent."; }
            else if (!s.LeagueConnected) { title = "Waiting for the League client"; sub = "Open League and the helper connects by itself."; dot = Theme.Mute; }
            else { title = "Ready for game night"; sub = "League is open. Custom games are sent by themselves."; }
            Ui.Set(heroTitle, title);
            heroTitle.Dot = dot;
            Ui.Set(heroSub, sub);
            var site = s.ServerOk == true ? Theme.Good : s.ServerOk == false ? Theme.Bad : Theme.Mute;
            chain.Set(s.LeagueConnected ? Theme.Good : Theme.Mute, S.Paused || string.IsNullOrEmpty(S.Token) ? Theme.Warn : Theme.Good, site, S.Paused);
            var inGame = start.HasValue;
            Ui.Show(timer, inGame);
            Ui.Show(timerCaption, inGame);
            if (inGame) Ui.Set(timer, Ui.Clock(DateTime.Now - start.Value));
            pause.Text = S.Paused ? "Resume sending" : "Pause sending";
            pause.Glyph = S.Paused ? "\uE768" : "\uE769";
            pause.Primary = S.Paused;
            pause.FitWidth();
            pause.Left = Theme.Px(W0 - 20) - pause.Width;
        }

        static void SetKeys(Tile t, string[] keys) { if (t.Keys != keys) { t.Keys = keys; t.Invalidate(); } }

        void UpdateTiles()
        {
            var micName = AudioCtl.MicName;
            var muted = AudioCtl.MicMuted;
            SetKeys(mic, S.Hotkeys ? MicKeys : null);
            if (string.IsNullOrEmpty(micName)) mic.Set("\uE720", "", "Mic", "Not available on this PC", false, false);
            else mic.Set(muted ? "\uF781" : "\uE720", "", muted ? "Mic muted" : "Mic on", micName, false, muted);

            var outName = AudioCtl.OutputName;
            SetKeys(output, S.Hotkeys ? OutKeys : null);
            output.Set("\uE7F6", "", "Sound output", string.IsNullOrEmpty(outName) ? "Not available on this PC" : outName, false, false);

            var active = GameMode.Active;
            gameMode.Set("\uE7FC", S.GameModeAuto ? "Auto" : "Off", active ? "Game mode on" : "Game mode",
                active ? (GameMode.ActiveText == "" ? "On while you play" : GameMode.ActiveText) : S.GameModeAuto ? "Waiting for a game" : "Switched off", active, false);

            var nv = Updater.NewVersion;
            var state = Updater.State;
            if (nv != "") update.Set("\uE896", "New", "Update to " + nv.TrimStart('v', 'V'), "Click to install", true, false);
            else update.Set("\uE895", "", "Version " + Program.Version, state == "" ? "Updates by itself" : state, false, false);
        }

        void UpdatePing()
        {
            var n = NetCheck.Current;
            if (n == null || !n.PingMs.HasValue)
            {
                Ui.Set(pingBig, "–");
                Ui.Set(pingSub, "Measuring…");
                Ui.Set(pingState, "");
            }
            else
            {
                Ui.Set(pingBig, n.PingMs.Value.ToString());
                Ui.Set(pingSub, "ms · " + Math.Round(n.LossPercent) + "% loss");
                Ui.Set(pingState, n.Ok ? "Stable" : "Unstable", n.Ok ? Theme.Good : Theme.Warn);
            }
            pingBig.Width = TextRenderer.MeasureText(pingBig.Text, pingBig.Font).Width + Theme.Px(4);
            pingSub.Left = pingBig.Right - Theme.Px(4);
            var h = NetCheck.History(300); // Home gets one ping every 5 s: five minutes of line
            pingChart.SetData(new List<Series> { new Series(Theme.Good, h.Select(p => p.Value.HasValue ? (float?)p.Value.Value : null).ToArray(), true) }, null);
        }

        void UpdatePc()
        {
            var p = PerfMon.Latest;
            if (p == null)
            {
                cpu.Set("CPU", 0, "–"); gpu.Set("GPU", 0, "–"); ram.Set("RAM", 0, "–"); vram.Set("VRAM", 0, "–");
                Ui.Set(pcNote, "Measuring…");
                return;
            }
            cpu.Set("CPU", (p.Cpu ?? 0) / 100f, Ui.Pct(p.Cpu));
            gpu.Set("GPU", (p.Gpu ?? 0) / 100f, Ui.Pct(p.Gpu));
            ram.Set("RAM", p.MemTotalGb > 0 ? p.MemUsedGb / p.MemTotalGb : 0, Math.Round(p.MemUsedGb) + "/" + Math.Round(p.MemTotalGb) + " GB");
            if (p.VramUsedGb.HasValue && p.VramTotalGb.HasValue && p.VramTotalGb.Value > 0)
                vram.Set("VRAM", p.VramUsedGb.Value / p.VramTotalGb.Value, Math.Round(p.VramUsedGb.Value) + "/" + Math.Round(p.VramTotalGb.Value) + " GB");
            else vram.Set("VRAM", 0, "–");
            Ui.Set(pcNote, p.GpuTempC.HasValue ? "Graphics card at " + Math.Round(p.GpuTempC.Value) + " °C" : "");
        }

        void UpdateLastGame()
        {
            var games = PerfMon.LastGames();
            var g = games.Count > 0 ? games[0] : null;
            Ui.Show(gameEmpty, g == null);
            foreach (Control c in new Control[] { gameWhen, gameCpu, gameGpu, gameLimit, report }) Ui.Show(c, g != null);
            if (g == null) return;
            Ui.Set(gameWhen, g.Start.ToString("ddd HH:mm", Ui.En) + " · " + Ui.Span(g.End - g.Start));
            gameCpu.Set("CPU peak", g.CpuPeak / 100f, Math.Round(g.CpuPeak) + " %");
            gameGpu.Set("GPU peak", g.GpuPeak / 100f, Math.Round(g.GpuPeak) + " %");
            Ui.Set(gameLimit, g.Limit);
        }
    }
}
