// Bridge Night Helper: the Performance page with tabs Live, Last game and Apps.
// Measures only while this page is on screen and "Measure" is on (Settings.LiveMeasure).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Windows.Forms;

namespace BridgeNight
{
    /// Small box with a colour square, a name, a grey line and a big value (chart legend, stat cards).
    class StatBox : Control
    {
        public Color Swatch = Color.Empty;
        public string Caption = "", Sub = "", Value = "";
        public bool BigValueBelow;   // stat card layout: caption, big value, grey line under it

        public StatBox()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
            TabStop = false;
            AccessibleRole = AccessibleRole.StaticText;
        }

        public void Set(string caption, string sub, string value)
        {
            if (caption == Caption && sub == Sub && value == Value) return;
            Caption = caption; Sub = sub; Value = value;
            AccessibleName = caption + " " + value + (sub == "" ? "" : ", " + sub);
            Invalidate();
        }

        protected override void OnPaintBackground(PaintEventArgs e) { Ui.PaintParent(this, e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new RectangleF(.5f, .5f, Width - 1.5f, Height - 1.5f);
            using (var path = Theme.Round(r, Theme.Px(8)))
            {
                using (var b = new SolidBrush(BigValueBelow ? Theme.Card : Theme.NavActive)) g.FillPath(b, path);
                using (var p = new Pen(Theme.Border)) g.DrawPath(p, path);
            }
            var pad = Theme.Px(14);
            var x = pad;
            if (Swatch != Color.Empty)
            {
                var sq = Theme.Px(9);
                var sy = BigValueBelow ? Theme.Px(17) : Height / 2 - Theme.Px(12);
                using (var path = Theme.Round(new RectangleF(pad, sy, sq, sq), Theme.Px(2)))
                using (var b = new SolidBrush(Swatch)) g.FillPath(b, path);
                x += sq + Theme.Px(8);
            }
            const TextFormatFlags f = TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding;
            if (BigValueBelow)
            {
                TextRenderer.DrawText(g, Caption, Theme.Small, new Rectangle(x, Theme.Px(12), Width - x - pad, Theme.Px(20)), Theme.Ink2, f);
                TextRenderer.DrawText(g, Value, Theme.Big, new Rectangle(pad, Theme.Px(32), Width - 2 * pad, Theme.Px(34)), Theme.Ink, f);
                TextRenderer.DrawText(g, Sub, Theme.Small, new Rectangle(pad, Height - Theme.Px(28), Width - 2 * pad, Theme.Px(20)), Theme.Mute, f);
                return;
            }
            var vw = TextRenderer.MeasureText(Value, Theme.Big).Width;
            TextRenderer.DrawText(g, Caption, Theme.Strong, new Rectangle(x, Height / 2 - Theme.Px(19), Width - x - vw - pad, Theme.Px(20)), Theme.Ink, f);
            TextRenderer.DrawText(g, Sub, Theme.Small, new Rectangle(x, Height / 2 + Theme.Px(1), Width - x - vw - pad, Theme.Px(20)), Theme.Mute, f);
            TextRenderer.DrawText(g, Value, Theme.Big, new Rectangle(0, 0, Width - pad, Height), Theme.Ink, f | TextFormatFlags.Right | TextFormatFlags.VerticalCenter);
        }
    }

    class PerformancePage : Page
    {
        readonly Backdrop[] tabs = new Backdrop[3];
        Segmented tabPicker;
        SummaryChip chip;
        int slow;

        // Live
        StatBox gpuBox, cpuBox, memBox, vramBox;
        Chart liveChart, diskChart, netChart;
        Bars threads;
        Label threadsInfo, busiest, memTotal, diskText, netText, tipText, uptimeTitle, uptimeText;
        BarRow memUse, memCached, memFree;
        // Last game
        Chart gameChart;
        Label gameWhen, limitText, limitSub;
        StatBox[] gameStats = new StatBox[5];
        Bars lastFive;
        // Apps
        readonly Label[] appLetter = new Label[6], appName = new Label[6], appKept = new Label[6];
        readonly BarRow[] appBar = new BarRow[6];
        readonly FlatButton[] appClose = new FlatButton[6];
        readonly Label[] startName = new Label[5], startWhere = new Label[5];
        readonly BarRow[] drives = new BarRow[3];
        Label appsNote, startEmpty, upValue, procValue, restartValue;

