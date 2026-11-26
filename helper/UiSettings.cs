// Bridge Night Helper: Settings as a pop-up inside the main window. The window behind it is blurred and darkened;
// a card in the middle has the sections on the left and their switches on the right. Close: X, Esc, or a click
// outside the card. Every change is saved at once. The token logic is the same as in 0.6.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Threading;
using System.Windows.Forms;

namespace BridgeNight
{
    /// A section of the pop-up: plain card-coloured panel, painted through a back buffer.
    class SettingsPane : Panel
    {
        public SettingsPane()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Card;
        }
    }

    class SettingsPopup : Control
    {
        public static readonly string[] Sections = { "Connection", "Startup & alerts", "Performance", "Game mode", "Audio", "Updates" };
        static readonly string[] Glyphs = { "", "", "", "", "", "" };
        const int CardW = 640, CardH = 500, HeadH = 64, NavW = 200, PaneW = CardW - NavW - 1, PaneH = CardH - HeadH - 1, Pad = 24, Step = 64;

        readonly MainWindow win;
        readonly Settings S;
        readonly Bitmap backdrop;
        readonly Card card;
        readonly NavItem[] nav = new NavItem[Sections.Length];
        readonly SettingsPane[] panes = new SettingsPane[Sections.Length];
        int section = -1;
        bool syncing;

        InputBox server, token;
        DotLabel connState;
        ToggleSwitch autostart, paused, alerts, live, record, auto, music, breaks, hotkeys, sound, badge, autoUpdate;
        Segmented every;
        Label version, updState;
        FlatButton check;

        public SettingsPopup(MainWindow w, string open)
        {
            win = w;
            S = w.Settings;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            Bounds = new Rectangle(0, Theme.Px(MainWindow.TitleH), w.ClientSize.Width, w.ClientSize.Height - Theme.Px(MainWindow.TitleH));
            AccessibleRole = AccessibleRole.Dialog;
            AccessibleName = "Settings";
            backdrop = Overlay.Frosted(w, Top);

            card = new Card(null) { Bounds = new Rectangle((Width - Theme.Px(CardW)) / 2, (Height - Theme.Px(CardH)) / 2, Theme.Px(CardW), Theme.Px(CardH)) };
            card.Paint += PaintCard;
            Controls.Add(card);
            var close = new IconButton("", "Close settings", 32) { Plain = true };
            close.Location = new Point(Theme.Px(CardW - 16 - 32), Theme.Px(16));
            close.Click += delegate { win.CloseSettings(); };
            Ui.Tips.SetToolTip(close, "Close (Esc)");
            card.Controls.Add(close);

            for (var i = 0; i < Sections.Length; i++)
            {
                var item = new NavItem(Sections[i], Glyphs[i]) { Bounds = Theme.R(12, HeadH + 14 + i * 44, NavW - 24, 40), HoverFill = Theme.NavActive, SelectedFill = Theme.Raised };
                var k = i;
                item.Click += delegate { ShowSection(k); };
                card.Controls.Add(item);
                nav[i] = item;
                panes[i] = new SettingsPane { Bounds = Theme.R(NavW + 1, HeadH + 1, PaneW - 1, PaneH - 1), Visible = false, AccessibleName = Sections[i] };
                card.Controls.Add(panes[i]);
            }
            BuildConnection(panes[0]);
            BuildStartup(panes[1]);
            BuildPerformance(panes[2]);
            BuildGameMode(panes[3]);
            BuildAudio(panes[4]);
            BuildUpdates(panes[5]);
            Sync();
            ShowSection(open);
            if (section < 0) ShowSection(0);
        }

        /* ---------------------------------------------------------------- frame */

        void PaintCard(object o, PaintEventArgs e)
        {
            var g = e.Graphics;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            Theme.DrawLogo(g, Theme.R(Pad, 18, 28, 28));
            TextRenderer.DrawText(g, "Settings", Theme.H2, new Point(Theme.Px(Pad + 40), Theme.Px(17)), Theme.Ink, TextFormatFlags.NoPrefix);
            using (var p = new Pen(Theme.Border))
            {
                g.DrawLine(p, Theme.Px(1), Theme.Px(HeadH), card.Width - Theme.Px(2), Theme.Px(HeadH));
                g.DrawLine(p, Theme.Px(NavW), Theme.Px(HeadH), Theme.Px(NavW), card.Height - Theme.Px(2));
            }
            TextRenderer.DrawText(g, "", Theme.GlyphSmall, new Rectangle(Theme.Px(Pad), card.Height - Theme.Px(42), Theme.Px(16), Theme.Px(20)), Theme.Good,
                TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, "Changes are saved at once", Theme.Tiny, new Rectangle(Theme.Px(Pad + 20), card.Height - Theme.Px(42), Theme.Px(NavW - Pad - 24), Theme.Px(20)), Theme.Mute,
                TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis);
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            e.Graphics.DrawImage(backdrop, 0, 0);
            Overlay.Shadow(e.Graphics, card.Bounds);
        }

        protected override void OnPaint(PaintEventArgs e) { }

        /// A click on the dark backdrop closes, like Esc.
        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button == MouseButtons.Left && !card.Bounds.Contains(e.Location)) win.CloseSettings();
        }

        public void ShowSection(string name)
        {
            if (name == null) return;
            for (var i = 0; i < Sections.Length; i++) if (Sections[i] == name) ShowSection(i);
        }

        void ShowSection(int i)
        {
            if (i == section || i < 0 || i >= Sections.Length) return;
            section = i;
            for (var k = 0; k < panes.Length; k++) { nav[k].Selected = k == i; panes[k].Visible = k == i; }
            AccessibleDescription = Sections[i];
        }

        public void FocusFirst() { if (section >= 0) nav[section].Focus(); }

        /* ---------------------------------------------------------------- building blocks */

        static void Header(Control p, string title, string sub)
        {
            Ui.Label(p, title, Theme.H2, Theme.Ink, Pad, 16, PaneW - 2 * Pad, 30);
            Ui.Label(p, sub, Theme.Small, Theme.Mute, Pad, 46, PaneW - 2 * Pad, 20);
        }

        /// One setting: icon, title, grey line, and a switch (or `right`, e.g. the 1s / 2s / 5s choice) at the right.
        static ToggleSwitch Row(Control p, string glyph, string title, string sub, int y, bool divider, Control right)
        {
            Ui.Icon(p, glyph, Theme.Ink2, Pad - 2, y + 18);
            var tw = PaneW - 2 * Pad - 34 - (right != null ? right.Width / Theme.Scale + 12 : 62);
            Ui.Label(p, title, Theme.Body, Theme.Ink, Pad + 34, y + 10, (int)tw, 22);
            Ui.Label(p, sub, Theme.Small, Theme.Mute, Pad + 34, y + 33, (int)tw, 20);
            if (divider) Ui.Divider(p, Pad, y + Step - 1, PaneW - 2 * Pad);
            if (right != null)
            {
                right.Location = new Point(Theme.Px(PaneW - Pad) - right.Width, Theme.Px(y + 15));
                p.Controls.Add(right);
                return null;
            }
            var t = Ui.Toggle(p, title, PaneW - Pad + 3, y + 17);
            t.AccessibleDescription = sub;
            return t;
        }

        /// Grey note with an icon at the bottom of a section.
        static void Note(Control p, string glyph, Color color, string text, int y, int h)
        {
            Ui.Icon(p, glyph, color, Pad - 2, y);
            Ui.Label(p, text, Theme.Small, Theme.Mute, Pad + 34, y + 2, PaneW - 2 * Pad - 34, h);
        }

        void Save() { try { S.Save(); } catch (Exception e) { win.Log("Could not save settings: " + e.Message); } }

        /* ---------------------------------------------------------------- sections */

        void BuildConnection(Control p)
        {
            Header(p, "Connection", "Links this PC to your Bridge Night account.");
            connState = new DotLabel { Bounds = Theme.R(PaneW - Pad - 180, 20, 180, 22), Font = Theme.Small, ForeColor = Theme.Good, BackColor = Theme.Card, AccessibleName = "Connection state" };
            p.Controls.Add(connState);
            const int w = PaneW - 2 * Pad;
            Ui.Label(p, "Server URL", Theme.Small, Theme.Ink2, Pad, 84, w, 20);
            server = new InputBox("Server URL") { Bounds = Theme.R(Pad - 2, 104, w + 4, 38) };
            server.Box.Text = S.Server;
            p.Controls.Add(server);
            Ui.Label(p, "Helper token", Theme.Small, Theme.Ink2, Pad, 152, w, 20);
            token = new InputBox("Helper token") { Bounds = Theme.R(Pad - 2, 172, w + 4, 38) };
            token.Box.Text = S.Token;
            token.Box.UseSystemPasswordChar = true; // never shown in full
            p.Controls.Add(token);
            Ui.Label(p, "Make it on the site's Helper page. Stored encrypted for your Windows account.", Theme.Small, Theme.Mute, Pad, 216, w, 40);
            var test = Ui.ButtonRight(p, "Save and test", true, PaneW - Pad + 2, 262);
            test.Click += delegate { if (SaveConnection()) TestConnection(); };
            var save = Ui.ButtonRight(p, "Save", false, 0, 262);
            save.Left = test.Left - Theme.Px(8) - save.Width;
            save.Click += delegate { SaveConnection(); };
            Ui.Divider(p, Pad, 322, w);
            Note(p, "", Theme.Good, "Only custom games are sent to the site. Normal, ranked and other games are ignored.", 340, 40);
        }

        void BuildStartup(Control p)
        {
            Header(p, "Startup & alerts", "How the helper starts and when it speaks up.");
            autostart = Row(p, "", "Start with Windows", "Starts quietly by the clock when you sign in", 76, true, null);
            autostart.CheckedChanged += delegate
            {
                if (syncing) return;
                try { Settings.Autostart = autostart.Checked; }
                catch (Exception e) { MessageBox.Show(win, "Could not change that: " + e.Message, Program.Title); }
            };
            paused = Row(p, "", "Pause sending games", "Same as Pause in the tray menu", 76 + Step, true, null);
            paused.CheckedChanged += delegate { if (!syncing) win.SetPausedAction(paused.Checked); };
            alerts = Row(p, "", "Pop-up when a result is saved", "A small note by the clock", 76 + 2 * Step, false, null);
            alerts.CheckedChanged += delegate { if (!syncing) { S.ResultAlerts = alerts.Checked; Save(); } };
            Ui.Divider(p, Pad, 76 + 3 * Step + 12, PaneW - 2 * Pad);
            Note(p, "", Theme.Ink2, "Closing the window keeps the helper running by the clock. Exit it from the tray icon's menu.", 76 + 3 * Step + 30, 40);
        }

        void BuildPerformance(Control p)
        {
            Header(p, "Performance", "Measuring only runs while a page shows it.");
            live = Row(p, "", "Live measuring", "On the Performance page, while it is open", 76, true, null);
            live.CheckedChanged += delegate { if (!syncing) { S.LiveMeasure = live.Checked; Save(); } };
            every = new Segmented("Measure every", new[] { "1s", "2s", "5s" }, 9);
            every.Changed += delegate
            {
                if (syncing) return;
                S.MeasureEvery = every.Selected == 0 ? 1 : every.Selected == 1 ? 2 : 5;
                PerfMon.IntervalSeconds = S.MeasureEvery;
                Save();
            };
            Row(p, "", "Measure every", "1 s is smoothest, 5 s is lightest", 76 + Step, true, every);
            record = Row(p, "", "Record last game", "A light report after each custom game", 76 + 2 * Step, false, null);
            record.CheckedChanged += delegate { if (!syncing) { S.RecordLastGame = record.Checked; Save(); } };
            Ui.Divider(p, Pad, 76 + 3 * Step + 12, PaneW - 2 * Pad);
            Note(p, "", Theme.Ink2, "Home shows a light live view while it is open. With the window closed, only a recorded game is measured.", 76 + 3 * Step + 30, 40);
        }

        void BuildGameMode(Control p)
        {
            Header(p, "Game mode", "Only while a League game runs. Everything goes back after.");
            auto = Row(p, "", "Automatic game mode", "Switches on when a game starts, off when it ends", 76, true, null);
            auto.CheckedChanged += delegate { if (!syncing) { S.GameModeAuto = auto.Checked; Save(); Tick(); } };
            music = Row(p, "", "Music quieter in game", "Music apps at 30 % while you play", 76 + Step, true, null);
            music.CheckedChanged += delegate { if (!syncing) { S.MusicQuieter = music.Checked; Save(); } };
            breaks = Row(p, "", "Break reminder", "A short nudge after 2 hours of play", 76 + 2 * Step, false, null);
            breaks.CheckedChanged += delegate { if (!syncing) { S.BreakReminder = breaks.Checked; Save(); } };
            Ui.Divider(p, Pad, 76 + 3 * Step + 12, PaneW - 2 * Pad);
            Note(p, "", Theme.Ink2, "Gamer fixes (refresh rate, mouse acceleration, Sticky Keys) only change when you click Fix on the Game mode page.", 76 + 3 * Step + 30, 40);
        }

        void BuildAudio(Control p)
        {
            Header(p, "Audio", "Mute and switch sound for every app at once.");
            hotkeys = Row(p, "", "Hotkeys", "Ctrl+Alt+M mutes the mic, Ctrl+Alt+H switches the output", 76, true, null);
            hotkeys.CheckedChanged += delegate { if (!syncing) { S.Hotkeys = hotkeys.Checked; Save(); } };
            sound = Row(p, "", "Sound when muting and unmuting", "A short sound so you know", 76 + Step, true, null);
            sound.CheckedChanged += delegate { if (!syncing) { S.MuteSound = sound.Checked; Save(); } };
            badge = Row(p, "", "\"Muted\" badge on screen", "At the top of the screen while you are muted", 76 + 2 * Step, false, null);
            badge.CheckedChanged += delegate { if (!syncing) { S.MutedBadge = badge.Checked; Save(); } };
            Ui.Divider(p, Pad, 76 + 3 * Step + 12, PaneW - 2 * Pad);
            Note(p, "", Theme.Ink2, "Mute and output only change on the hotkey or a click. Muting is done in Windows, so every app goes quiet at once.", 76 + 3 * Step + 30, 40);
        }

        void BuildUpdates(Control p)
        {
            Header(p, "Updates", "From GitHub, checked with SHA-256 before they install.");
            var logo = new Panel { Bounds = Theme.R(Pad, 84, 44, 44), BackColor = Theme.Card };
            logo.Paint += delegate (object o, PaintEventArgs e) { e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic; Theme.DrawLogo(e.Graphics, new Rectangle(0, 0, logo.Width, logo.Height)); };
            p.Controls.Add(logo);
            version = Ui.Label(p, "Version " + Program.Version, Theme.Strong, Theme.Ink, Pad + 58, 84, 200, 22);
            updState = Ui.Label(p, "", Theme.Small, Theme.Mute, Pad + 58, 106, 200, 40);
            check = Ui.ButtonRight(p, "Check now", false, PaneW - Pad + 2, 89);
            check.Click += delegate
            {
                if (Updater.NewVersion != "") InstallUpdate(win);
                else { Updater.CheckNow(); Ui.Set(updState, "Checking…"); }
            };
            Ui.Divider(p, Pad, 150, PaneW - 2 * Pad);
            autoUpdate = Row(p, "", "Update automatically", "Never during a game", 152, false, null);
            autoUpdate.CheckedChanged += delegate { if (!syncing) { S.AutoUpdate = autoUpdate.Checked; Save(); } };
            Ui.Divider(p, Pad, 152 + Step + 12, PaneW - 2 * Pad);
            Note(p, "", Theme.Good, "Reads the League client, never controls it. Custom games only.", 152 + Step + 30, 40);
            Ui.Link(p, "Source on GitHub  ↗", PaneW - Pad + 4, 152 + Step + 74).Click += delegate { Ui.Open(MainWindow.RepoUrl); };
        }

        /* ---------------------------------------------------------------- state */

        /// Puts every switch to what the settings say (also after Pause changed in the tray).
        public void Sync()
        {
            syncing = true;
            try { autostart.Checked = Settings.Autostart; } catch { }
            paused.Checked = S.Paused;
            alerts.Checked = S.ResultAlerts;
            live.Checked = S.LiveMeasure;
            every.Selected = S.MeasureEvery == 1 ? 0 : S.MeasureEvery == 5 ? 2 : 1;
            record.Checked = S.RecordLastGame;
            auto.Checked = S.GameModeAuto;
            music.Checked = S.MusicQuieter;
            breaks.Checked = S.BreakReminder;
            hotkeys.Checked = S.Hotkeys;
            sound.Checked = S.MuteSound;
            badge.Checked = S.MutedBadge;
            autoUpdate.Checked = S.AutoUpdate;
            syncing = false;
        }

        /// Once a second while the pop-up is open.
        public void Tick()
        {
            var st = HelperStatus.Read();
            if (connState.Text != "Testing…" || st.ServerOk.HasValue)
            {
                if (string.IsNullOrEmpty(S.Token)) { Ui.Set(connState, "No token yet", Theme.Warn); connState.Dot = Theme.Warn; }
                else if (st.ServerOk == true) { Ui.Set(connState, "Connected", Theme.Good); connState.Dot = Theme.Good; }
                else if (st.ServerOk == false) { Ui.Set(connState, "Not connected", Theme.Bad); connState.Dot = Theme.Bad; }
                else { Ui.Set(connState, "Not checked yet", Theme.Mute); connState.Dot = Theme.Mute; }
            }
            connState.Width = Math.Min(Theme.Px(180), TextRenderer.MeasureText(connState.Text, connState.Font).Width + Theme.Px(24));
            connState.Left = Theme.Px(PaneW - Pad) - connState.Width;

            music.Enabled = breaks.Enabled = S.GameModeAuto;

            var nv = Updater.NewVersion;
            Ui.Set(version, nv != "" ? "Version " + nv.TrimStart('v', 'V') + " is ready" : "Version " + Program.Version);
            Ui.Set(updState, nv != "" ? "You have " + Program.Version + ". " + Updater.State : Updater.State == "" ? "Checks GitHub on start and once a day." : Updater.State);
            check.Text = nv != "" ? "Update now" : "Check now";
            check.Primary = nv != "";
            check.FitWidth();
            check.Left = Theme.Px(PaneW - Pad + 2) - check.Width;
            updState.Width = version.Width = check.Left - updState.Left - Theme.Px(8);
        }

        /* ---------------------------------------------------------------- connection (same logic as 0.6) */

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
                MessageBox.Show(win, "The server URL must start with https://", Program.Title);
                return false;
            }
            S.Server = url;
            S.Token = token.Box.Text.Trim();
            try { S.Save(); win.Log("Settings saved"); return true; }
            catch (Exception e) { MessageBox.Show(win, "Could not save: " + e.Message, Program.Title); return false; }
        }

        void TestConnection()
        {
            var s = S;
            var log = win.Log;
            var w = win;
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
                try { w.BeginInvoke((Action)delegate { if (!IsDisposed) Tick(); MessageBox.Show(w, ok ? "Works! " + note : "Not working: " + note, Program.Title); }); }
                catch (InvalidOperationException) { } // window closed meanwhile
            });
        }

        protected override void Dispose(bool disposing) { if (disposing) backdrop.Dispose(); base.Dispose(disposing); }
    }
}
