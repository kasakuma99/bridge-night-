// Bridge Night Helper: the Live page. Shows the running custom game like the site's live page: the score and clock,
// both teams with champion, level, K/D/A, CS and items, and a timeline of what happened. It only shows what the
// Watcher already reads from the game itself (Live Client Data, from the loading screen on); nothing extra is read
// or sent. C# 5.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Windows.Forms;

namespace BridgeNight
{
    class LivePage : Page
    {
        public static readonly Color Blue = Color.FromArgb(0x5a, 0xa9, 0xff), Red = Color.FromArgb(0xff, 0x5d, 0x6c);
        const int Rows = 5, RowH = 54, TeamW = 382, ScoreH = 104, Bottom = 524;

        Card empty, blueCard, redCard, logCard;
        ScoreBar score;
        Label blueHead, redHead;
        readonly PlayerRow[] blue = new PlayerRow[Rows], red = new PlayerRow[Rows];
        Timeline timeline;

        public LivePage(MainWindow w) : base(w, "Live")
        {
            Heading("Live", "Live");

            // Shown while no custom game runs.
            empty = Ui.Card(this, null, X0, Y0, W0, 200);
            var icon = Ui.Icon(empty, "", Theme.Ink2, W0 / 2 - 12, 40);
            icon.Font = Theme.GlyphBig;
            L(empty, "No live game", Theme.Big, Theme.Ink, 0, 74, W0, 32).TextAlign = ContentAlignment.MiddleCenter;
            L(empty, "When a custom game reaches the loading screen, both teams show up here, like on the site.", Theme.Small, Theme.Mute, 0, 108, W0, 22).TextAlign = ContentAlignment.MiddleCenter;
            var open = Ui.ButtonRight(empty, "Open the site", false, 0, 142);
            open.Left = (empty.Width - open.Width) / 2;
            open.Click += delegate { Ui.Open(MainWindow.SiteUrl); };

            score = new ScoreBar { Bounds = Theme.R(X0, Y0, W0, ScoreH) };
            Controls.Add(score);

            blueCard = TeamCard(X0, "Blue side", Blue, out blueHead);
            redCard = TeamCard(X0 + W0 - TeamW, "Red side", Red, out redHead);
            for (var i = 0; i < Rows; i++)
            {
                blue[i] = new PlayerRow { Bounds = Theme.R(8, 44 + i * RowH, TeamW - 16, RowH), Side = Blue };
                red[i] = new PlayerRow { Bounds = Theme.R(8, 44 + i * RowH, TeamW - 16, RowH), Side = Red };
                blueCard.Controls.Add(blue[i]);
                redCard.Controls.Add(red[i]);
            }

            logCard = Ui.Card(this, "Timeline", X0, Y0 + ScoreH + 12, W0, 120);
            timeline = new Timeline { Bounds = Theme.R(16, 42, W0 - 32, 70) };
            logCard.Controls.Add(timeline);
        }

        Card TeamCard(int x, string title, Color side, out Label head)
        {
            var c = Ui.Card(this, null, x, Y0 + ScoreH + 12, TeamW, 44 + Rows * RowH + 8);
            var dot = new Panel { Bounds = Theme.R(18, 18, 8, 8), BackColor = side };
            c.Controls.Add(dot);
            head = L(c, title, Theme.Strong, Theme.Ink, 34, 11, 200, 22);
            var k = L(c, "K / D / A", Theme.Tiny, Theme.Mute, TeamW - 120, 14, 104, 18);
            k.TextAlign = ContentAlignment.TopRight;
            return c;
        }

        public override void Shown() { Tick(); }