        public PerformancePage(MainWindow w) : base(w, "Performance")
        {
            Heading("Performance", "Performance");
            tabPicker = new Segmented("Performance view", new[] { "Live", "Last game", "Apps" }, 14);
            tabPicker.Location = new Point(Theme.Px(X0 + W0) - tabPicker.Width, Theme.Px(22));
            tabPicker.Changed += delegate { ShowTab(); };
            Controls.Add(tabPicker);
            // Measuring on/off and how often live in Settings; the chip only says what is set.
            chip = new SummaryChip("") { AnchorRight = tabPicker.Left - Theme.Px(12) };
            chip.Top = tabPicker.Top + (tabPicker.Height - chip.Height) / 2;
            Controls.Add(chip);
            SyncChip();

            for (var i = 0; i < 3; i++)
            {
                tabs[i] = new Backdrop { Bounds = Theme.R(0, 70, PageW, PageH - 70), Visible = i == 0 };
                Controls.Add(tabs[i]);
            }
            BuildLive(tabs[0]);
            BuildLastGame(tabs[1]);
            BuildApps(tabs[2]);
        }

        public int Tab { get { return tabPicker.Selected; } set { tabPicker.Selected = value; ShowTab(); } }

        void ShowTab()
        {
            for (var i = 0; i < 3; i++) Ui.Show(tabs[i], i == tabPicker.Selected);
            slow = 0;
            if (Visible) Tick();
        }

        void SyncChip()
        {
            if (S.LiveMeasure) chip.Set("Measuring every " + S.MeasureEvery + " s", Theme.Good);
            else chip.Set("Live measuring is off", Theme.Mute);
        }

        /* ---------------------------------------------------------------- Live */

        void BuildLive(Control p)
        {
            var big = Ui.Card(p, null, X0, 4, W0, 250);
            gpuBox = Box(big, Theme.GpuLine, 0);
            cpuBox = Box(big, Theme.CpuLine, 1);
            memBox = Box(big, Theme.MemLine, 2);
            vramBox = Box(big, Theme.VramLine, 3);
            liveChart = new Chart { Bounds = Theme.R(234, 16, W0 - 250, 220) };
            big.Controls.Add(liveChart);

            var th = Ui.Card(p, "CPU threads", X0, 268, 250, 176);
            threadsInfo = L(th, "", Theme.Small, Theme.Mute, 120, 15, 114, 20);
            threadsInfo.TextAlign = ContentAlignment.TopRight;
            threads = new Bars { Bounds = Theme.R(16, 48, 218, 84), Empty = "Measuring…" };
            th.Controls.Add(threads);
            busiest = L(th, "", Theme.Small, Theme.Mute, 16, 142, 218, 20);

            var mem = Ui.Card(p, "Memory", X0 + 263, 268, 250, 176);
            memTotal = L(mem, "", Theme.Small, Theme.Mute, 120, 15, 114, 20);
            memTotal.TextAlign = ContentAlignment.TopRight;
            memUse = MemRow(mem, 52, Theme.MemLine);
            memCached = MemRow(mem, 88, Color.FromArgb(0x5a, 0x6a, 0x96));
            memFree = MemRow(mem, 124, Theme.BorderHi);

            var io = Ui.Card(p, "Disk & network", X0 + 526, 268, 250, 176);
            L(io, "live", Theme.Small, Theme.Mute, 180, 15, 54, 20).TextAlign = ContentAlignment.TopRight;
            diskText = L(io, "", Theme.Small, Theme.Ink2, 16, 44, 218, 20);
            diskChart = new Chart { Bounds = Theme.R(16, 66, 218, 34), AutoMax = true, Max = 1, Empty = "" };
            io.Controls.Add(diskChart);
            netText = L(io, "", Theme.Small, Theme.Ink2, 16, 108, 218, 20);
            netChart = new Chart { Bounds = Theme.R(16, 130, 218, 34), AutoMax = true, Max = 1, Empty = "" };
            io.Controls.Add(netChart);

            var tip = Ui.Card(p, null, X0, 458, 382, 96);
            Ui.Icon(tip, "\uEA80", Theme.Warn, 16, 18);
            L(tip, "Tip", Theme.Strong, Theme.Ink, 50, 16, 300, 22);
            tipText = L(tip, "", Theme.Small, Theme.Ink2, 50, 40, 316, 44);
            var up = Ui.Card(p, null, X0 + 394, 458, 382, 96);
            Ui.Icon(up, "\uE777", Theme.MemLine, 16, 18);
            uptimeTitle = L(up, "", Theme.Strong, Theme.Ink, 50, 16, 316, 22);
            uptimeText = L(up, "", Theme.Small, Theme.Ink2, 50, 40, 316, 44);
        }

