// Bridge Night Helper: the Live page. Shows the running custom game like the site's live page: both teams with
// champion, level, K/D/A, CS and items, the score, the game clock and the latest events. It only shows what the
// Watcher already reads from the game itself (Live Client Data, from the loading screen on); nothing extra is
// read or sent. C# 5.

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
        static readonly Color Blue = Color.FromArgb(0x5a, 0xa9, 0xff), Red = Color.FromArgb(0xff, 0x5d, 0x6c);
        const int Rows = 5, RowH = 58, TeamW = 382;

        Card empty, score, blueCard, redCard, logCard;
        Label blueKills, redKills, clock, mode;
        readonly PlayerRow[] blue = new PlayerRow[Rows], red = new PlayerRow[Rows];
        readonly Label[] events = new Label[8];

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

            // Score bar: blue kills, clock, red kills.
            score = Ui.Card(this, null, X0, Y0, W0, 92);
            L(score, "Blue side", Theme.Small, Blue, 24, 16, 200, 20);
            blueKills = L(score, "0", Theme.Huge, Theme.Ink, 24, 34, 200, 48);
            clock = L(score, "0:00", Theme.Huge, Theme.Ink, W0 / 2 - 120, 18, 240, 48);
            clock.TextAlign = ContentAlignment.MiddleCenter;
            mode = L(score, "", Theme.Small, Theme.Mute, W0 / 2 - 160, 64, 320, 20);
            mode.TextAlign = ContentAlignment.TopCenter;
            var rt = L(score, "Red side", Theme.Small, Red, W0 - 224, 16, 200, 20);
            rt.TextAlign = ContentAlignment.TopRight;
            redKills = L(score, "0", Theme.Huge, Theme.Ink, W0 - 224, 34, 200, 48);
            redKills.TextAlign = ContentAlignment.TopRight;

            // The two teams.
            blueCard = Ui.Card(this, null, X0, Y0 + 104, TeamW, 20 + Rows * RowH);
            redCard = Ui.Card(this, null, X0 + W0 - TeamW, Y0 + 104, TeamW, 20 + Rows * RowH);
            for (var i = 0; i < Rows; i++)
            {
                blue[i] = new PlayerRow { Bounds = Theme.R(10, 10 + i * RowH, TeamW - 20, RowH), Side = Blue };
                red[i] = new PlayerRow { Bounds = Theme.R(10, 10 + i * RowH, TeamW - 20, RowH), Side = Red };
                blueCard.Controls.Add(blue[i]);
                redCard.Controls.Add(red[i]);
            }

            // Latest events, newest first, in two columns.
            logCard = Ui.Card(this, "Latest", X0, Y0 + 104 + 20 + Rows * RowH + 12, W0, 128);
            for (var i = 0; i < events.Length; i++)
                events[i] = L(logCard, "", Theme.Small, Theme.Ink2, 16 + (i / 4) * 384, 40 + (i % 4) * 20, 372, 20);
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

            var data = Json.Dict(g, "gameData");
            double t = 0;
            try { t = Convert.ToDouble(Json.Get(data, "gameTime") ?? 0); } catch { }
            if (t > 0) t += Math.Min(5, (DateTime.UtcNow - readAt).TotalSeconds); // the game is read every ~3 s: keep the clock moving
            Ui.Set(clock, t <= 0 ? "Loading" : Ui.Clock(TimeSpan.FromSeconds(t)));
            Ui.Set(mode, t <= 0 ? "Loading screen" : players.Length / 2 + "v" + (players.Length - players.Length / 2) + " · custom game");

            var order = players.Where(p => Json.Str(p, "team") == "ORDER").ToList();
            var chaos = players.Where(p => Json.Str(p, "team") == "CHAOS").ToList();
            Ui.Set(blueKills, Kills(order).ToString());
            Ui.Set(redKills, Kills(chaos).ToString());
            Fill(blue, blueCard, order);
            Fill(red, redCard, chaos);
            logCard.Top = Math.Max(blueCard.Bottom, redCard.Bottom) + Theme.Px(12);
            FillEvents(Json.List(Json.Dict(g, "events"), "Events"));
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
                if (has) rows[i].Set(team[i]);
            }
            card.Height = Theme.Px(20 + Math.Max(1, team.Count) * RowH);
        }

        void FillEvents(object[] list)
        {
            var lines = new List<string>();
            if (list != null)
                for (var i = list.Length - 1; i >= 0 && lines.Count < events.Length; i--)
                {
                    var line = EventText(list[i]);
                    if (line != null) lines.Add(line);
                }
            for (var i = 0; i < events.Length; i++) Ui.Set(events[i], i < lines.Count ? lines[i] : i == 0 ? "Nothing yet." : "");
        }

        /// One event in plain words, with the game time in front; null for events not worth a line.
        static string EventText(object e)
        {
            double at = 0;
            try { at = Convert.ToDouble(Json.Get(e, "EventTime") ?? 0); } catch { }
            var when = Ui.Clock(TimeSpan.FromSeconds(at)) + "   ";
            var killer = Who(Json.Str(e, "KillerName"));
            switch (Json.Str(e, "EventName"))
            {
                case "GameStart": return when + "Game started";
                case "MinionsSpawning": return when + "Minions spawned";
                case "FirstBlood": return when + "First blood: " + Who(Json.Str(e, "Recipient"));
                case "ChampionKill": return when + killer + " killed " + Who(Json.Str(e, "VictimName"));
                case "Multikill": return when + killer + " got a " + MultiName(Json.Long(e, "KillStreak") ?? 2);
                case "Ace": return when + "Ace by " + Who(Json.Str(e, "Acer"));
                case "DragonKill": return when + killer + " took the " + (Json.Str(e, "DragonType") ?? "").ToLowerInvariant() + " dragon";
                case "HeraldKill": return when + killer + " took the Herald";
                case "BaronKill": return when + killer + " took Baron";
                case "HordeKill": return when + killer + " took a Voidgrub";
                case "TurretKilled": return when + killer + " destroyed a tower";
                case "InhibKilled": return when + killer + " destroyed an inhibitor";
                case "GameEnd": return when + "Game over";
                default: return null;
            }
        }

        static string MultiName(long n) { return n >= 5 ? "penta kill" : n == 4 ? "quadra kill" : n == 3 ? "triple kill" : "double kill"; }

        /// Turrets, minions and monsters get plain names; players keep their in-game name.
        static string Who(string name)
        {
            if (string.IsNullOrEmpty(name)) return "someone";
            if (name.StartsWith("Turret", StringComparison.OrdinalIgnoreCase)) return "a tower";
            if (name.StartsWith("Minion", StringComparison.OrdinalIgnoreCase)) return "minions";
            if (name.StartsWith("SRU_", StringComparison.OrdinalIgnoreCase) || name.StartsWith("HA_", StringComparison.OrdinalIgnoreCase)) return "a monster";
            var hash = name.IndexOf('#');
            return hash > 0 ? name.Substring(0, hash) : name;
        }
    }

    /// One player: champion, name, level, K/D/A, CS and up to seven item chips, all painted in one go.
    class PlayerRow : Control
    {
        public Color Side = Color.White;
        string champ = "", name = "", kda = "", cs = "", level = "";
        bool dead;
        string[] items = new string[0];
        string key = "";

        public PlayerRow()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Card;
            TabStop = false;
            AccessibleRole = AccessibleRole.Row;
        }

        public void Set(object p)
        {
            var s = Json.Dict(p, "scores");
            var c = Json.Str(p, "championName") ?? "";
            var n = Json.Str(p, "riotIdGameName") ?? Json.Str(p, "summonerName") ?? "";
            var hash = n.IndexOf('#');
            if (hash > 0) n = n.Substring(0, hash);
            var k = (Json.Long(s, "kills") ?? 0) + " / " + (Json.Long(s, "deaths") ?? 0) + " / " + (Json.Long(s, "assists") ?? 0);
            var cr = (Json.Long(s, "creepScore") ?? 0) + " CS";
            var lv = (Json.Long(p, "level") ?? 1).ToString();
            var d = Json.Bool(p, "isDead") == true;
            var list = Json.List(p, "items") ?? new object[0];
            var its = list.Select(i => Json.Str(i, "displayName") ?? "").Where(x => x != "").Take(7).ToArray();
            var now = c + n + k + cr + lv + d + string.Join("|", its);
            if (now == key) return; // nothing new: no repaint
            key = now; champ = c; name = n; kda = k; cs = cr; level = lv; dead = d; items = its;
            AccessibleName = c + ", " + n + ", level " + lv + ", " + k + (d ? ", dead" : "");
            var tips = string.Join(", ", its);
            Ui.Tips.SetToolTip(this, its.Length == 0 ? "No items yet" : tips);
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var ink = dead ? Theme.Mute : Theme.Ink;
            const TextFormatFlags f = TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis;

            // Level badge in the team colour.
            var badge = new RectangleF(Theme.Px(4), Theme.Px(8), Theme.Px(34), Theme.Px(34));
            using (var path = Theme.Round(badge, Theme.Px(9)))
            {
                using (var b = new SolidBrush(Color.FromArgb(dead ? 30 : 46, Side))) g.FillPath(b, path);
                using (var p = new Pen(Color.FromArgb(dead ? 60 : 120, Side))) g.DrawPath(p, path);
            }
            TextRenderer.DrawText(g, level, Theme.SmallStrong, Rectangle.Round(badge), ink, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

            var x = Theme.Px(48);
            var right = Width - Theme.Px(6);
            var kdaW = Theme.Px(96);
            // Line 1: champion and player name, K/D/A. Line 2: item chips, CS.
            var title = champ + (dead ? "  · dead" : "");
            var tw = Math.Min(TextRenderer.MeasureText(title, Theme.Strong).Width, right - kdaW - x);
            TextRenderer.DrawText(g, title, Theme.Strong, new Rectangle(x, Theme.Px(6), tw + 2, Theme.Px(22)), ink, f);
            var nx = x + tw + Theme.Px(8);
            if (right - kdaW - nx > Theme.Px(30))
                TextRenderer.DrawText(g, name, Theme.Small, new Rectangle(nx, Theme.Px(8), right - kdaW - nx - Theme.Px(6), Theme.Px(20)), Theme.Mute, f);
            TextRenderer.DrawText(g, kda, Theme.Strong, new Rectangle(right - kdaW, Theme.Px(6), kdaW, Theme.Px(22)), ink, f | TextFormatFlags.Right);
            TextRenderer.DrawText(g, cs, Theme.Tiny, new Rectangle(right - kdaW, Theme.Px(27), kdaW, Theme.Px(18)), Theme.Mute, f | TextFormatFlags.Right);

            // Items: small chips with the first letters; the full names are in the tooltip.
            var chip = Theme.Px(18);
            var cx = x;
            for (var i = 0; i < 7; i++)
            {
                var r = new RectangleF(cx + i * (chip + Theme.Px(3)), Theme.Px(27), chip, chip);
                using (var path = Theme.Round(r, Theme.Px(4)))
                {
                    var has = i < items.Length;
                    using (var b = new SolidBrush(has ? Theme.Raised : Color.FromArgb(10, 255, 255, 255))) g.FillPath(b, path);
                    using (var p = new Pen(has ? Theme.BorderHi : Theme.Border)) g.DrawPath(p, path);
                    if (has) TextRenderer.DrawText(g, Short(items[i]), Theme.Tiny, Rectangle.Round(r), Theme.Ink2, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
                }
            }
            using (var p = new Pen(Theme.Border)) g.DrawLine(p, x, Height - 1, right, Height - 1);
        }

        /// "Infinity Edge" → "IE", "Boots" → "Bo".
        static string Short(string item)
        {
            var words = item.Split(new[] { ' ', '-', '\'' }, StringSplitOptions.RemoveEmptyEntries).Where(w => w.Length > 0 && char.IsLetter(w[0]) && w != "of" && w != "the").ToArray();
            if (words.Length >= 2) return (words[0].Substring(0, 1) + words[1].Substring(0, 1)).ToUpperInvariant();
            return words.Length == 1 ? words[0].Substring(0, Math.Min(2, words[0].Length)) : "?";
        }
    }
}