        public override void Tick()
        {
            DateTime readAt;
            var g = HelperStatus.Game(out readAt);
            var players = g == null ? null : Json.List(g, "allPlayers");
            var has = players != null && players.Length > 0;
            Ui.Show(empty, !has);
            foreach (Control c in new Control[] { score, blueCard, redCard, logCard }) Ui.Show(c, has);
            if (!has) return;

            double t = 0;
            try { t = Convert.ToDouble(Json.Get(Json.Dict(g, "gameData"), "gameTime") ?? 0); } catch { }
            if (t > 0) t += Math.Min(5, (DateTime.UtcNow - readAt).TotalSeconds); // read every ~3 s: keep the clock moving

            var order = players.Where(p => Json.Str(p, "team") == "ORDER").ToList();
            var chaos = players.Where(p => Json.Str(p, "team") == "CHAOS").ToList();
            score.Set(Kills(order), Kills(chaos), t, order.Count + "v" + chaos.Count);
            Fill(blue, blueCard, order);
            Fill(red, redCard, chaos);

            // The timeline takes the rest of the page, so small games show more of it.
            logCard.Top = Math.Max(blueCard.Bottom, redCard.Bottom) + Theme.Px(12);
            logCard.Height = Math.Max(Theme.Px(110), Theme.Px(Y0 + Bottom) - logCard.Top);
            timeline.Height = logCard.Height - Theme.Px(50);

            var teams = new Dictionary<string, Color>(StringComparer.OrdinalIgnoreCase);
            foreach (var p in order) foreach (var n in Names(p)) teams[n] = Blue;
            foreach (var p in chaos) foreach (var n in Names(p)) teams[n] = Red;
            timeline.Set(Json.List(Json.Dict(g, "events"), "Events"), teams);
        }

        static IEnumerable<string> Names(object p)
        {
            foreach (var key in new[] { "riotIdGameName", "summonerName", "riotId" })
            {
                var n = Json.Str(p, key);
                if (string.IsNullOrEmpty(n)) continue;
                var hash = n.IndexOf('#');
                yield return hash > 0 ? n.Substring(0, hash) : n;
            }
        }

        static int Kills(List<object> team)
        {
            var n = 0;
            foreach (var p in team) n += (int)(Json.Long(Json.Dict(p, "scores"), "kills") ?? 0);
            return n;
        }

        static void Fill(PlayerRow[] rows, Card card, List<object> team)
        {
            for (var i = 0; i < Rows; i++)
            {
                var has = i < team.Count;
                Ui.Show(rows[i], has);
                if (has) rows[i].Set(team[i], i == team.Count - 1);
            }
            card.Height = Theme.Px(44 + Math.Max(1, team.Count) * RowH + 8);
        }
    }

    /// Blue kills · clock with a LIVE badge · red kills, and a thin bar that splits the kills between the teams.
    class ScoreBar : Control
    {
        static readonly Font Caps = new Font(Theme.SmallStrong.FontFamily, 8.25f); // small capitals labels
        int blueKills, redKills;
        double seconds;
        string size = "";

        public ScoreBar()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
            TabStop = false;
            AccessibleRole = AccessibleRole.StaticText;
        }

        public void Set(int b, int r, double t, string teamSize)
        {
            var whole = Math.Floor(t);
            if (b == blueKills && r == redKills && whole == Math.Floor(seconds) && teamSize == size) return;
            blueKills = b; redKills = r; seconds = t; size = teamSize;
            AccessibleName = "Blue " + b + ", red " + r + ", " + (t > 0 ? Ui.Clock(TimeSpan.FromSeconds(t)) : "loading");
            Invalidate();
        }