        StatBox Box(Control card, Color c, int i)
        {
            var b = new StatBox { Bounds = Theme.R(16, 16 + i * 56, 204, 50), Swatch = c };
            card.Controls.Add(b);
            return b;
        }

        static BarRow MemRow(Control card, int y, Color c)
        {
            var r = new BarRow { Bounds = Theme.R(16, y, 218, 26), Color = c, LabelWidth = 64, ValueWidth = 64 };
            card.Controls.Add(r);
            return r;
        }

        void TickLive()
        {
            var secs = PerfMon.IntervalSeconds * 60;
            // 60 samples: 60 s, 120 s or 5 min back.
            var unit = secs <= 120 ? " s" : " min";
            var span = secs <= 120 ? secs : secs / 60;
            var labels = new[] { span + unit, span * 4 / 5 + "", span * 3 / 5 + "", span * 2 / 5 + "", span / 5 + "", "now" };
            var p = S.LiveMeasure ? PerfMon.Latest : null;
            var h = S.LiveMeasure ? PerfMon.History(secs) : new List<PerfSample>();
            liveChart.Empty = S.LiveMeasure ? "Measuring…" : "Live measuring is off. Switch it on in Settings (Change, above).";
            liveChart.SetData(new List<Series>
            {
                new Series(Theme.MemLine, h.Select(x => x.MemTotalGb > 0 ? (float?)(x.MemUsedGb / x.MemTotalGb * 100) : null).ToArray(), false),
                new Series(Theme.VramLine, h.Select(x => x.VramUsedGb.HasValue && x.VramTotalGb.HasValue && x.VramTotalGb.Value > 0 ? (float?)(x.VramUsedGb.Value / x.VramTotalGb.Value * 100) : null).ToArray(), false),
                new Series(Theme.CpuLine, h.Select(x => x.Cpu).ToArray(), false),
                new Series(Theme.GpuLine, h.Select(x => x.Gpu).ToArray(), false),
            }, labels);
            diskChart.SetData(new List<Series> { new Series(Theme.MemLine, h.Select(x => (float?)(x.DiskReadMBs + x.DiskWriteMBs)).ToArray(), true) }, null);
            netChart.SetData(new List<Series> { new Series(Theme.Good, h.Select(x => (float?)((x.NetDownMBs + x.NetUpMBs) * 8)).ToArray(), true) }, null);

            if (p == null)
            {
                gpuBox.Set("GPU", "Graphics card", "–");
                cpuBox.Set("CPU", "Processor", "–");
                memBox.Set("Memory", "RAM", "–");
                vramBox.Set("VRAM", "Graphics memory", "–");
                threads.Values = new float[0];
                threads.Empty = S.LiveMeasure ? "Measuring…" : "Off";
                threads.Invalidate();
                foreach (var l in new[] { threadsInfo, busiest, memTotal }) Ui.Set(l, "");
                memUse.Set("In use", 0, "–"); memCached.Set("Cached", 0, "–"); memFree.Set("Free", 0, "–");
                Ui.Set(diskText, "Disk: –");
                Ui.Set(netText, "Network: –");
            }
            else
            {
                gpuBox.Set("GPU", p.GpuTempC.HasValue ? Math.Round(p.GpuTempC.Value) + " °C" : "Graphics card", Ui.Pct(p.Gpu));
                var n = p.CpuThreads == null ? 0 : p.CpuThreads.Length;
                cpuBox.Set("CPU", n > 0 ? n + " threads" : "Processor", Ui.Pct(p.Cpu));
                memBox.Set("Memory", p.MemUsedGb.ToString("0.0", Ui.En) + " / " + Math.Round(p.MemTotalGb) + " GB", p.MemTotalGb > 0 ? Ui.Pct(p.MemUsedGb / p.MemTotalGb * 100) : "–");
                if (p.VramUsedGb.HasValue && p.VramTotalGb.HasValue && p.VramTotalGb.Value > 0)
                    vramBox.Set("VRAM", p.VramUsedGb.Value.ToString("0.0", Ui.En) + " / " + Math.Round(p.VramTotalGb.Value) + " GB", Ui.Pct(p.VramUsedGb.Value / p.VramTotalGb.Value * 100));
                else vramBox.Set("VRAM", "Not available on this PC", "–");
                threads.Values = p.CpuThreads ?? new float[0];
                threads.Empty = "Not available on this PC";
                threads.Invalidate();
                Ui.Set(threadsInfo, n > 0 ? n + " threads" : "");
                Ui.Set(busiest, n > 0 ? "Busiest thread: " + Math.Round(p.CpuThreads.Max()) + " %" : "");
                var total = Math.Max(.1f, p.MemTotalGb);
                Ui.Set(memTotal, Math.Round(p.MemTotalGb) + " GB");
                memUse.Set("In use", p.MemUsedGb / total, Ui.Gb(p.MemUsedGb));
                memCached.Set("Cached", p.MemCachedGb / total, Ui.Gb(p.MemCachedGb));
                memFree.Set("Free", p.MemFreeGb / total, Ui.Gb(p.MemFreeGb));
                Ui.Set(diskText, "Disk: " + p.DiskReadMBs.ToString("0.#", Ui.En) + " MB/s read · " + p.DiskWriteMBs.ToString("0.#", Ui.En) + " write");
                Ui.Set(netText, "Network: " + (p.NetDownMBs * 8).ToString("0.#", Ui.En) + " Mbit/s down · " + (p.NetUpMBs * 8).ToString("0.#", Ui.En) + " up");
            }
            Ui.Set(tipText, p == null ? (S.LiveMeasure ? "Measuring…" : "Switch on live measuring in Settings to get tips.") : PerfMon.Tip() ?? "Nothing stands out: your PC has room to spare.");
            var upt = PerfMon.Uptime;
            Ui.Set(uptimeTitle, upt > TimeSpan.Zero ? "On for " + Ui.Span(upt) : "PC uptime");
            Ui.Set(uptimeText, PerfMon.RestartPending ? "Windows wants to restart. Restarting before game night frees memory and finishes updates."
                : upt.TotalDays >= 3 ? "A restart before game night frees memory that apps never gave back." : upt > TimeSpan.Zero ? "No restart needed." : "Not available on this PC");
        }

