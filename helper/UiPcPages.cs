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

    class GameModePage : Page
    {
        const int Slots = 4;
        Card before, fixes;
        readonly Label[][] beforeRows = new Label[Slots][], fixRows = new Label[Slots][];
        readonly FlatButton[] beforeFix = new FlatButton[Slots], fixFix = new FlatButton[Slots];
        List<PcCheck> beforeList = new List<PcCheck>(), fixList = new List<PcCheck>();
        Label note, nowIcon, nowTitle, nowText;
        Pill autoPill, musicPill, breakPill;

        public GameModePage(MainWindow w) : base(w, "Game mode")
        {
            Heading("Game mode", "Game mode");

            before = Ui.Card(this, "Before game night", X0, Y0, 382, 200);
            fixes = Ui.Card(this, "Gamer fixes", X0, Y0 + 214, 382, 260);
            for (var i = 0; i < Slots; i++)
            {
                beforeRows[i] = Row(before, i, out beforeFix[i]);
                fixRows[i] = Row(fixes, i, out fixFix[i]);
                var k = i;
                beforeFix[i].Click += delegate { Fix(beforeList, k); };
                fixFix[i].Click += delegate { Fix(fixList, k); };
            }
            note = L(this, "", Theme.Small, Theme.Ink2, X0, Y0 + 480, 382, 40);

            // Right column: what game mode does, read-only. The switches are in Settings.
            const int rx = X0 + 394, rw = 382;
            var when = Ui.Card(this, "When a game starts", rx, Y0, rw, 230);
            Ui.Link(when, "Change in Settings", rw - 12, 12).Click += delegate { Win.OpenSettings("Game mode"); };
            autoPill = StateRow(when, "", "Automatic game mode", "On while a League game runs", 46, true);
            musicPill = StateRow(when, "", "Music quieter in game", "Music apps at 30 % while you play", 106, true);
            breakPill = StateRow(when, "", "Break reminder", "A short nudge after 2 hours of play", 166, false);

            var now = Ui.Card(this, "Right now", rx, Y0 + 244, rw, 120);
            nowIcon = L(now, "", Theme.GlyphBig, Theme.Ink2, 16, 50, 40, 40);
            nowIcon.TextAlign = ContentAlignment.MiddleCenter;
            nowIcon.BackColor = Theme.NavActive;
            nowIcon.AccessibleRole = AccessibleRole.Graphic;
            nowTitle = L(now, "", Theme.Strong, Theme.Ink, 70, 48, 296, 22);
            nowText = L(now, "", Theme.Small, Theme.Mute, 70, 70, 296, 40);

            var safe = Ui.Card(this, null, rx, Y0 + 378, rw, 96);
            Ui.Icon(safe, "", Theme.Good, 16, 18);
            L(safe, "Safe to leave on", Theme.Strong, Theme.Ink, 50, 16, 316, 22);
            L(safe, "No admin rights, League itself is never touched, and the music volume goes back when the game ends.", Theme.Small, Theme.Ink2, 50, 40, 316, 44);
        }

        Pill StateRow(Card card, string glyph, string title, string sub, int y, bool divider)
        {
            Ui.Icon(card, glyph, Theme.Ink2, 14, y + 10);
            L(card, title, Theme.Body, Theme.Ink, 48, y, 250, 22);
            L(card, sub, Theme.Small, Theme.Mute, 48, y + 22, 250, 20);
            var p = new Pill { AnchorRight = card.Width - Theme.Px(16), Top = Theme.Px(y + 9) };
            card.Controls.Add(p);
            p.Set("Off", false);
            if (divider) Ui.Divider(card, 16, y + 52, 350);
            return p;
        }

        Label[] Row(Card card, int i, out FlatButton fix)
        {
            var y = 46 + i * 56;
            var icon = Ui.Icon(card, "", Theme.Good, 14, y + 8);
            var title = L(card, "", Theme.Body, Theme.Ink, 48, y, 210, 24);
            var detail = L(card, "", Theme.Small, Theme.Mute, 48, y + 23, 210, 20);
            fix = Ui.ButtonRight(card, "Fix", false, 366, y + 4);
            return new[] { icon, title, detail };
        }

        void Fix(List<PcCheck> list, int i)
        {
            if (i >= list.Count) return;
            var c = list[i];
            if (c.FixLabel.IndexOf("restart", StringComparison.OrdinalIgnoreCase) >= 0 &&
                MessageBox.Show(this, "Restart Windows now? Save your work first.", Program.Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            string text;
            var ok = GameMode.Fix(c.Id, out text);
            Ui.Set(note, string.IsNullOrEmpty(text) ? (ok ? "Done." : "That did not work.") : text, ok ? Theme.Ink2 : Theme.Warn);
            Win.Log("Game mode fix " + c.Id + ": " + (ok ? "done" : "failed") + (string.IsNullOrEmpty(text) ? "" : " (" + text + ")"));
            Fill();
        }

        void Fill()
        {
            beforeList = GameMode.BeforeNight() ?? new List<PcCheck>();
            fixList = GameMode.Fixes() ?? new List<PcCheck>();
            var h1 = Show(before, beforeRows, beforeFix, beforeList, "Nothing to check right now.");
            before.Height = Theme.Px(h1);
            fixes.Top = before.Bottom + Theme.Px(14);
            var h2 = Show(fixes, fixRows, fixFix, fixList, "Nothing to fix: your settings look right.");
            fixes.Height = Theme.Px(h2);
            note.Top = fixes.Bottom + Theme.Px(10);
            var problems = 0;
            foreach (var c in beforeList) if (c.Problem) problems++;
            foreach (var c in fixList) if (c.Problem) problems++;
            Win.SetBadge(problems);
        }

        static int Show(Card card, Label[][] rows, FlatButton[] buttons, List<PcCheck> list, string empty)
        {
            for (var i = 0; i < Slots; i++)
            {
                var has = i < list.Count || (i == 0 && list.Count == 0);
                foreach (var l in rows[i]) Ui.Show(l, has);
                Ui.Show(buttons[i], i < list.Count && list[i].FixLabel != "");
                if (!has) continue;
                if (list.Count == 0)
                {
                    Ui.Set(rows[0][0], "\uE930", Theme.Good);
                    Ui.Set(rows[0][1], empty);
                    rows[0][1].Width = card.Width - Theme.Px(64);
                    Ui.Set(rows[0][2], "");
                    continue;
                }
                var c = list[i];
                Ui.Set(rows[i][0], c.Problem ? "\uE7BA" : "\uE930", c.Problem ? Theme.Warn : Theme.Good);
                Ui.Set(rows[i][1], c.Title);
                Ui.Set(rows[i][2], c.Detail);
                var btnW = c.FixLabel != "" ? buttons[i].Width : 0;
                if (c.FixLabel != "")
                {
                    buttons[i].Text = c.FixLabel;
                    buttons[i].FitWidth();
                    buttons[i].Left = card.Width - Theme.Px(16) - buttons[i].Width;
                    buttons[i].AccessibleDescription = c.Title;
                    btnW = buttons[i].Width;
                }
                rows[i][1].Width = rows[i][2].Width = card.Width - Theme.Px(48 + 24) - btnW;
            }
            return 46 + Math.Max(1, Math.Min(Slots, list.Count)) * 56 + 6;
        }

        public override void Shown() { Fill(); }

        public override void Tick()
        {
            var auto = S.GameModeAuto;
            autoPill.Set(auto ? "On" : "Off", auto);
            musicPill.Set(S.MusicQuieter ? "On" : "Off", auto && S.MusicQuieter);
            breakPill.Set(S.BreakReminder ? "On" : "Off", auto && S.BreakReminder);
            var active = GameMode.Active;
            var start = PcServices.GameStartedAt;
            Ui.Set(nowIcon, active ? "" : start.HasValue ? "" : "", active ? Theme.Good : Theme.Ink2);
            Ui.Set(nowTitle, active ? "Game mode is on" : start.HasValue ? "In game · " + Ui.Clock(DateTime.Now - start.Value) : "No game right now");
            Ui.Set(nowText, active ? (GameMode.ActiveText == "" ? "Everything goes back to normal when the game ends." : GameMode.ActiveText + ". Back to normal when the game ends.")
                : !auto ? "Automatic is off: nothing changes when a game starts."
                : S.MusicQuieter ? "When a game starts, music gets quieter. It goes back when the game ends."
                : "Nothing to change when a game starts: music quieter is off.");
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