        protected override void OnPaintBackground(PaintEventArgs e) { Ui.PaintParent(this, e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new RectangleF(.5f, .5f, Width - 1.5f, Height - 1.5f);
            using (var path = Theme.Round(r, Theme.Px(Theme.CardRadius)))
            {
                using (var b = new SolidBrush(Theme.Card)) g.FillPath(b, path);
                // Soft team glow at both ends.
                var state = g.Save();
                g.SetClip(path);
                // One gradient over the whole width (blue → nothing → red), so there is no seam in the middle.
                using (var glow = new LinearGradientBrush(new RectangleF(-2, 0, Width + 4, Height), Color.Black, Color.Black, 0f))
                {
                    glow.InterpolationColors = new ColorBlend
                    {
                        Colors = new[] { Color.FromArgb(46, LivePage.Blue), Color.FromArgb(0, LivePage.Blue), Color.FromArgb(0, LivePage.Red), Color.FromArgb(46, LivePage.Red) },
                        Positions = new[] { 0f, .45f, .55f, 1f }
                    };
                    g.FillRectangle(glow, 0, 0, Width, Height);
                }
                using (var bb = new SolidBrush(LivePage.Blue)) g.FillRectangle(bb, 0, 0, Theme.Px(4), Height);
                using (var rb2 = new SolidBrush(LivePage.Red)) g.FillRectangle(rb2, Width - Theme.Px(4), 0, Theme.Px(4), Height);
                g.Restore(state);
                using (var p = new Pen(Theme.Border)) g.DrawPath(p, path);
            }

            const TextFormatFlags f = TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding;
            var pad = Theme.Px(26);
            TextRenderer.DrawText(g, "BLUE SIDE", Caps, new Point(pad, Theme.Px(18)), LivePage.Blue, f);
            TextRenderer.DrawText(g, blueKills.ToString(), Theme.Huge, new Point(pad - Theme.Px(2), Theme.Px(38)), Theme.Ink, f);
            var redCaps = TextRenderer.MeasureText("RED SIDE", Caps);
            TextRenderer.DrawText(g, "RED SIDE", Caps, new Point(Width - pad - redCaps.Width, Theme.Px(18)), LivePage.Red, f);
            var rk = TextRenderer.MeasureText(redKills.ToString(), Theme.Huge, Size.Empty, f);
            TextRenderer.DrawText(g, redKills.ToString(), Theme.Huge, new Point(Width - pad - rk.Width + Theme.Px(2), Theme.Px(38)), Theme.Ink, f);

            // Clock and the LIVE badge.
            var clock = seconds > 0 ? Ui.Clock(TimeSpan.FromSeconds(seconds)) : "Loading";
            TextRenderer.DrawText(g, clock, Theme.Huge, new Rectangle(0, Theme.Px(10), Width, Theme.Px(48)), Theme.Ink, f | TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            var badgeText = (seconds > 0 ? "LIVE" : "LOADING SCREEN") + "  ·  " + size + " custom game";
            var bw = TextRenderer.MeasureText(badgeText, Caps).Width + Theme.Px(30);
            var badge = new RectangleF((Width - bw) / 2f, Theme.Px(60), bw, Theme.Px(20));
            using (var path = Theme.Round(badge, badge.Height / 2))
            {
                using (var b = new SolidBrush(Color.FromArgb(34, LivePage.Red))) g.FillPath(b, path);
                using (var p = new Pen(Color.FromArgb(80, LivePage.Red))) g.DrawPath(p, path);
            }
            var d = Theme.Px(6);
            using (var b = new SolidBrush(seconds > 0 ? LivePage.Red : Theme.Mute)) g.FillEllipse(b, badge.X + Theme.Px(10), badge.Y + (badge.Height - d) / 2, d, d);
            TextRenderer.DrawText(g, badgeText, Caps, new Rectangle((int)badge.X + Theme.Px(20), (int)badge.Y, (int)badge.Width - Theme.Px(24), (int)badge.Height), Theme.Ink2, f | TextFormatFlags.VerticalCenter);

            // Kill split.
            var total = blueKills + redKills;
            var bar = new RectangleF(Width / 2f - Theme.Px(150), Theme.Px(88), Theme.Px(300), Theme.Px(4));
            using (var path = Theme.Round(bar, bar.Height / 2)) using (var b = new SolidBrush(Color.FromArgb(24, 255, 255, 255))) g.FillPath(b, path);
            if (total > 0)
            {
                var bwid = bar.Width * blueKills / total;
                if (bwid > 0) using (var path = Theme.Round(new RectangleF(bar.X, bar.Y, Math.Max(bar.Height, bwid), bar.Height), bar.Height / 2)) using (var b = new SolidBrush(LivePage.Blue)) g.FillPath(b, path);
                if (bar.Width - bwid > 0) using (var path = Theme.Round(new RectangleF(bar.X + bwid, bar.Y, Math.Max(bar.Height, bar.Width - bwid), bar.Height), bar.Height / 2)) using (var b = new SolidBrush(LivePage.Red)) g.FillPath(b, path);
            }
        }
    }

    /// One player: level badge, champion and name, K/D/A and CS on the right, item chips under the name.
    class PlayerRow : Control
    {
        public Color Side = Color.White;
        string champ = "", name = "", level = "", key = "";
        long kills, deaths, assists, cs;
        bool dead, last;
        string[] items = new string[0];

        public PlayerRow()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Card;
            TabStop = false;
            AccessibleRole = AccessibleRole.Row;
        }

        public void Set(object p, bool isLast)
        {
            var s = Json.Dict(p, "scores");
            var c = Json.Str(p, "championName") ?? "";
            var n = Json.Str(p, "riotIdGameName") ?? Json.Str(p, "summonerName") ?? "";
            var hash = n.IndexOf('#');
            if (hash > 0) n = n.Substring(0, hash);
            long k = Json.Long(s, "kills") ?? 0, d = Json.Long(s, "deaths") ?? 0, a = Json.Long(s, "assists") ?? 0, cr = Json.Long(s, "creepScore") ?? 0;
            var lv = (Json.Long(p, "level") ?? 1).ToString();
            var isDead = Json.Bool(p, "isDead") == true;
            var its = (Json.List(p, "items") ?? new object[0]).Select(i => Json.Str(i, "displayName") ?? "").Where(x => x != "").Take(7).ToArray();
            var now = c + "|" + n + "|" + k + "|" + d + "|" + a + "|" + cr + "|" + lv + "|" + isDead + "|" + isLast + "|" + string.Join("|", its);
            if (now == key) return; // nothing new: no repaint
            key = now; champ = c; name = n; kills = k; deaths = d; assists = a; cs = cr; level = lv; dead = isDead; last = isLast; items = its;
            AccessibleName = c + ", " + n + ", level " + lv + ", " + k + " / " + d + " / " + a + (isDead ? ", dead" : "");
            Ui.Tips.SetToolTip(this, its.Length == 0 ? "No items yet" : string.Join(", ", its));
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var ink = dead ? Theme.Mute : Theme.Ink;
            const TextFormatFlags f = TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis;

            // Round level badge in the team colour.
            var s = Theme.Px(34);
            var badge = new RectangleF(Theme.Px(8), (Height - s) / 2f, s, s);
            using (var b = new SolidBrush(Color.FromArgb(dead ? 22 : 40, Side))) g.FillEllipse(b, badge);
            using (var p = new Pen(Color.FromArgb(dead ? 50 : 150, Side), Theme.Px(1.5f))) g.DrawEllipse(p, badge);
            TextRenderer.DrawText(g, level, Theme.SmallStrong, Rectangle.Round(badge), ink, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

            var x = Theme.Px(54);
            var right = Width - Theme.Px(8);
            var colW = Theme.Px(92);

            // Line 1: champion, player name.
            var title = champ;
            var tw = Math.Min(TextRenderer.MeasureText(title, Theme.Strong).Width, right - colW - x);
            TextRenderer.DrawText(g, title, Theme.Strong, new Rectangle(x, Theme.Px(7), tw + 2, Theme.Px(22)), ink, f);
            var nx = x + tw + Theme.Px(8);
            var nameText = dead ? "dead" : name;
            if (right - colW - nx > Theme.Px(30))
                TextRenderer.DrawText(g, nameText, Theme.Small, new Rectangle(nx, Theme.Px(9), right - colW - nx - Theme.Px(6), Theme.Px(20)), dead ? Theme.Bad : Theme.Mute, f);

            // Right: K / D / A (slashes toned down), CS under it.
            TextRenderer.DrawText(g, kills + " / " + deaths + " / " + assists, Theme.Strong, new Rectangle(right - colW, Theme.Px(7), colW, Theme.Px(22)), ink, f | TextFormatFlags.Right);
            var csText = cs + " CS";
            var cw = TextRenderer.MeasureText(csText, Theme.Tiny).Width;
            TextRenderer.DrawText(g, csText, Theme.Tiny, new Rectangle(right - cw, Theme.Px(31), cw + 1, Theme.Px(16)), Theme.Mute, f);

            // Line 2: item chips; full names in the tooltip.
            var chip = Theme.Px(19);
            for (var i = 0; i < 7; i++)
            {
                var r = new RectangleF(x + i * (chip + Theme.Px(4)), Theme.Px(30), chip, chip);
                var has = i < items.Length;
                using (var path = Theme.Round(r, Theme.Px(5)))
                {
                    using (var b = new SolidBrush(has ? Theme.Raised : Color.FromArgb(9, 255, 255, 255))) g.FillPath(b, path);
                    using (var p = new Pen(has ? Color.FromArgb(70, Side) : Theme.Border)) g.DrawPath(p, path);
                }
                if (has) TextRenderer.DrawText(g, Short(items[i]), Theme.Tiny, Rectangle.Round(r), dead ? Theme.Mute : Theme.Ink2, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            }
            if (!last) using (var p = new Pen(Theme.Border)) g.DrawLine(p, x, Height - 1, right, Height - 1);
        }

        /// "Infinity Edge" → "IE", "Boots" → "Bo".
        static string Short(string item)
        {
            var words = item.Split(new[] { ' ', '-', '\'' }, StringSplitOptions.RemoveEmptyEntries).Where(w => w.Length > 0 && char.IsLetter(w[0]) && w != "of" && w != "the" && w != "s").ToArray();
            if (words.Length >= 2) return (words[0].Substring(0, 1) + words[1].Substring(0, 1)).ToUpperInvariant();
            return words.Length == 1 ? words[0].Substring(0, Math.Min(2, words[0].Length)) : "?";
        }
    }

    /// Newest first: time, a coloured dot (killer's team, or orange for objectives) and the line with names in bold.
    class Timeline : Control
    {
        sealed class Line { public double At; public Color Dot; public List<KeyValuePair<string, bool>> Parts = new List<KeyValuePair<string, bool>>(); }
        List<Line> lines = new List<Line>();
        string key = "";
        const int LineH = 24;

        public Timeline()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Card;
            TabStop = false;
            AccessibleRole = AccessibleRole.List;
        }

        public void Set(object[] events, Dictionary<string, Color> teams)
        {
            var list = new List<Line>();
            if (events != null)
                for (var i = events.Length - 1; i >= 0 && list.Count < 12; i--)
                {
                    var l = Make(events[i], teams);
                    if (l != null) list.Add(l);
                }
            var now = string.Join("\n", list.Select(l => l.At + string.Join("", l.Parts.Select(p => p.Key)).ToString()).ToArray());
            if (now == key) return;
            key = now;
            lines = list;
            AccessibleName = string.Join(". ", list.Select(l => string.Join("", l.Parts.Select(p => p.Key))).ToArray());
            Invalidate();
        }

        static Line Make(object e, Dictionary<string, Color> teams)
        {
            var l = new Line();
            try { l.At = Convert.ToDouble(Json.Get(e, "EventTime") ?? 0); } catch { }
            var killer = Who(Json.Str(e, "KillerName"));
            Color team;
            l.Dot = teams.TryGetValue(killer, out team) ? team : Theme.Orange;
            switch (Json.Str(e, "EventName"))
            {
                case "GameStart": Plain(l, "Game started"); l.Dot = Theme.Mute; break;
                case "MinionsSpawning": Plain(l, "Minions spawned"); l.Dot = Theme.Mute; break;
                case "FirstBlood":
                    var first = Who(Json.Str(e, "Recipient"));
                    l.Dot = teams.TryGetValue(first, out team) ? team : Theme.Orange;
                    Bold(l, "First blood"); Plain(l, " for "); Bold(l, first); break;
                case "ChampionKill": Bold(l, killer); Plain(l, " killed "); Bold(l, Who(Json.Str(e, "VictimName"))); break;
                case "Multikill": Bold(l, killer); Plain(l, " got a "); Bold(l, MultiName(Json.Long(e, "KillStreak") ?? 2)); break;
                case "Ace":
                    var acer = Who(Json.Str(e, "Acer"));
                    l.Dot = teams.TryGetValue(acer, out team) ? team : Theme.Orange;
                    Bold(l, "Ace"); Plain(l, " by "); Bold(l, acer); break;
                case "DragonKill": Bold(l, killer); Plain(l, " took the " + (Json.Str(e, "DragonType") ?? "").ToLowerInvariant() + " dragon"); break;
                case "HeraldKill": Bold(l, killer); Plain(l, " took the Herald"); break;
                case "BaronKill": Bold(l, killer); Plain(l, " took Baron"); break;
                case "HordeKill": Bold(l, killer); Plain(l, " took a Voidgrub"); break;
                case "TurretKilled": Bold(l, killer); Plain(l, " destroyed a tower"); break;
                case "InhibKilled": Bold(l, killer); Plain(l, " destroyed an inhibitor"); break;
                case "GameEnd": Bold(l, "Game over"); l.Dot = Theme.Mute; break;
                default: return null;
            }
            return l;
        }

        static void Plain(Line l, string t) { l.Parts.Add(new KeyValuePair<string, bool>(t, false)); }
        static void Bold(Line l, string t) { l.Parts.Add(new KeyValuePair<string, bool>(t, true)); }
        static string MultiName(long n) { return n >= 5 ? "penta kill" : n == 4 ? "quadra kill" : n == 3 ? "triple kill" : "double kill"; }

        /// Turrets, minions and monsters get plain names; players keep their in-game name.
        static string Who(string name)
        {
            if (string.IsNullOrEmpty(name)) return "Someone";
            if (name.StartsWith("Turret", StringComparison.OrdinalIgnoreCase)) return "A tower";
            if (name.StartsWith("Minion", StringComparison.OrdinalIgnoreCase)) return "Minions";
            if (name.StartsWith("SRU_", StringComparison.OrdinalIgnoreCase) || name.StartsWith("HA_", StringComparison.OrdinalIgnoreCase)) return "A monster";
            var hash = name.IndexOf('#');
            return hash > 0 ? name.Substring(0, hash) : name;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            const TextFormatFlags f = TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding | TextFormatFlags.VerticalCenter;
            if (lines.Count == 0)
            {
                TextRenderer.DrawText(g, "Nothing yet. Kills, dragons and towers show up here.", Theme.Small, new Rectangle(0, 0, Width, Theme.Px(LineH)), Theme.Mute, f);
                return;
            }
            var lh = Theme.Px(LineH);
            var fit = Math.Max(1, Height / lh);
            // Two columns when there is room for more lines than height allows in one.
            var cols = lines.Count > fit ? 2 : 1;
            var colW = Width / cols;
            var timeW = Theme.Px(50);
            var axisX = timeW + Theme.Px(6);
            for (var c = 0; c < cols; c++)
            {
                var x0 = c * colW;
                var shown = 0;
                for (var i = c * fit; i < lines.Count && shown < fit; i++, shown++)
                {
                    var l = lines[i];
                    var y = shown * lh;
                    // Faint vertical line linking the dots.
                    if (shown < fit - 1 && i < lines.Count - 1)
                        using (var p = new Pen(Theme.Border)) g.DrawLine(p, x0 + axisX + Theme.Px(4), y + lh / 2, x0 + axisX + Theme.Px(4), y + lh + lh / 2);
                    TextRenderer.DrawText(g, Ui.Clock(TimeSpan.FromSeconds(l.At)), Theme.Small, new Rectangle(x0, y, timeW, lh), Theme.Mute, f | TextFormatFlags.Right);
                    var d = Theme.Px(9);
                    using (var b = new SolidBrush(l.Dot)) g.FillEllipse(b, x0 + axisX, y + (lh - d) / 2f, d, d);
                    var x = x0 + axisX + Theme.Px(20);
                    foreach (var part in l.Parts)
                    {
                        var font = part.Value ? Theme.SmallStrong : Theme.Small;
                        var w = TextRenderer.MeasureText(g, part.Key, font, Size.Empty, TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding).Width;
                        var room = x0 + colW - Theme.Px(12) - x;
                        if (room <= 0) break;
                        TextRenderer.DrawText(g, part.Key, font, new Rectangle(x, y, Math.Min(w + 1, room), lh), part.Value ? Theme.Ink : Theme.Ink2, f | TextFormatFlags.EndEllipsis);
                        x += w;
                    }
                }
            }
        }
    }
}
