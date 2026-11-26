// Bridge Night Helper: the Network, Game mode and Audio pages.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Windows.Forms;

namespace BridgeNight
{
    /// Key chips drawn as a control (Ctrl Alt M).
    class KeysView : Control
    {
        string[] keys;

        public KeysView(string[] keys)
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            TabStop = false;
            Keys = keys;
            Height = Theme.Px(24);
        }

        public string[] Keys
        {
            get { return keys; }
            set
            {
                keys = value;
                AccessibleName = "Hotkey " + string.Join(" ", value);
                using (var g = Graphics.FromHwnd(IntPtr.Zero)) Width = Ui.DrawKeys(g, value, -10000, -10000, false) + Theme.Px(2);
                Invalidate();
            }
        }

        protected override void OnPaintBackground(PaintEventArgs e) { Ui.PaintParent(this, e); }
        protected override void OnPaint(PaintEventArgs e) { Ui.DrawKeys(e.Graphics, keys, 0, 0, false); }
    }

    /// Where the time goes: This PC → router → provider → Riot, as circles on a line.
    class HopsView : Control
    {
        List<NetHop> hops = new List<NetHop>();
        public string Empty = "";

        public HopsView()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Card;
            TabStop = false;
            AccessibleRole = AccessibleRole.Diagram;
        }

        public void Set(List<NetHop> h)
        {
            hops = h ?? new List<NetHop>();
            AccessibleName = hops.Count == 0 ? Empty : string.Join(", ", hops.Select(x => x.Name + " " + (x.Ms.HasValue ? x.Ms + " ms" : "no answer")));
            Invalidate();
        }

        static string Glyph(string name)
        {
            var n = (name ?? "").ToLowerInvariant();
            return n.Contains("pc") ? "\uE7F8" : n.Contains("router") ? "\uE701" : n.Contains("riot") ? "\uE7FC" : "\uE774";
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            if (hops.Count == 0)
            {
                TextRenderer.DrawText(g, Empty, Theme.Body, ClientRectangle, Theme.Mute, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak);
                return;
            }
            var slot = Width / (float)hops.Count;
            var d = Theme.Px(40);
            var cy = Theme.Px(24);
            using (var p = new Pen(Theme.BorderHi)) g.DrawLine(p, slot / 2, cy, Width - slot / 2, cy);
            var worst = hops.Where(h => h.Ms.HasValue).Select(h => h.Ms.Value).DefaultIfEmpty(0).Max();
            for (var i = 0; i < hops.Count; i++)
            {
                var h = hops[i];
                var cx = slot * i + slot / 2;
                var r = new RectangleF(cx - d / 2, cy - d / 2, d, d);
                var bad = h.LossPercent >= 2 || (h.Ms.HasValue && i > 0 && h.Ms.Value - (hops[i - 1].Ms ?? 0) > 40);
                using (var b = new SolidBrush(Theme.NavActive)) g.FillEllipse(b, r);
                using (var p = new Pen(bad ? Theme.Warn : Theme.BorderHi)) g.DrawEllipse(p, r);
                TextRenderer.DrawText(g, Glyph(h.Name), Theme.Glyph, Rectangle.Round(r), bad ? Theme.Warn : Theme.Ink2, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
                var title = h.Name + (h.Ms.HasValue ? " · " + h.Ms.Value + " ms" : "");
                TextRenderer.DrawText(g, title, Theme.Strong, new Rectangle((int)(cx - slot / 2), cy + d / 2 + Theme.Px(10), (int)slot, Theme.Px(22)), Theme.Ink,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis);
                TextRenderer.DrawText(g, h.Ms.HasValue ? Math.Round(h.LossPercent) + "% loss" : "no answer", Theme.Small, new Rectangle((int)(cx - slot / 2), cy + d / 2 + Theme.Px(34), (int)slot, Theme.Px(20)),
                    bad ? Theme.Warn : Theme.Mute, TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPrefix);
            }
        }
    }

    class NetworkPage : Page
    {
        Label server, verdictIcon, verdict, verdictSub, ping, jitter, loss, spike, spikeAt, traceState;
        Chart chart;
        HopsView hopsView;
        FlatButton trace;

        public NetworkPage(MainWindow w) : base(w, "Network")
        {
            Heading("Network", "Network");
            server = L(this, "EUW game server", Theme.Small, Theme.Ink2, X0 + W0 - 320, 30, 320, 22);
            server.TextAlign = ContentAlignment.MiddleRight;

            var v = Ui.Card(this, null, X0, Y0, W0, 76);
            verdictIcon = L(v, "", Theme.GlyphBig, Theme.Good, 16, 18, 40, 40);
            verdictIcon.TextAlign = ContentAlignment.MiddleCenter;
            verdictIcon.BackColor = Theme.NavActive;
            verdictIcon.AccessibleRole = AccessibleRole.Graphic;
            verdict = L(v, "", Theme.Strong, Theme.Ink, 70, 15, 520, 24);
            verdictSub = L(v, "Ping to the EUW game server, measured once a second while this page is open.", Theme.Small, Theme.Mute, 70, 39, 540, 20);
            Ui.Link(v, "Riot server status  ↗", W0 - 16, 24).Click += delegate { Ui.Open("https://status.riotgames.com/lol?region=euw1&locale=en_GB"); };

            var c = Ui.Card(this, null, X0, Y0 + 90, W0, 268);
            ping = Stat(c, "Ping", 16);
            jitter = Stat(c, "Jitter", 136);
            loss = Stat(c, "Packet loss", 256);
            spike = Stat(c, "Worst spike", 396);
            spikeAt = L(c, "", Theme.Small, Theme.Mute, 480, 46, 160, 24);
            L(c, "last 5 min", Theme.Small, Theme.Mute, W0 - 136, 18, 120, 20).TextAlign = ContentAlignment.TopRight;
            chart = new Chart { Bounds = Theme.R(16, 88, W0 - 32, 166), YLabels = true, Unit = "ms", Max = 60, AutoMax = true, MarkPeak = true, Empty = "Measuring…" };
            c.Controls.Add(chart);

            var hc = Ui.Card(this, "Where the time goes", X0, Y0 + 372, W0, 172);
            traceState = L(hc, "", Theme.Small, Theme.Mute, 200, 16, 400, 20);
            trace = Ui.ButtonRight(hc, "Trace", false, W0 - 16, 10);
            trace.Click += delegate { NetCheck.TraceNow(); Tick(); };
            hopsView = new HopsView { Bounds = Theme.R(16, 50, W0 - 32, 112), Empty = "Click Trace to see where the time goes: this PC, your router, your internet provider and Riot." };
            hc.Controls.Add(hopsView);
        }

        Label Stat(Control card, string caption, int x)
        {
            L(card, caption, Theme.Small, Theme.Ink2, x, 16, 120, 20);
            var l = L(card, "–", Theme.Big, Theme.Ink, x, 38, 120, 38);
            l.AccessibleName = caption;
            return l;
        }

        public override void Shown() { NetCheck.Start(NetCheck.FastCaller); }
        public override void Hidden() { NetCheck.Stop(NetCheck.FastCaller); }

        public override void Tick()
        {
            var n = NetCheck.Current ?? new NetReport();
            // Riot drops pings, so NetCheck may measure to a data centre next to EUW: say which one honestly.
            var near = (NetCheck.TargetName ?? "").StartsWith("Amsterdam");
            Ui.Set(server, near ? "Amsterdam, next to the EUW servers" : "EUW game server");
            Ui.Set(verdictSub, near ? "Riot does not answer pings, so this measures to a server next to EUW." : "Ping to the EUW game server, measured once a second while this page is open.");
            var measuring = !n.PingMs.HasValue;
            Ui.Set(verdict, measuring ? "Measuring…" : n.Verdict == "" ? (n.Ok ? "All good" : "Unstable connection") : n.Verdict);
            Ui.Set(verdictIcon, measuring ? "\uE916" : n.Ok ? "\uE73E" : "\uE7BA", measuring ? Theme.Mute : n.Ok ? Theme.Good : Theme.Warn);
            Ui.Set(ping, n.PingMs.HasValue ? n.PingMs.Value + " ms" : "–");
            Ui.Set(jitter, n.JitterMs.HasValue ? n.JitterMs.Value + " ms" : "–");
            Ui.Set(loss, measuring ? "–" : Math.Round(n.LossPercent, 1).ToString(Ui.En) + " %", n.LossPercent >= 1 ? Theme.Warn : Theme.Ink);
            var h = NetCheck.History(300);
            var worst = h.Where(p => p.Value.HasValue).OrderByDescending(p => p.Value.Value).FirstOrDefault();
            Ui.Set(spike, worst.Value.HasValue ? worst.Value.Value + " ms" : "–");
            Ui.Set(spikeAt, worst.Value.HasValue ? "at " + worst.Key.ToString("HH:mm", Ui.En) : "");
            spike.Width = TextRenderer.MeasureText(spike.Text, spike.Font).Width + Theme.Px(4);
            spikeAt.Left = spike.Right + Theme.Px(2);
            chart.SetData(new List<Series> { new Series(Theme.Good, h.Select(p => p.Value.HasValue ? (float?)p.Value.Value : null).ToArray(), true) },
                new[] { "5 min", "4", "3", "2", "1", "now" });
            var tracing = NetCheck.Tracing;
            trace.Enabled = !tracing;
            trace.Text = tracing ? "Tracing…" : NetCheck.Hops.Count > 0 ? "Trace again" : "Trace";
            trace.FitWidth();
            trace.Left = Theme.Px(W0 - 16) - trace.Width;
            Ui.Set(traceState, tracing ? "Checking each step, this takes a few seconds…" : "");
            hopsView.Set(NetCheck.Hops);
        }
    }

    /// Game mode: one glance (ready ring + state), the checks as tiles with their fix button, and how long you played.
    class GameModePage : Page
    {
        const int Slots = 6, TileW = 250, TileH = 104, Gap = 13;
        ReadyRing ring;
        Label heroTitle, heroSub, stateBig, stateCaption, todayText, lengthsNote;
        Pill autoPill, musicPill, breakPill;
        FlatButton change;
        readonly Card[] tiles = new Card[Slots];
        readonly Label[] tileIcon = new Label[Slots], tileTitle = new Label[Slots], tileDetail = new Label[Slots], tileOk = new Label[Slots];
        readonly FlatButton[] tileFix = new FlatButton[Slots];
        List<PcCheck> checks = new List<PcCheck>();
        Bars lengths;
        BarRow today;
        DateTime noteUntil = DateTime.MinValue, checkedAt;
        int slow;
        Card again;
        Label againWhen;

        public GameModePage(MainWindow w) : base(w, "Game mode")
        {
            Heading("Game mode", "Game mode");

            // 1. One glance: how ready the PC is, and what happens when a game starts.
            var hero = Ui.Card(this, null, X0, Y0, W0, 140);
            ring = new ReadyRing { Bounds = Theme.R(18, 16, 108, 108) };
            hero.Controls.Add(ring);
            heroTitle = L(hero, "", Theme.Big, Theme.Ink, 146, 18, 420, 32);
            heroSub = L(hero, "", Theme.Small, Theme.Ink2, 146, 52, 440, 22);
            autoPill = HeroPill(hero, 146);
            musicPill = HeroPill(hero, 146);
            breakPill = HeroPill(hero, 146);
            change = Ui.Link(hero, "Change in Settings", 600, 92);
            change.Click += delegate { Win.OpenSettings("Game mode"); };
            stateBig = L(hero, "", Theme.Huge, Theme.Ink, W0 - 200, 26, 182, 50);
            stateBig.TextAlign = ContentAlignment.MiddleRight;
            stateCaption = L(hero, "", Theme.Small, Theme.Mute, W0 - 230, 78, 212, 20);
            stateCaption.TextAlign = ContentAlignment.TopRight;

            // 2. Every check is a tile: green when fine, amber with its fix button when not.
            for (var i = 0; i < Slots; i++)
            {
                var t = tiles[i] = Ui.Card(this, null, X0 + (i % 3) * (TileW + Gap), Y0 + 152 + (i / 3) * (TileH + Gap), TileW, TileH);
                tileIcon[i] = Ui.Icon(t, "", Theme.Good, 14, 14);
                tileTitle[i] = L(t, "", Theme.Strong, Theme.Ink, 44, 12, TileW - 56, 22);
                tileDetail[i] = L(t, "", Theme.Small, Theme.Mute, 44, 34, TileW - 56, 34);
                tileOk[i] = L(t, "All good", Theme.Small, Theme.Good, 44, 74, 140, 20);
                tileFix[i] = Ui.ButtonRight(t, "Fix", false, TileW - 14, 66);
                var k = i;
                tileFix[i].Click += delegate { Fix(k); };
            }

            // A free tile slot becomes "Check again", so the grid never has a hole.
            again = Ui.Card(this, null, 0, 0, TileW, TileH);
            Ui.Icon(again, "", Theme.Ink2, 14, 14);
            L(again, "Check again", Theme.Strong, Theme.Ink, 44, 12, TileW - 56, 22);
            againWhen = L(again, "", Theme.Small, Theme.Mute, 44, 34, TileW - 56, 34);
            Ui.ButtonRight(again, "Check now", false, TileW - 14, 66).Click += delegate { Fill(); };

            // 3. A small picture of your play: length of the last games, and today's total against the break reminder.
            var play = Ui.Card(this, "Your last games", X0, Y0 + 152 + 2 * (TileH + Gap), W0, 150);
            lengths = new Bars { Bounds = Theme.R(16, 40, 390, 100), Color = Theme.Orange, HighlightLast = true, Empty = "Play a custom game and its length shows up here." };
            play.Controls.Add(lengths);
            L(play, "Played today", Theme.Small, Theme.Ink2, 440, 46, 200, 20);
            todayText = L(play, "", Theme.Big, Theme.Ink, 440, 68, 130, 32);
            today = new BarRow { Bounds = Theme.R(574, 74, 186, 24), LabelWidth = 0, ValueWidth = 0, Gradient = true };
            play.Controls.Add(today);
            lengthsNote = L(play, "", Theme.Small, Theme.Mute, 440, 108, 320, 20);
        }

        Pill HeroPill(Card hero, int x)
        {
            var p = new Pill { Left = Theme.Px(x), Top = Theme.Px(94) };
            hero.Controls.Add(p);
            p.Set("Off", false);
            return p;
        }

        /// Pills sit in one row after each other, the Settings link right after them.
        void LayoutPills()
        {
            var x = autoPill.Left;
            foreach (var p in new[] { autoPill, musicPill, breakPill }) { p.Left = x; x = p.Right + Theme.Px(8); }
            change.Left = x + Theme.Px(4);
        }

        void Fix(int i)
        {
            if (i >= checks.Count) return;
            var c = checks[i];
            if (c.FixLabel.IndexOf("restart", StringComparison.OrdinalIgnoreCase) >= 0 &&
                MessageBox.Show(this, "Restart Windows now? Save your work first.", Program.Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            string text;
            var ok = GameMode.Fix(c.Id, out text);
            Ui.Set(heroSub, string.IsNullOrEmpty(text) ? (ok ? "Done." : "That did not work.") : text, ok ? Theme.Good : Theme.Warn);
            noteUntil = DateTime.UtcNow.AddSeconds(8);
            Win.Log("Game mode fix " + c.Id + ": " + (ok ? "done" : "failed") + (string.IsNullOrEmpty(text) ? "" : " (" + text + ")"));
            Fill();
        }

        void Fill()
        {
            var all = new List<PcCheck>();
            all.AddRange(GameMode.BeforeNight() ?? new List<PcCheck>());
            all.AddRange(GameMode.Fixes() ?? new List<PcCheck>());
            // Things to fix first, then the ones that are fine.
            checks = all.Where(c => c.Problem).Concat(all.Where(c => !c.Problem)).Take(Slots).ToList();
            var problems = all.Count(c => c.Problem);
            for (var i = 0; i < Slots; i++)
            {
                var has = i < checks.Count;
                Ui.Show(tiles[i], has);
                if (!has) continue;
                var c = checks[i];
                Ui.Set(tileIcon[i], c.Problem ? "" : "", c.Problem ? Theme.Warn : Theme.Good);
                Ui.Set(tileTitle[i], c.Title);
                Ui.Set(tileDetail[i], c.Detail);
                var canFix = c.Problem && c.FixLabel != "";
                Ui.Show(tileFix[i], canFix);
                Ui.Show(tileOk[i], !canFix);
                Ui.Set(tileOk[i], c.Problem ? "Worth a look" : "All good", c.Problem ? Theme.Warn : Theme.Good);
                if (canFix)
                {
                    tileFix[i].Text = c.FixLabel;
                    tileFix[i].FitWidth();
                    tileFix[i].Left = tiles[i].Width - Theme.Px(14) - tileFix[i].Width;
                    tileFix[i].AccessibleDescription = c.Title;
                }
            }
            checkedAt = DateTime.Now;
            Ui.Set(againWhen, "Last checked at " + checkedAt.ToString("HH:mm", Ui.En));
            Ui.Show(again, checks.Count < Slots);
            if (checks.Count < Slots) again.Location = tiles[checks.Count].Location;
            ring.Set(all.Count - problems, all.Count);
            Ui.Set(heroTitle, all.Count == 0 ? "Checking your PC…" : problems == 0 ? "Ready for game night" : problems == 1 ? "1 quick fix before game night" : problems + " quick fixes before game night");
            if (DateTime.UtcNow >= noteUntil)
                Ui.Set(heroSub, problems == 0 ? "Everything below looks right on this PC." : "Fixes only happen when you click them. Nothing changes by itself.", Theme.Ink2);
            Win.SetBadge(problems);
            FillPlay();
        }

        void FillPlay()
        {
            var games = PerfMon.LastGames() ?? new List<GameReport>();
            var shown = games.Take(5).Reverse().ToList(); // oldest left, newest right
            var mins = shown.Select(g => (float)Math.Max(1, (g.End - g.Start).TotalMinutes)).ToList();
            var top = mins.Count == 0 ? 1f : Math.Max(30f, mins.Max());
            lengths.Values = mins.Select(m => 100f * m / top).ToArray();
            lengths.TopLabels = mins.Select(m => Math.Round(m) + " min").ToArray();
            lengths.BottomLabels = shown.Select(g => g.Start.ToString("ddd", Ui.En)).ToArray();
            lengths.Invalidate();
            var played = TimeSpan.Zero;
            foreach (var g in games) if (g.Start.Date == DateTime.Today) played += g.End - g.Start;
            var start = PcServices.GameStartedAt;
            if (start.HasValue) played += DateTime.Now - start.Value;
            Ui.Set(todayText, played.TotalMinutes < 1 ? "–" : played.TotalHours >= 1 ? (int)played.TotalHours + " h " + played.Minutes + " min" : played.Minutes + " min");
            today.Set("", (float)(played.TotalMinutes / 120.0), "");
            Ui.Set(lengthsNote, S.BreakReminder ? "Full bar = 2 hours, then the break reminder." : "Full bar = 2 hours of play.");
        }

        public override void Shown() { slow = 0; Fill(); }

        public override void Tick()
        {
            var auto = S.GameModeAuto;
            autoPill.Set(auto ? "Automatic: on" : "Automatic: off", auto);
            musicPill.Set(S.MusicQuieter ? "Music quieter: on" : "Music quieter: off", auto && S.MusicQuieter);
            breakPill.Set(S.BreakReminder ? "Break reminder: on" : "Break reminder: off", auto && S.BreakReminder);
            LayoutPills();
            var start = PcServices.GameStartedAt;
            var active = GameMode.Active;
            Ui.Set(stateBig, start.HasValue ? Ui.Clock(DateTime.Now - start.Value) : "No game", start.HasValue ? Theme.Ink : Theme.Mute);
            Ui.Set(stateCaption, start.HasValue ? (active ? "in game · game mode on" : "in game") : auto ? "game mode starts with the game" : "automatic game mode is off");
            if (noteUntil != DateTime.MinValue && DateTime.UtcNow >= noteUntil) { noteUntil = DateTime.MinValue; Fill(); }
            if (++slow % 30 == 0) FillPlay();
        }
    }

    /// Ring that fills with the share of checks that are fine; the count sits in the middle.
    class ReadyRing : Control
    {
        int ok, total = -1;

        public ReadyRing()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Card;
            TabStop = false;
            AccessibleRole = AccessibleRole.ProgressBar;
        }

        public void Set(int okCount, int totalCount)
        {
            if (okCount == ok && totalCount == total) return;
            ok = okCount;
            total = totalCount;
            AccessibleName = total <= 0 ? "Checking" : ok + " of " + total + " checks fine";
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float w = Theme.Px(10);
            var r = new RectangleF(w / 2f + 1, w / 2f + 1, Width - w - 2, Height - w - 2);
            using (var track = new Pen(Color.FromArgb(28, 255, 255, 255), w)) g.DrawEllipse(track, r);
            if (total > 0 && ok > 0)
            {
                var sweep = ok == total ? 359.9f : 360f * ok / total;
                using (var b = ok == total ? (Brush)new SolidBrush(Theme.Good) : Theme.Sunset(r, 45f))
                using (var p = new Pen(b, w) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                    g.DrawArc(p, r, -90, sweep);
            }
            var big = total <= 0 ? "…" : ok + "/" + total;
            TextRenderer.DrawText(g, big, Theme.Big, new Rectangle(0, 0, Width, Height - Theme.Px(12)), Theme.Ink,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "checks fine", Theme.Tiny, new Rectangle(0, Height / 2 + Theme.Px(10), Width, Theme.Px(18)), Theme.Mute,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPadding);
        }
    }

    /// Mic level as seven small bars.
    class MicMeter : Control
    {
        float level;
        public bool Muted;

        public MicMeter()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Theme.Card;
            TabStop = false;
            AccessibleRole = AccessibleRole.ProgressBar;
            AccessibleName = "Microphone level";
        }

        public float Level { set { var v = Math.Max(0, Math.Min(1, value)); if (Math.Abs(v - level) > .02f) { level = v; Invalidate(); } } }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            const int n = 7;
            var w = Width / (float)n;
            for (var i = 0; i < n; i++)
            {
                var h = Height * (.35f + .65f * i / (n - 1));
                var on = !Muted && level * n > i + .2f;
                var r = new RectangleF(i * w + w * .2f, Height - h, w * .6f, h);
                using (var path = Theme.Round(r, w * .3f))
                using (var b = new SolidBrush(on ? Theme.Good : Color.FromArgb(40, 255, 255, 255))) g.FillPath(b, path);
            }
        }
    }

    /// One sound output (headset, speakers, monitor); the chosen one gets the sunset tint and a filled radio dot.
    class OutputTile : PaintedControl
    {
        public AudioDevice Device;

        public OutputTile() { Size = Theme.R(0, 0, 250, 104).Size; AccessibleRole = AccessibleRole.RadioButton; }

        public static string Kind(string name)
        {
            var n = (name ?? "").ToLowerInvariant();
            if (n.Contains("headset") || n.Contains("headphone") || n.Contains("kopfh") || n.Contains("casque")) return "Headset";
            if (n.Contains("hdmi") || n.Contains("displayport") || n.Contains("monitor") || n.Contains("display")) return "Monitor";
            if (n.Contains("speaker") || n.Contains("lautsprecher") || n.Contains("realtek")) return "Speakers";
            return "Output";
        }

        public void Set(AudioDevice d)
        {
            if (Device != null && d.Id == Device.Id && d.Name == Device.Name && d.IsDefault == Device.IsDefault) return; // nothing new: no repaint
            Device = d;
            Ui.TipIfCut(this, d.Name, Theme.Small, Width - Theme.Px(32), d.Name);
            AccessibleName = Kind(d.Name) + ", " + d.Name;
            AccessibleDescription = d.IsDefault ? "In use" : "Click to use";
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Device == null) return;
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new RectangleF(.5f, .5f, Width - 1.5f, Height - 1.5f);
            var radius = Theme.Px(Theme.CardRadius);
            var on = Device.IsDefault;
            using (var path = Theme.Round(r, radius))
            {
                using (var b = new SolidBrush(Hover ? Theme.NavActive : Theme.Card)) g.FillPath(b, path);
                if (on)
                {
                    using (var b = new LinearGradientBrush(r, Color.FromArgb(40, Theme.Pink), Color.FromArgb(18, Theme.Orange), 35f)) g.FillPath(b, path);
                    using (var p = new Pen(Color.FromArgb(140, 0xff, 0x78, 0x6e))) g.DrawPath(p, path);
                }
                else using (var p = new Pen(Theme.Border)) g.DrawPath(p, path);
            }
            var kind = Kind(Device.Name);
            var glyph = kind == "Headset" ? "\uE7F6" : kind == "Monitor" ? "\uE7F4" : "\uE7F5";
            var pad = Theme.Px(16);
            TextRenderer.DrawText(g, glyph, Theme.GlyphBig, new Point(pad - Theme.Px(2), Theme.Px(16)), on ? Theme.Ink : Theme.Ink2, TextFormatFlags.NoPadding);
            var dot = new RectangleF(Width - pad - Theme.Px(18), Theme.Px(16), Theme.Px(18), Theme.Px(18));
            if (on)
            {
                using (var b = new SolidBrush(Theme.Pink)) g.FillEllipse(b, dot);
                using (var b = new SolidBrush(Theme.Ink)) g.FillEllipse(b, RectangleF.Inflate(dot, -Theme.Px(5), -Theme.Px(5)));
            }
            else using (var p = new Pen(Theme.BorderHi, 1.2f * Theme.Scale)) g.DrawEllipse(p, dot);
            const TextFormatFlags f = TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding;
            TextRenderer.DrawText(g, kind, Theme.Strong, new Rectangle(pad, Height - Theme.Px(52), Width - 2 * pad, Theme.Px(22)), Theme.Ink, f);
            TextRenderer.DrawText(g, Device.Name, Theme.Small, new Rectangle(pad, Height - Theme.Px(30), Width - 2 * pad, Theme.Px(20)), Theme.Mute, f);
            Ring(g, r, radius);
        }
    }

    class AudioPage : Page
    {
        const int Slots = 6;
        Label micIcon, micTitle, micName, outLabel, outEmpty;
        MicMeter meter;
        KeysView micKeys, outKeys;
        FlatButton mute;
        readonly OutputTile[] outputs = new OutputTile[Slots];
        Card hotCard, alertCard;
        Pill hotPill, soundPill, badgePill;
        readonly System.Windows.Forms.Timer meterTimer = new System.Windows.Forms.Timer { Interval = 120 };

        public AudioPage(MainWindow w) : base(w, "Audio")
        {
            Heading("Audio", "Audio");
            var mic = Ui.Card(this, null, X0, Y0, W0, 70);
            micIcon = L(mic, "\uE720", Theme.Glyph, Theme.Good, 16, 15, 40, 40);
            micIcon.TextAlign = ContentAlignment.MiddleCenter;
            micIcon.BackColor = Theme.NavActive;
            micIcon.AccessibleRole = AccessibleRole.Graphic;
            micTitle = L(mic, "", Theme.Strong, Theme.Ink, 70, 23, 170, 24);
            meter = new MicMeter { Bounds = Theme.R(240, 24, 70, 22) };
            mic.Controls.Add(meter);
            micName = L(mic, "", Theme.Small, Theme.Ink2, 326, 25, 230, 20);
            mute = Ui.ButtonRight(mic, "Mute", false, W0 - 16, 18);
            mute.Click += delegate { AudioCtl.ToggleMic(); Tick(); };
            micKeys = new KeysView(new[] { "Ctrl", "Alt", "M" });
            micKeys.Location = new Point(mute.Left - Theme.Px(14) - micKeys.Width, Theme.Px(23));
            mic.Controls.Add(micKeys);

            outLabel = L(this, "Output", Theme.CardTitle, Theme.Ink, X0, Y0 + 86, 200, 26);
            outKeys = new KeysView(new[] { "Ctrl", "Alt", "H" });
            outKeys.Location = new Point(Theme.Px(X0 + W0) - outKeys.Width, Theme.Px(Y0 + 88));
            Controls.Add(outKeys);
            outEmpty = L(this, "No sound outputs found on this PC.", Theme.Body, Theme.Mute, X0, Y0 + 130, W0, 30);
            for (var i = 0; i < Slots; i++)
            {
                outputs[i] = new OutputTile { Location = new Point(Theme.Px(X0 + i % 3 * 263), Theme.Px(Y0 + 120 + i / 3 * 116)), Visible = false };
                var tile = outputs[i];
                tile.Click += delegate { if (tile.Device != null && AudioCtl.SetOutput(tile.Device.Id)) RefreshAll(); };
                Controls.Add(tile);
            }

            // Hotkeys and mute alerts: what is set, read-only. The switches are in Settings.
            hotCard = Ui.Card(this, "Hotkeys", X0, Y0 + 246, 513, 156);
            hotPill = new Pill { AnchorRight = hotCard.Width - Theme.Px(16), Top = Theme.Px(14) };
            hotCard.Controls.Add(hotPill);
            HelpPage.KeyRow(hotCard, "Mute or unmute mic", new[] { "Ctrl", "Alt", "M" }, 46, 513);
            HelpPage.KeyRow(hotCard, "Next sound output", new[] { "Ctrl", "Alt", "H" }, 80, 513);
            L(hotCard, "They work everywhere, also in game. Muting is done in Windows, so Discord and League go quiet too.", Theme.Small, Theme.Mute, 16, 110, 481, 38);

            alertCard = Ui.Card(this, "When you mute", X0 + 526, Y0 + 246, 250, 156);
            soundPill = AlertRow(alertCard, "\uE767", "Short sound", 46);
            badgePill = AlertRow(alertCard, "\uE7F4", "\"Muted\" badge", 80);
            Ui.Link(alertCard, "Change in Settings", 238, 118).Click += delegate { Win.OpenSettings("Audio"); };

            meterTimer.Tick += delegate { meter.Muted = AudioCtl.MicMuted; meter.Level = AudioCtl.MicLevel; };
        }

        static Pill AlertRow(Card card, string glyph, string text, int y)
        {
            Ui.Icon(card, glyph, Theme.Ink2, 14, y + 1);
            L(card, text, Theme.Body, Theme.Ink, 46, y, 130, 26).TextAlign = ContentAlignment.MiddleLeft;
            var p = new Pill { AnchorRight = card.Width - Theme.Px(16), Top = Theme.Px(y + 2) };
            card.Controls.Add(p);
            return p;
        }

        int outTicks;

        public override void Shown() { outTicks = 0; meterTimer.Start(); }

        /// Everything now, the output list included (after a switch).
        public void RefreshAll() { outTicks = 0; Tick(); }

        public override void Hidden() { meterTimer.Stop(); }

        public override void Tick()
        {
            var name = AudioCtl.MicName;
            var muted = AudioCtl.MicMuted;
            var none = string.IsNullOrEmpty(name);
            Ui.Set(micTitle, none ? "No microphone" : muted ? "Microphone muted" : "Microphone on");
            Ui.Set(micIcon, muted ? "\uF781" : "\uE720", none ? Theme.Mute : muted ? Theme.Bad : Theme.Good);
            Ui.Set(micName, none ? "Not available on this PC" : name);
            meter.Muted = muted;
            mute.Enabled = !none;
            mute.Text = muted ? "Unmute" : "Mute";
            mute.Glyph = muted ? "\uE720" : "\uF781";
            mute.FitWidth();
            mute.Left = Theme.Px(W0 - 16) - mute.Width;
            micKeys.Visible = outKeys.Visible = S.Hotkeys;
            micTitle.Width = TextRenderer.MeasureText(micTitle.Text, micTitle.Font).Width + Theme.Px(4);
            meter.Left = micTitle.Right + Theme.Px(12);
            micName.Left = meter.Right + Theme.Px(16);
            micKeys.Left = mute.Left - Theme.Px(14) - micKeys.Width;

            // The device list (~4 ms) is read every 3 s; a switch made here or by hotkey refreshes it at once (RefreshAll).
            if (outTicks++ % 3 != 0) return;
            var outs = AudioCtl.Outputs() ?? new List<AudioDevice>();
            for (var i = 0; i < Slots; i++)
            {
                Ui.Show(outputs[i], i < outs.Count);
                if (i < outs.Count) outputs[i].Set(outs[i]);
            }
            Ui.Show(outEmpty, outs.Count == 0);
            var rows = Math.Max(1, (Math.Min(outs.Count, Slots) + 2) / 3);
            hotCard.Top = alertCard.Top = Theme.Px(Y0 + 120 + rows * 116 + (outs.Count == 0 ? -40 : 0)) + Theme.Px(10);
            hotPill.Set(S.Hotkeys ? "On" : "Off", S.Hotkeys);
            soundPill.Set(S.MuteSound ? "On" : "Off", S.MuteSound);
            badgePill.Set(S.MutedBadge ? "On" : "Off", S.MutedBadge);
        }

        protected override void Dispose(bool disposing) { if (disposing) meterTimer.Dispose(); base.Dispose(disposing); }
    }
}