        /* ---------------------------------------------------------------- Last game */

        void BuildLastGame(Control p)
        {
            var c = Ui.Card(p, "Last game", X0, 4, W0, 250);
            gameWhen = L(c, "", Theme.Small, Theme.Mute, 110, 15, 300, 20);
            var lx = W0 - 16;
            foreach (var item in new[] { new KeyValuePair<string, Color>("Memory", Theme.MemLine), new KeyValuePair<string, Color>("CPU", Theme.CpuLine), new KeyValuePair<string, Color>("GPU", Theme.GpuLine) })
            {
                var w = TextRenderer.MeasureText(item.Key, Theme.Small).Width / Theme.Scale + 22;
                var lab = L(c, item.Key, Theme.Small, Theme.Ink2, (int)(lx - w), 15, (int)w + 4, 20);
                lab.Padding = new Padding(Theme.Px(14), 0, 0, 0); // room for the colour square
                var col = item.Value;
                lab.Paint += delegate (object o, PaintEventArgs e)
                {
                    using (var b = new SolidBrush(col)) e.Graphics.FillRectangle(b, 0, Theme.Px(5), Theme.Px(9), Theme.Px(9));
                };
                lx -= (int)w + 10;
            }
            gameChart = new Chart { Bounds = Theme.R(16, 46, W0 - 32, 192), Guide = 95, GuideText = "95 % line" };
            c.Controls.Add(gameChart);

            string[] caps = { "GPU · average", "CPU · average", "Memory · peak", "VRAM · peak", "GPU temp · peak" };
            Color[] cols = { Theme.GpuLine, Theme.CpuLine, Theme.MemLine, Theme.VramLine, Theme.Coral };
            for (var i = 0; i < 5; i++)
            {
                gameStats[i] = new StatBox { Bounds = Theme.R(X0 + i * 157, 268, 148, 90), Swatch = cols[i], BigValueBelow = true };
                gameStats[i].Set(caps[i], "", "–");
                p.Controls.Add(gameStats[i]);
            }

            var lim = Ui.Card(p, null, X0, 372, 470, 182);
            Ui.Icon(lim, "\uEC4A", Theme.Pink, 16, 18);
            L(lim, "What limited your PC", Theme.Strong, Theme.Ink, 50, 16, 400, 22);
            limitText = L(lim, "", Theme.Body, Theme.Ink2, 50, 42, 404, 70);
            limitSub = L(lim, "", Theme.Small, Theme.Mute, 50, 120, 404, 44);

            var five = Ui.Card(p, "GPU, last 5 games", X0 + 482, 372, 294, 182);
            L(five, "average", Theme.Small, Theme.Mute, 200, 15, 78, 20).TextAlign = ContentAlignment.TopRight;
            lastFive = new Bars { Bounds = Theme.R(16, 46, 262, 124), HighlightLast = true, TopLabels = new string[0], BottomLabels = new string[0], Empty = "No games yet" };
            five.Controls.Add(lastFive);
        }

        void TickLastGame()
        {
            var games = PerfMon.LastGames();
            var g = games.Count > 0 ? games[0] : null;
            gameChart.Empty = S.RecordLastGame ? "Play a custom game to see how your PC handled it." : "Recording is off. Switch on \"Record last game\" in Settings.";
            if (g == null)
            {
                Ui.Set(gameWhen, "");
                gameChart.SetData(new List<Series>(), null);
                foreach (var s in gameStats) s.Set(s.Caption, "", "–");
                Ui.Set(limitText, "Nothing yet.");
                Ui.Set(limitSub, "After your next custom game this shows whether the graphics card, the processor or memory held your PC back.");
            }
            else
            {
                var dur = g.End - g.Start;
                Ui.Set(gameWhen, g.Start.ToString("ddd HH:mm", Ui.En) + " · " + Ui.Clock(dur));
                var smp = g.Samples ?? new List<PerfSample>();
                var mins = Math.Max(1, (int)Math.Round(dur.TotalMinutes));
                gameChart.SetData(new List<Series>
                {
                    new Series(Theme.MemLine, smp.Select(x => x.MemTotalGb > 0 ? (float?)(x.MemUsedGb / x.MemTotalGb * 100) : null).ToArray(), false),
                    new Series(Theme.CpuLine, smp.Select(x => x.Cpu).ToArray(), false),
                    new Series(Theme.GpuLine, smp.Select(x => x.Gpu).ToArray(), false),
                }, new[] { "0", mins / 4 + " min", mins / 2 + " min", mins * 3 / 4 + " min", mins + " min" });
                gameStats[0].Set(gameStats[0].Caption, "peak " + Math.Round(g.GpuPeak) + " %", Math.Round(g.GpuAvg) + " %");
                gameStats[1].Set(gameStats[1].Caption, "peak " + Math.Round(g.CpuPeak) + " %", Math.Round(g.CpuAvg) + " %");
                gameStats[2].Set(gameStats[2].Caption, g.MemPeakGb.ToString("0.0", Ui.En) + " of " + Math.Round(g.MemTotalGb) + " GB",
                    g.MemTotalGb > 0 ? Math.Round(g.MemPeakGb / g.MemTotalGb * 100) + " %" : "–");
                gameStats[3].Set(gameStats[3].Caption, g.VramPeakGb.HasValue ? "graphics memory" : "not available", g.VramPeakGb.HasValue ? Ui.Gb(g.VramPeakGb.Value) : "–");
                gameStats[4].Set(gameStats[4].Caption, g.GpuTempPeakC.HasValue ? (g.GpuTempPeakC.Value < 85 ? "all fine" : "hot: check the fans") : "not available",
                    g.GpuTempPeakC.HasValue ? Math.Round(g.GpuTempPeakC.Value) + " °C" : "–");
                Ui.Set(limitText, string.IsNullOrEmpty(g.Limit) ? "No clear limit." : g.Limit);
                Ui.Set(limitSub, "Average GPU " + Math.Round(g.GpuAvg) + " %, CPU " + Math.Round(g.CpuAvg) + " %, memory peak " + g.MemPeakGb.ToString("0.0", Ui.En) + " GB.");
            }
            var old = games.AsEnumerable().Reverse().ToList();
            lastFive.Values = old.Select(x => x.GpuAvg).ToArray();
            lastFive.TopLabels = old.Select(x => Math.Round(x.GpuAvg) + "%").ToArray();
            lastFive.BottomLabels = old.Select(x => x.Start.ToString("ddd", Ui.En)).ToArray();
            lastFive.Invalidate();
        }

        /* ---------------------------------------------------------------- Apps */

        void BuildApps(Control p)
        {
            var most = Ui.Card(p, "Using the most", X0, 4, 470, 370);
            L(most, "memory", Theme.Small, Theme.Mute, 340, 15, 114, 20).TextAlign = ContentAlignment.TopRight;
            for (var i = 0; i < 6; i++)
            {
                var y = 48 + i * 50;
                appLetter[i] = L(most, "", Theme.SmallStrong, Theme.Ink, 16, y + 7, 28, 28);
                appLetter[i].TextAlign = ContentAlignment.MiddleCenter;
                appLetter[i].BackColor = Theme.Raised;
                appName[i] = L(most, "", Theme.Body, Theme.Ink, 56, y + 9, 140, 24);
                appBar[i] = new BarRow { Bounds = Theme.R(196, y + 8, 170, 26), LabelWidth = 0, ValueWidth = 66, Gradient = true };
                most.Controls.Add(appBar[i]);
                var name = i;
                appClose[i] = Ui.ButtonRight(most, "Close", false, 454, y + 4);
                appClose[i].Click += delegate { CloseApp(name); };
                appKept[i] = L(most, "Kept", Theme.Small, Theme.Mute, 384, y + 9, 70, 24);
                appKept[i].TextAlign = ContentAlignment.MiddleCenter;
                if (i < 5) Ui.Divider(most, 16, y + 46, 438);
            }
            appsNote = L(most, "", Theme.Small, Theme.Mute, 16, 344, 438, 20);

            var start = Ui.Card(p, "Starts with Windows", X0 + 482, 4, 294, 228);
            for (var i = 0; i < 5; i++)
            {
                startName[i] = L(start, "", Theme.Body, Theme.Ink, 16, 42 + i * 27, 160, 24);
                startWhere[i] = L(start, "", Theme.Small, Theme.Mute, 176, 43 + i * 27, 102, 22);
                startWhere[i].TextAlign = ContentAlignment.MiddleRight;
            }
            startEmpty = L(start, "", Theme.Small, Theme.Mute, 16, 44, 262, 40);
            var open = Ui.ButtonRight(start, "Change in Windows  ↗", false, 278, 182);
            open.Click += delegate { Ui.Open("ms-settings:startupapps"); };

            var dr = Ui.Card(p, "Drives", X0 + 482, 244, 294, 130);
            for (var i = 0; i < 3; i++)
            {
                drives[i] = new BarRow { Bounds = Theme.R(16, 44 + i * 26, 262, 26), LabelWidth = 92, ValueWidth = 84, Color = Theme.CpuLine };
                dr.Controls.Add(drives[i]);
            }

            upValue = StatCard(p, "PC on for", 0);
            procValue = StatCard(p, "Apps open", 1);
            restartValue = StatCard(p, "Windows restart", 2);
        }

        Label StatCard(Control p, string caption, int i)
        {
            var c = Ui.Card(p, null, X0 + i * 263, 388, 250, 86);
            L(c, caption, Theme.Small, Theme.Ink2, 16, 14, 218, 20);
            return L(c, "–", Theme.Big, Theme.Ink, 16, 36, 218, 36);
        }

        List<AppUse> apps = new List<AppUse>();

        void CloseApp(int i)
        {
            if (i >= apps.Count) return;
            var name = apps[i].Name;
            var ok = PerfMon.CloseApp(name);
            Ui.Set(appsNote, ok ? name + " was asked to close." : name + " could not be closed from here.", ok ? Theme.Mute : Theme.Warn);
            Win.Log(ok ? "Asked " + name + " to close" : "Could not close " + name);
        }

        static readonly Color[] LetterColors =
        {
            Color.FromArgb(0x3b, 0x6f, 0xd8), Color.FromArgb(0x58, 0x65, 0xf2), Color.FromArgb(0xc8, 0x9b, 0x3c),
            Color.FromArgb(0x2f, 0x8f, 0x5b), Color.FromArgb(0x9b, 0x4d, 0xca), Color.FromArgb(0xc2, 0x45, 0x6a),
        };

        void TickApps(bool full)
        {
            apps = PerfMon.TopApps(6) ?? new List<AppUse>();
            var top = apps.Count > 0 ? Math.Max(.1f, apps.Max(a => a.MemGb)) : 1f;
            for (var i = 0; i < 6; i++)
            {
                var has = i < apps.Count;
                foreach (Control c in new Control[] { appLetter[i], appName[i], appBar[i] }) Ui.Show(c, has);
                Ui.Show(appClose[i], has && apps[i].CanClose);
                Ui.Show(appKept[i], has && !apps[i].CanClose);
                if (!has) continue;
                var a = apps[i];
                var nm = string.IsNullOrEmpty(a.Name) ? "?" : a.Name;
                Ui.Set(appLetter[i], nm.Substring(0, 1).ToUpperInvariant());
                appLetter[i].BackColor = LetterColors[Math.Abs(nm.GetHashCode()) % LetterColors.Length];
                Ui.Set(appName[i], nm);
                appBar[i].Set("", a.MemGb / top, a.MemGb >= 1 ? a.MemGb.ToString("0.0", Ui.En) + " GB" : Math.Round(a.MemGb * 1024) + " MB");
                appClose[i].AccessibleName = "Close " + nm;
            }
            if (apps.Count == 0) Ui.Set(appsNote, "Measuring…", Theme.Mute);
            else if (appsNote.Text == "Measuring…") Ui.Set(appsNote, "Close asks the app politely. League and Windows are never closed.");

            var open = PerfMon.OpenApps; // counted in the background (apps with a window, like the taskbar)
            Ui.Set(procValue, open.HasValue ? open.Value.ToString() : "–");
            var up = PerfMon.Uptime;
            Ui.Set(upValue, up > TimeSpan.Zero ? Ui.Span(up) : "–");
            Ui.Set(restartValue, PerfMon.RestartPending ? "Pending" : "Not needed", PerfMon.RestartPending ? Theme.Warn : Theme.Ink);
            if (!full) return;

            var st = PerfMon.StartupApps() ?? new List<StartupApp>();
            for (var i = 0; i < 5; i++)
            {
                Ui.Set(startName[i], i < st.Count ? st[i].Name : "");
                Ui.Set(startWhere[i], i < st.Count ? st[i].Where : "");
            }
            Ui.Set(startEmpty, st.Count == 0 ? "Nothing found, or still looking." : st.Count > 5 ? "" : "");
            Ui.Show(startEmpty, st.Count == 0);
            var dv = PerfMon.Drives() ?? new List<DriveUse>();
            for (var i = 0; i < 3; i++)
            {
                Ui.Show(drives[i], i < dv.Count || i == 0);
                if (i < dv.Count)
                {
                    var d = dv[i];
                    drives[i].Set(d.Name, d.TotalGb > 0 ? 1 - d.FreeGb / d.TotalGb : 0, Math.Round(d.FreeGb) + " GB free");
                    drives[i].Color = d.TotalGb > 0 && d.FreeGb / d.TotalGb < .1f ? Theme.Bad : Theme.CpuLine;
                }
                else if (i == 0) drives[i].Set("Drives", 0, "–");
            }
        }

        /* ---------------------------------------------------------------- page life */

        public override void Shown()
        {
            SyncChip();
            PerfMon.IntervalSeconds = S.MeasureEvery;
            if (S.LiveMeasure) PerfMon.Start("perf");
            slow = 0;
        }

        public override void Hidden() { PerfMon.Stop("perf"); }

        public override void Tick()
        {
            var first = slow == 0;
            var due = slow % Math.Max(1, PerfMon.IntervalSeconds) == 0;
            slow++;
            if (Tab == 0) { if (due) TickLive(); }
            else if (Tab == 1) { if (first) TickLastGame(); }
            else if (first || slow % 5 == 0) TickApps(first);
        }
    }
}
