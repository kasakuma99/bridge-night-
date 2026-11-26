// Bridge Night Helper: custom-drawn controls (cards, buttons, switches, inputs, tiles, charts, sidebar items).
// Interactive ones stay real WinForms controls underneath, so Tab, Enter/Space and screen readers keep working.
// Sizes are device pixels: callers pass 96-dpi numbers through Theme.Px / Theme.R.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace BridgeNight
{
    /// A part of the window that shows the shared backdrop (gradient + bridge watermark).
    class Backdrop : Panel
    {
        public Backdrop()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Base;
        }

        protected override void OnPaintBackground(PaintEventArgs e) { Theme.PaintBackdrop(e.Graphics, ClientRectangle, InWindow()); }

        Point InWindow()
        {
            var p = Point.Empty;
            for (Control c = this; c != null && !(c is Form); c = c.Parent) p.Offset(c.Left, c.Top);
            return p;
        }
    }

    /// Dark rounded card with a thin border. Children sit on Theme.Card. Optional bold title at the top left.
    class Card : Panel
    {
        public string Title;

        public Card(string title)
        {
            Title = title;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Card;
        }

        protected override void OnPaintBackground(PaintEventArgs e) { Ui.PaintParent(this, e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new RectangleF(.5f, .5f, Width - 1.5f, Height - 1.5f);
            using (var path = Theme.Round(r, Theme.Px(Theme.CardRadius)))
            {
                using (var fill = new SolidBrush(BackColor)) g.FillPath(fill, path);
                using (var p = new Pen(Theme.Border)) g.DrawPath(p, path);
            }
            if (!string.IsNullOrEmpty(Title))
                TextRenderer.DrawText(g, Title, Theme.CardTitle, new Point(Theme.Px(16), Theme.Px(14)), Theme.Ink, TextFormatFlags.NoPrefix);
            base.OnPaint(e);
        }
    }

    /// Base for small focusable painted controls: hover/pressed state, Enter/Space clicks, focus ring.
    class PaintedControl : Control
    {
        protected bool Hover, Pressed;

        public PaintedControl()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                ControlStyles.ResizeRedraw | ControlStyles.Selectable | ControlStyles.StandardClick | ControlStyles.SupportsTransparentBackColor, true);
            TabStop = true;
            Cursor = Cursors.Hand;
            AccessibleRole = AccessibleRole.PushButton;
        }

        protected override bool IsInputKey(Keys keyData) { return keyData == Keys.Enter || base.IsInputKey(keyData); }
        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space) { e.Handled = true; OnClick(EventArgs.Empty); }
            base.OnKeyDown(e);
        }
        protected override void OnMouseEnter(EventArgs e) { Hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { Hover = false; Pressed = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { if (e.Button == MouseButtons.Left) { Pressed = true; Invalidate(); } base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { Pressed = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
        protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
        protected override void OnPaintBackground(PaintEventArgs e) { Ui.PaintParent(this, e); }

        protected void Ring(Graphics g, RectangleF r, float radius) { if (Focused && ShowFocusCues) Ui.FocusRing(g, r, radius); }
    }

    /// Rounded button: sunset gradient when primary, quiet otherwise; Link draws underlined text only.
    class FlatButton : PaintedControl
    {
        bool primary;
        public bool Link;
        public string Glyph;

        public FlatButton(string text, bool primary)
        {
            this.primary = primary;
            Text = text;
            AccessibleName = text;
            Font = Theme.Strong;
            FitWidth();
        }

        public bool Primary { get { return primary; } set { if (primary != value) { primary = value; Invalidate(); } } }

        public void FitWidth()
        {
            var w = TextRenderer.MeasureText(Text, Font).Width + (Link ? Theme.Px(8) : Theme.Px(30)) + (Glyph != null ? Theme.Px(22) : 0);
            Size = new Size(w, Theme.Px(Link ? 26 : 34));
        }

        protected override void OnTextChanged(EventArgs e) { AccessibleName = Text; base.OnTextChanged(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var inset = Theme.Px(2);
            var r = new RectangleF(inset, inset, Width - 2 * inset - 1, Height - 2 * inset - 1);
            var radius = Theme.Px(Theme.ControlRadius);
            var ink = Enabled ? Theme.Ink : Theme.Mute;
            if (Link)
            {
                var size = TextRenderer.MeasureText(Text, Font);
                var tx = (Width - size.Width) / 2;
                TextRenderer.DrawText(g, Text, Font, new Point(tx, (Height - size.Height) / 2), Hover ? Theme.Ink : Theme.Ink2, TextFormatFlags.NoPrefix);
                using (var p = new Pen(Color.FromArgb(Hover ? 200 : 90, Theme.Ink)))
                    g.DrawLine(p, tx + Theme.Px(3), (Height + size.Height) / 2 - Theme.Px(1), tx + size.Width - Theme.Px(3), (Height + size.Height) / 2 - Theme.Px(1));
                Ring(g, r, radius);
                return;
            }
            using (var path = Theme.Round(r, radius))
            {
                if (Enabled && primary)
                {
                    using (var b = Theme.Sunset(r, 0f)) g.FillPath(b, path);
                    if (Pressed) using (var b = new SolidBrush(Color.FromArgb(50, 0, 0, 0))) g.FillPath(b, path);
                    else if (Hover) using (var b = new SolidBrush(Color.FromArgb(36, 255, 255, 255))) g.FillPath(b, path);
                    ink = Theme.OnAccent;
                }
                else
                {
                    using (var b = new SolidBrush(!Enabled ? Theme.Card : Pressed ? Theme.Card : Hover ? Theme.RaisedHover : Theme.Raised)) g.FillPath(b, path);
                    using (var p = new Pen(Hover && Enabled ? Theme.BorderHi : Theme.Border)) g.DrawPath(p, path);
                }
            }
            Ring(g, r, radius);
            var box = Rectangle.Round(r);
            if (Glyph != null)
            {
                var tw = TextRenderer.MeasureText(Text, Font).Width;
                var x0 = box.X + (box.Width - tw - Theme.Px(22)) / 2;
                TextRenderer.DrawText(g, Glyph, Theme.GlyphSmall, new Rectangle(x0, box.Y, Theme.Px(16), box.Height), ink, TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
                box = new Rectangle(x0 + Theme.Px(22), box.Y, tw + Theme.Px(2), box.Height);
                TextRenderer.DrawText(g, Text, Font, box, ink, TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding);
                return;
            }
            TextRenderer.DrawText(g, Text, Font, box, ink, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis);
        }
    }

    /// Small square or round button with one icon glyph ("?" next to page titles, title bar, mini window).
    class IconButton : PaintedControl
    {
        public string Glyph;
        public bool Round, Plain, Alert;

        public IconButton(string glyph, string accessibleName, int size)
        {
            Glyph = glyph;
            AccessibleName = accessibleName;
            Text = accessibleName;
            Size = new Size(Theme.Px(size), Theme.Px(size));
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new RectangleF(Theme.Px(1), Theme.Px(1), Width - Theme.Px(2) - 1, Height - Theme.Px(2) - 1);
            var radius = Round ? r.Height / 2 : Theme.Px(Theme.ControlRadius);
            using (var path = Theme.Round(r, radius))
            {
                if (Alert) using (var b = new SolidBrush(Color.FromArgb(70, Theme.Bad))) g.FillPath(b, path);
                else if (!Plain || Hover) using (var b = new SolidBrush(Pressed ? Theme.Card : Hover ? Theme.RaisedHover : Theme.Raised)) g.FillPath(b, path);
                if (Round || Alert) using (var p = new Pen(Alert ? Color.FromArgb(160, Theme.Bad) : Theme.BorderHi)) g.DrawPath(p, path);
            }
            Ring(g, r, radius);
            var f = Glyph.Length == 1 && Glyph[0] < 0xE000 ? Theme.SmallStrong : Theme.GlyphSmall;
            TextRenderer.DrawText(g, Glyph, f, Rectangle.Round(r), Alert ? Theme.Bad : Hover ? Theme.Ink : Theme.Ink2,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
        }
    }

    /// On/off switch. Still a CheckBox: Space toggles, screen readers see a check box with its Text.
    class ToggleSwitch : CheckBox
    {
        bool hover;

        public ToggleSwitch(string accessibleText)
        {
            Text = accessibleText; // not drawn; the visible label sits next to the switch
            AccessibleName = accessibleText;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            AutoSize = false;
            Size = new Size(Theme.Px(48), Theme.Px(28));
            Cursor = Cursors.Hand;
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnCheckedChanged(EventArgs e) { Invalidate(); base.OnCheckedChanged(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Parent != null ? Parent.BackColor : Theme.Card);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float tw = Theme.Px(40), th = Theme.Px(20);
            var track = new RectangleF(Width - tw - Theme.Px(3), (Height - th) / 2, tw, th);
            using (var path = Theme.Round(track, th / 2))
            {
                if (Checked) using (var b = Theme.Sunset(track, 0f)) g.FillPath(b, path);
                else
                {
                    if (hover) using (var b = new SolidBrush(Theme.Raised)) g.FillPath(b, path);
                    using (var p = new Pen(hover ? Theme.Mute : Theme.BorderHi)) g.DrawPath(p, path);
                }
                if (!Enabled) using (var b = new SolidBrush(Color.FromArgb(140, Theme.Card))) g.FillPath(b, path);
            }
            var k = Theme.Px(10);
            var knob = new RectangleF(Checked ? track.Right - k - Theme.Px(5) : track.X + Theme.Px(5), track.Y + (th - k) / 2, k, k);
            using (var b = new SolidBrush(Checked ? Theme.OnAccent : Theme.Ink2)) g.FillEllipse(b, knob);
            if (Focused && ShowFocusCues) Ui.FocusRing(g, track, th / 2);
        }
    }

    /// A row of options, one chosen (1s / 2s / 5s, page tabs). Arrow keys move the choice.
    class Segmented : PaintedControl
    {
        readonly string[] options;
        int selected;
        public event Action Changed;

        public Segmented(string accessibleName, string[] options, int padding)
        {
            this.options = options;
            AccessibleName = accessibleName;
            AccessibleRole = AccessibleRole.PageTabList;
            Font = Theme.Body;
            var w = Theme.Px(8);
            foreach (var o in options) w += TextRenderer.MeasureText(o, Font).Width + Theme.Px(padding * 2);
            Size = new Size(w, Theme.Px(34));
            UpdateDescription();
        }

        public int Selected
        {
            get { return selected; }
            set { if (value != selected && value >= 0 && value < options.Length) { selected = value; UpdateDescription(); Invalidate(); if (Changed != null) Changed(); } }
        }

        void UpdateDescription() { AccessibleDescription = options[selected] + " chosen"; }

        Rectangle Slot(int i)
        {
            var x = Theme.Px(4);
            var free = Width - Theme.Px(8);
            var total = 0;
            foreach (var o in options) total += TextRenderer.MeasureText(o, Font).Width;
            for (var j = 0; j < options.Length; j++)
            {
                var w = j == options.Length - 1 ? Width - Theme.Px(4) - x : (int)(free * (TextRenderer.MeasureText(options[j], Font).Width / (float)total));
                if (j == i) return new Rectangle(x, Theme.Px(4), w, Height - Theme.Px(8));
                x += w;
            }
            return Rectangle.Empty;
        }

        protected override bool IsInputKey(Keys keyData) { return keyData == Keys.Left || keyData == Keys.Right || base.IsInputKey(keyData); }
        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Left) { Selected = Math.Max(0, selected - 1); e.Handled = true; }
            else if (e.KeyCode == Keys.Right) { Selected = Math.Min(options.Length - 1, selected + 1); e.Handled = true; }
            base.OnKeyDown(e);
        }
        protected override void OnMouseClick(MouseEventArgs e)
        {
            for (var i = 0; i < options.Length; i++) if (Slot(i).Contains(e.Location)) Selected = i;
            base.OnMouseClick(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new RectangleF(.5f, .5f, Width - 1.5f, Height - 1.5f);
            var radius = Theme.Px(Theme.ControlRadius + 2);
            using (var path = Theme.Round(r, radius))
            {
                using (var b = new SolidBrush(Theme.Card)) g.FillPath(b, path);
                using (var p = new Pen(Theme.Border)) g.DrawPath(p, path);
            }
            for (var i = 0; i < options.Length; i++)
            {
                var s = Slot(i);
                if (i == selected)
                    using (var path = Theme.Round(s, Theme.Px(Theme.ControlRadius)))
                    using (var b = new SolidBrush(Theme.RaisedHover)) g.FillPath(b, path);
                TextRenderer.DrawText(g, options[i], i == selected ? Theme.Strong : Font, s, i == selected ? Theme.Ink : Theme.Mute,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding);
            }
            Ring(g, r, radius);
        }
    }

    /// Dark rounded text box: a borderless TextBox inside a painted frame; sunset frame while typing.
    class InputBox : Panel
    {
        public readonly TextBox Box = new TextBox();
        bool hover;

        public InputBox(string accessibleName)
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            Box.BorderStyle = BorderStyle.None;
            Box.BackColor = Theme.Input;
            Box.ForeColor = Theme.Ink;
            Box.Font = Theme.Body;
            Box.AccessibleName = accessibleName;
            Box.GotFocus += delegate { Invalidate(); };
            Box.LostFocus += delegate { Invalidate(); };
            Box.MouseEnter += delegate { hover = true; Invalidate(); };
            Box.MouseLeave += delegate { hover = false; Invalidate(); };
            Controls.Add(Box);
            Height = Theme.Px(38);
            Cursor = Cursors.IBeam;
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { Box.Focus(); base.OnMouseDown(e); }

        protected override void OnLayout(LayoutEventArgs e)
        {
            base.OnLayout(e);
            var pad = Theme.Px(12);
            Box.SetBounds(pad, (Height - Box.Height) / 2, Math.Max(10, Width - 2 * pad), Box.Height);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Parent != null ? Parent.BackColor : Theme.Card);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var inset = Theme.Px(2);
            var r = new RectangleF(inset, inset, Width - 2 * inset - 1, Height - 2 * inset - 1);
            var focused = Box.Focused;
            using (var path = Theme.Round(r, Theme.Px(Theme.ControlRadius)))
            {
                using (var b = new SolidBrush(Theme.Input)) g.FillPath(b, path);
                if (focused) using (var b = Theme.Sunset(r, 0f)) using (var p = new Pen(b, 1.5f * Theme.Scale)) g.DrawPath(p, path);
                else using (var p = new Pen(hover ? Theme.BorderHi : Theme.Border)) g.DrawPath(p, path);
            }
        }
    }

    /// One sidebar item with an icon and an optional count badge. Tab reaches it, Enter or Space opens the page.
    class NavItem : PaintedControl
    {
        readonly string glyph;
        bool selected;
        string badge = "";
        public Color HoverFill = Theme.NavHover, SelectedFill = Theme.NavActive;

        public NavItem(string text, string glyph)
        {
            Text = text;
            this.glyph = glyph;
            AccessibleRole = AccessibleRole.PageTab;
            AccessibleName = text;
            Size = new Size(Theme.Px(200), Theme.Px(38));
        }

        public bool Selected
        {
            get { return selected; }
            set { if (selected != value) { selected = value; AccessibleDescription = value ? "Current page" : null; Invalidate(); } }
        }

        public string Badge
        {
            set
            {
                var v = value ?? "";
                if (v == badge) return;
                badge = v;
                AccessibleName = Text + (v == "" ? "" : ", " + v + " to check");
                Invalidate();
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new RectangleF(Theme.Px(2), Theme.Px(1), Width - Theme.Px(4) - 1, Height - Theme.Px(2) - 1);
            var radius = Theme.Px(Theme.ControlRadius);
            if (selected || Hover)
                using (var path = Theme.Round(r, radius))
                using (var b = new SolidBrush(selected ? SelectedFill : HoverFill)) g.FillPath(b, path);
            if (selected)
            {
                var bar = new RectangleF(r.X, r.Y + Theme.Px(10), Theme.Px(3), r.Height - Theme.Px(20));
                using (var path = Theme.Round(bar, bar.Width / 2))
                using (var b = Theme.Sunset(bar, 90f)) g.FillPath(b, path);
            }
            var ink = selected || Hover ? Theme.Ink : Theme.Ink2;
            TextRenderer.DrawText(g, glyph, Theme.Glyph, new Rectangle(Theme.Px(14), 0, Theme.Px(22), Height), ink,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, Text, Theme.Body, new Rectangle(Theme.Px(48), 0, Width - Theme.Px(badge == "" ? 54 : 90), Height), ink,
                TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis);
            if (badge != "")
            {
                var sz = TextRenderer.MeasureText(badge, Theme.Tiny);
                var b = new RectangleF(Width - Theme.Px(14) - Math.Max(sz.Width, Theme.Px(12)) - Theme.Px(8), (Height - Theme.Px(18)) / 2f, Math.Max(sz.Width, Theme.Px(12)) + Theme.Px(8), Theme.Px(18));
                using (var path = Theme.Round(b, b.Height / 2))
                using (var br = new SolidBrush(Theme.RaisedHover)) g.FillPath(br, path);
                TextRenderer.DrawText(g, badge, Theme.Tiny, Rectangle.Round(b), Theme.Ink, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            }
            Ring(g, RectangleF.Inflate(r, -Theme.Px(2), -Theme.Px(2)), radius);
        }
    }

    /// Home tile: icon, a small note or key chips at the top right, a bold title and a grey line.
    /// Active tiles get the soft sunset tint. Clickable like a button.
    class Tile : PaintedControl
    {
        public string Glyph = "", Corner = "", Title = "", Sub = "";
        public string[] Keys;
        public bool Active, Alert, Compact;

        public Tile() { Size = new Size(Theme.Px(180), Theme.Px(112)); }

        public void Set(string glyph, string corner, string title, string sub, bool active, bool alert)
        {
            if (glyph == Glyph && corner == Corner && title == Title && sub == Sub && active == Active && alert == Alert) return;
            Glyph = glyph; Corner = corner; Title = title; Sub = sub; Active = active; Alert = alert;
            AccessibleName = title;
            AccessibleDescription = sub + (Keys != null ? ", hotkey " + string.Join(" ", Keys) : "");
            Ui.TipIfCut(this, sub, Compact ? Theme.Tiny : Theme.Small, Width - Theme.Px(Compact ? 50 : 32), title + ": " + sub);
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new RectangleF(.5f, .5f, Width - 1.5f, Height - 1.5f);
            var radius = Theme.Px(Theme.CardRadius);
            using (var path = Theme.Round(r, radius))
            {
                using (var b = new SolidBrush(Hover ? Theme.NavActive : Theme.Card)) g.FillPath(b, path);
                if (Active || Alert)
                {
                    var c1 = Alert ? Color.FromArgb(46, Theme.Bad) : Color.FromArgb(40, Theme.Pink);
                    var c2 = Alert ? Color.FromArgb(14, Theme.Bad) : Color.FromArgb(20, Theme.Orange);
                    using (var b = new LinearGradientBrush(r, c1, c2, 35f)) g.FillPath(b, path);
                    using (var p = new Pen(Alert ? Color.FromArgb(120, Theme.Bad) : Color.FromArgb(100, 0xff, 0x78, 0x6e))) g.DrawPath(p, path);
                }
                else using (var p = new Pen(Theme.Border)) g.DrawPath(p, path);
            }
            int pad = Theme.Px(16);
            if (Compact)
            {
                // Flyout size: icon on the left, two lines next to it.
                TextRenderer.DrawText(g, Glyph, Theme.Glyph, new Rectangle(Theme.Px(10), 0, Theme.Px(26), Height), Alert ? Theme.Bad : Active ? Theme.Ink : Theme.Ink2,
                    TextFormatFlags.VerticalCenter | TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPadding);
                TextRenderer.DrawText(g, Title, Theme.SmallStrong, new Rectangle(Theme.Px(42), Theme.Px(12), Width - Theme.Px(50), Theme.Px(20)), Theme.Ink,
                    TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding);
                TextRenderer.DrawText(g, Sub, Theme.Tiny, new Rectangle(Theme.Px(42), Theme.Px(33), Width - Theme.Px(50), Theme.Px(18)), Theme.Mute,
                    TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding);
                Ring(g, r, radius);
                return;
            }
            TextRenderer.DrawText(g, Glyph, Theme.GlyphBig, new Point(pad - Theme.Px(2), Theme.Px(15)), Alert ? Theme.Bad : Active ? Theme.Ink : Theme.Ink2, TextFormatFlags.NoPadding);
            if (Keys != null) Ui.DrawKeys(g, Keys, Width - pad + Theme.Px(4), Theme.Px(13), true);
            else if (Corner != "")
                TextRenderer.DrawText(g, Corner, Theme.Small, new Rectangle(0, Theme.Px(14), Width - pad, Theme.Px(20)), Theme.Ink2,
                    TextFormatFlags.Right | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis);
            TextRenderer.DrawText(g, Title, Theme.Strong, new Rectangle(pad, Height - Theme.Px(56), Width - 2 * pad, Theme.Px(22)), Theme.Ink,
                TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, Sub, Theme.Small, new Rectangle(pad, Height - Theme.Px(32), Width - 2 * pad, Theme.Px(20)), Theme.Mute,
                TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding);
            Ring(g, r, radius);
        }
    }

    /// One line series for Chart. Values may contain nulls (gaps / lost pings).
    class Series
    {
        public Color Color; public float?[] Values; public bool Fill;
        public Series(Color c, float?[] v, bool fill) { Color = c; Values = v; Fill = fill; }
    }

    /// Light line chart: grid lines, optional y labels, x labels under it, a friendly text when empty.
    class Chart : Control
    {
        public List<Series> Lines = new List<Series>();
        public float Max = 100;
        public bool AutoMax;
        public string[] XLabels = new string[0];
        public string Unit = "";
        public bool YLabels;
        public string Empty = "Measuring…";
        public float? Guide;        // dashed line, e.g. 95 %
        public string GuideText;
        public bool MarkPeak;

        public Chart()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Card;
            TabStop = false;
            AccessibleRole = AccessibleRole.Chart;
        }

        public void SetData(List<Series> lines, string[] xLabels)
        {
            Lines = lines;
            XLabels = xLabels ?? new string[0];
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var left = YLabels ? Theme.Px(48) : 0;
            var plot = new RectangleF(left, Theme.Px(6), Width - left - 1, Height - Theme.Px(XLabels.Length > 0 ? 30 : 8));
            var max = Max;
            var points = 0;
            foreach (var s in Lines)
                if (s.Values != null)
                {
                    points = Math.Max(points, s.Values.Length);
                    if (AutoMax) foreach (var v in s.Values) if (v.HasValue && v.Value > max) max = v.Value;
                }
            if (AutoMax) max = (float)(Math.Ceiling(max / (YLabels ? 30f : 20f)) * (YLabels ? 30f : 20f));
            using (var area = new SolidBrush(Color.FromArgb(10, 255, 255, 255))) g.FillRectangle(area, plot);
            using (var grid = new Pen(Color.FromArgb(18, 255, 255, 255)))
                for (var i = 0; i <= 3; i++)
                {
                    var y = plot.Bottom - plot.Height * i / 3f;
                    g.DrawLine(grid, plot.Left, y, plot.Right, y);
                    if (YLabels && i > 0)
                        TextRenderer.DrawText(g, Math.Round(max * i / 3f) + (i == 3 ? " " + Unit : ""), Theme.Tiny, new Point(0, (int)y - Theme.Px(8)), Theme.Mute, TextFormatFlags.NoPrefix);
                }
            if (Guide.HasValue)
            {
                var y = plot.Bottom - plot.Height * Guide.Value / max;
                using (var p = new Pen(Color.FromArgb(70, Theme.GpuLine)) { DashStyle = DashStyle.Dash }) g.DrawLine(p, plot.Left, y, plot.Right, y);
                if (GuideText != null)
                    TextRenderer.DrawText(g, GuideText, Theme.Tiny, new Rectangle((int)plot.Left, (int)y + Theme.Px(2), (int)plot.Width - Theme.Px(6), Theme.Px(16)),
                        Theme.GpuLine, TextFormatFlags.Right | TextFormatFlags.NoPrefix);
            }
            for (var i = 0; i < XLabels.Length; i++)
            {
                var x = XLabels.Length == 1 ? plot.Left : plot.Left + plot.Width * i / (XLabels.Length - 1);
                var flags = i == 0 ? TextFormatFlags.Left : i == XLabels.Length - 1 ? TextFormatFlags.Right : TextFormatFlags.HorizontalCenter;
                var w = Theme.Px(80);
                var rx = i == 0 ? (int)x : i == XLabels.Length - 1 ? (int)x - w : (int)x - w / 2;
                TextRenderer.DrawText(g, XLabels[i], Theme.Tiny, new Rectangle(rx, (int)plot.Bottom + Theme.Px(6), w, Theme.Px(18)), Theme.Mute, flags | TextFormatFlags.NoPrefix);
            }
            if (points < 2)
            {
                TextRenderer.DrawText(g, Empty, Theme.Body, Rectangle.Round(plot), Theme.Mute,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
                return;
            }
            foreach (var s in Lines)
            {
                if (s.Values == null || s.Values.Length < 2) continue;
                var run = new List<PointF>();
                PointF peak = PointF.Empty;
                float peakV = -1;
                Action flush = delegate
                {
                    if (run.Count >= 2)
                    {
                        if (s.Fill)
                            using (var path = new GraphicsPath())
                            {
                                path.AddLines(run.ToArray());
                                path.AddLine(run[run.Count - 1], new PointF(run[run.Count - 1].X, plot.Bottom));
                                path.AddLine(new PointF(run[0].X, plot.Bottom), run[0]);
                                using (var b = new SolidBrush(Color.FromArgb(30, s.Color))) g.FillPath(b, path);
                            }
                        using (var p = new Pen(s.Color, 1.6f * Theme.Scale) { LineJoin = LineJoin.Round }) g.DrawLines(p, run.ToArray());
                    }
                    run.Clear();
                };
                for (var i = 0; i < s.Values.Length; i++)
                {
                    var v = s.Values[i];
                    if (!v.HasValue) { flush(); continue; }
                    var x = plot.Left + plot.Width * i / (s.Values.Length - 1);
                    var y = plot.Bottom - plot.Height * Math.Min(1f, Math.Max(0f, v.Value / max));
                    run.Add(new PointF(x, y));
                    if (v.Value > peakV) { peakV = v.Value; peak = new PointF(x, y); }
                }
                flush();
                if (MarkPeak && peakV >= 0)
                    using (var b = new SolidBrush(Theme.Warn)) g.FillEllipse(b, peak.X - Theme.Px(4), peak.Y - Theme.Px(4), Theme.Px(8), Theme.Px(8));
            }
        }
    }

    /// Vertical bars 0..100 (CPU threads, last five games). Optional labels above and below each bar.
    class Bars : Control
    {
        public float[] Values = new float[0];
        public string[] TopLabels, BottomLabels;
        public bool HighlightLast;
        public Color Color = Theme.Orange;
        public string Empty = "";

        public Bars()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Card;
            TabStop = false;
            AccessibleRole = AccessibleRole.Chart;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var n = Values.Length;
            if (n == 0)
            {
                TextRenderer.DrawText(g, Empty, Theme.Small, ClientRectangle, Theme.Mute, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak);
                return;
            }
            var top = TopLabels != null ? Theme.Px(22) : 0;
            var bottom = BottomLabels != null ? Theme.Px(22) : 0;
            var slot = Width / (float)n;
            var gap = Math.Min(slot * .3f, Theme.Px(14));
            var h = Height - top - bottom;
            for (var i = 0; i < n; i++)
            {
                var x = i * slot + gap / 2;
                var w = slot - gap;
                var track = new RectangleF(x, top, w, h);
                using (var path = Theme.Round(track, Theme.Px(3)))
                using (var b = new SolidBrush(Color.FromArgb(14, 255, 255, 255))) g.FillPath(b, path);
                var v = Math.Max(0f, Math.Min(100f, Values[i]));
                var bh = Math.Max(Theme.Px(3), h * v / 100f);
                var bar = new RectangleF(x, top + h - bh, w, bh);
                using (var path = Theme.Round(bar, Theme.Px(3)))
                {
                    if (HighlightLast && i == n - 1) using (var b = Theme.Sunset(bar, 90f)) g.FillPath(b, path);
                    else using (var b = new SolidBrush(HighlightLast ? Color.FromArgb(110, Theme.Pink) : Color)) g.FillPath(b, path);
                }
                var cell = new Rectangle((int)(i * slot), 0, (int)slot, top);
                if (TopLabels != null && i < TopLabels.Length) TextRenderer.DrawText(g, TopLabels[i], Theme.Tiny, new Rectangle(cell.X, (int)(bar.Y - top), cell.Width, top), Theme.Ink2, TextFormatFlags.HorizontalCenter | TextFormatFlags.Bottom);
                if (BottomLabels != null && i < BottomLabels.Length) TextRenderer.DrawText(g, BottomLabels[i], Theme.Tiny, new Rectangle(cell.X, Height - bottom, cell.Width, bottom), Theme.Mute, TextFormatFlags.HorizontalCenter | TextFormatFlags.Bottom);
            }
        }
    }

    /// "Name  ▬▬▬▬───  value" row (This PC, drives, memory split, app list).
    class BarRow : Control
    {
        public string Label = "", Value = "";
        public float Fraction;
        public Color Color = Theme.Ink2;
        public bool Gradient;
        public int LabelWidth = 48, ValueWidth = 76;

        public BarRow()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Card;
            TabStop = false;
            Height = Theme.Px(26);
        }

        public void Set(string label, float fraction, string value)
        {
            if (label == Label && Math.Abs(fraction - Fraction) < .005f && value == Value) return;
            Label = label; Fraction = fraction; Value = value;
            AccessibleName = label + " " + value;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var lw = Theme.Px(LabelWidth);
            var vw = Theme.Px(ValueWidth);
            const TextFormatFlags f = TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding;
            TextRenderer.DrawText(g, Label, Theme.Body, new Rectangle(0, 0, lw - Theme.Px(8), Height), Theme.Ink2, f);
            TextRenderer.DrawText(g, Value, Theme.Body, new Rectangle(Width - vw, 0, vw, Height), Theme.Ink, f | TextFormatFlags.Right);
            var track = new RectangleF(lw, Height / 2f - Theme.Px(3), Math.Max(1, Width - lw - vw - Theme.Px(12)), Theme.Px(6));
            using (var path = Theme.Round(track, track.Height / 2))
            using (var b = new SolidBrush(Color.FromArgb(22, 255, 255, 255))) g.FillPath(b, path);
            var fr = Math.Max(0f, Math.Min(1f, Fraction));
            if (fr > 0)
            {
                var bar = new RectangleF(track.X, track.Y, Math.Max(track.Height, track.Width * fr), track.Height);
                using (var path = Theme.Round(bar, bar.Height / 2))
                {
                    if (Gradient) using (var b = Theme.Sunset(bar, 0f)) g.FillPath(b, path);
                    else using (var b = new SolidBrush(Color)) g.FillPath(b, path);
                }
            }
        }
    }

    /// Label with a coloured status dot in front.
    class DotLabel : Label
    {
        Color dot = Theme.Mute;

        public DotLabel() { SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint, true); UseMnemonic = false; }

        public Color Dot { get { return dot; } set { if (dot != value) { dot = value; Invalidate(); } } }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            if (BackColor == Color.Transparent) Ui.PaintParent(this, e); else e.Graphics.Clear(BackColor);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var d = Math.Max(Theme.Px(8), Font.Height * .45f);
            var c = new RectangleF(Theme.Px(3), (Height - d) / 2, d, d);
            using (var halo = new SolidBrush(Color.FromArgb(60, dot))) g.FillEllipse(halo, RectangleF.Inflate(c, 3 * Theme.Scale, 3 * Theme.Scale));
            using (var b = new SolidBrush(dot)) g.FillEllipse(b, c);
            var x = (int)(c.Right + d * .9f);
            TextRenderer.DrawText(g, Text, Font, new Rectangle(x, 0, Width - x, Height), ForeColor,
                TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding);
        }
    }

    /// Label painted through a back buffer, so live values change without flicker.
    class SmoothLabel : Label
    {
        public SmoothLabel() { DoubleBuffered = true; }
    }

    /// Small read-only state pill ("On" / "Off"). AnchorRight keeps its right edge in place when the text changes.
    class Pill : Control
    {
        bool on;
        public int AnchorRight = -1;

        public Pill()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            TabStop = false;
            AccessibleRole = AccessibleRole.StaticText;
            Height = Theme.Px(22);
        }

        public void Set(string text, bool on)
        {
            if (text == Text && on == this.on && Width > 0) return;
            Text = text;
            this.on = on;
            AccessibleName = text;
            Width = TextRenderer.MeasureText(text, Theme.Tiny).Width + Theme.Px(18);
            if (AnchorRight >= 0) Left = AnchorRight - Width;
            Invalidate();
        }

        protected override void OnPaintBackground(PaintEventArgs e) { Ui.PaintParent(this, e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new RectangleF(.5f, .5f, Width - 1.5f, Height - 1.5f);
            using (var path = Theme.Round(r, r.Height / 2))
            {
                using (var b = new SolidBrush(on ? Color.FromArgb(38, Theme.Good) : Theme.Raised)) g.FillPath(b, path);
                using (var p = new Pen(on ? Color.FromArgb(90, Theme.Good) : Theme.Border)) g.DrawPath(p, path);
            }
            TextRenderer.DrawText(g, Text, Theme.Tiny, ClientRectangle, on ? Theme.Good : Theme.Mute,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding);
        }
    }

    /// Compact summary of settings that live in the Settings pop-up: "● Measuring every 1 s | ⚙ Change".
    /// The whole chip is a button that opens Settings at the right section.
    class SummaryChip : PaintedControl
    {
        readonly string link;
        Color dot = Theme.Mute;
        public int AnchorRight = -1;

        public SummaryChip(string link)
        {
            this.link = link;
            Font = Theme.Small;
            Height = Theme.Px(32);
            if (link == "") { TabStop = false; Cursor = Cursors.Default; } // status only, not a button
            else Ui.Tips.SetToolTip(this, "Change in Settings");
        }

        public void Set(string text, Color dotColor)
        {
            if (text == Text && dotColor == dot && Width > Theme.Px(40)) return;
            Text = text;
            dot = dotColor;
            AccessibleName = link == "" ? text : text + ". Change in Settings";
            Width = Theme.Px(30) + TextRenderer.MeasureText(text, Font).Width + (link == "" ? Theme.Px(14) : Theme.Px(25) + Theme.Px(20) + TextRenderer.MeasureText(link, Theme.SmallStrong).Width + Theme.Px(10));
            if (AnchorRight >= 0) Left = AnchorRight - Width;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new RectangleF(Theme.Px(1), Theme.Px(1), Width - Theme.Px(2) - 1, Height - Theme.Px(2) - 1);
            using (var path = Theme.Round(r, r.Height / 2))
            {
                var lit = link != "" && Hover;
                using (var b = new SolidBrush(lit && !Pressed ? Theme.Raised : Theme.Card)) g.FillPath(b, path);
                using (var p = new Pen(lit ? Theme.BorderHi : Theme.Border)) g.DrawPath(p, path);
            }
            var d = Theme.Px(7);
            using (var b = new SolidBrush(dot)) g.FillEllipse(b, Theme.Px(14), (Height - d) / 2f, d, d);
            const TextFormatFlags f = TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding;
            var tw = TextRenderer.MeasureText(Text, Font).Width;
            var x = Theme.Px(30);
            TextRenderer.DrawText(g, Text, Font, new Rectangle(x, 0, tw + 2, Height), Theme.Ink2, f);
            if (link == "") return;
            x += tw + Theme.Px(12);
            using (var p = new Pen(Theme.Border)) g.DrawLine(p, x, Theme.Px(8), x, Height - Theme.Px(8));
            x += Theme.Px(12);
            var ink = Hover ? Theme.Ink : Theme.Ink2;
            TextRenderer.DrawText(g, "", Theme.GlyphSmall, new Rectangle(x, 0, Theme.Px(14), Height), ink, f);
            x += Theme.Px(20);
            var lw = TextRenderer.MeasureText(link, Theme.SmallStrong).Width;
            TextRenderer.DrawText(g, link, Theme.SmallStrong, new Rectangle(x, 0, lw + 2, Height), ink, f);
            Ring(g, r, r.Height / 2);
        }
    }

    /// Shared helpers for building the pages (positions in 96-dpi units).
    static class Ui
    {
        public static void PaintParent(Control c, PaintEventArgs e)
        {
            if (c.Parent == null) { e.Graphics.Clear(Theme.Base); return; }
            var state = e.Graphics.Save();
            e.Graphics.TranslateTransform(-c.Left, -c.Top);
            var pe = new PaintEventArgs(e.Graphics, new Rectangle(c.Left, c.Top, c.Width, c.Height));
            Painter.One.Bg(c.Parent, pe);
            // A card's fill is painted in its OnPaint; repeat just the fill so children's corners match the card.
            if (c.Parent is Card)
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                var r = new RectangleF(.5f, .5f, c.Parent.Width - 1.5f, c.Parent.Height - 1.5f);
                using (var path = Theme.Round(r, Theme.Px(Theme.CardRadius)))
                using (var fill = new SolidBrush(c.Parent.BackColor)) e.Graphics.FillPath(fill, path);
            }
            e.Graphics.Restore(state);
        }

        // Control.InvokePaintBackground is protected; this tiny subclass reaches it.
        class Painter : Control
        {
            public static readonly Painter One = new Painter();
            public void Bg(Control c, PaintEventArgs e) { InvokePaintBackground(c, e); }
        }

        public static void FocusRing(Graphics g, RectangleF shape, float radius)
        {
            var gap = 2f * Theme.Scale;
            var ring = RectangleF.Inflate(shape, gap, gap);
            using (var path = Theme.Round(ring, radius + gap))
            using (var p = new Pen(Theme.Ink, 1.5f * Theme.Scale)) g.DrawPath(p, path);
        }

        /// Draws key chips (Ctrl Alt M); `rightAlign` = x is the right edge. Returns the width used.
        public static int DrawKeys(Graphics g, string[] keys, int x, int y, bool rightAlign)
        {
            var widths = new int[keys.Length];
            var total = 0;
            for (var i = 0; i < keys.Length; i++) { widths[i] = TextRenderer.MeasureText(keys[i], Theme.Tiny).Width + Theme.Px(8); total += widths[i] + Theme.Px(4); }
            var cx = rightAlign ? x - total : x;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            for (var i = 0; i < keys.Length; i++)
            {
                var r = new RectangleF(cx, y, widths[i], Theme.Px(22));
                using (var path = Theme.Round(r, Theme.Px(4)))
                {
                    using (var b = new SolidBrush(Theme.Raised)) g.FillPath(b, path);
                    using (var p = new Pen(Theme.BorderHi)) g.DrawPath(p, path);
                }
                using (var p = new Pen(Theme.BorderHi, Theme.Px(2))) g.DrawLine(p, r.X + Theme.Px(3), r.Bottom - Theme.Px(1), r.Right - Theme.Px(3), r.Bottom - Theme.Px(1));
                TextRenderer.DrawText(g, keys[i], Theme.Tiny, Rectangle.Round(r), Theme.Ink2, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
                cx += widths[i] + Theme.Px(4);
            }
            return total;
        }

        /// Shared tooltip for painted controls whose text is cut (labels show their own: AutoEllipsis).
        public static readonly ToolTip Tips = new ToolTip();

        /// Sets the tooltip only when the text does not fit in `width`; clears it otherwise.
        public static void TipIfCut(Control c, string text, Font font, int width, string full)
        {
            var cut = !string.IsNullOrEmpty(text) && TextRenderer.MeasureText(text, font).Width > width;
            var want = cut ? full : null;
            if (Tips.GetToolTip(c) != (want ?? "")) Tips.SetToolTip(c, want);
        }

        public static Label Label(Control parent, string text, Font font, Color color, int x, int y, int w, int h)
        {
            var l = new SmoothLabel { Text = text, Font = font, ForeColor = color, Bounds = Theme.R(x, y, w, h), AutoEllipsis = true, UseMnemonic = false };
            l.BackColor = parent is Card ? parent.BackColor : Color.Transparent;
            parent.Controls.Add(l);
            return l;
        }

        public static Card Card(Control parent, string title, int x, int y, int w, int h)
        {
            var c = new Card(title) { Bounds = Theme.R(x, y, w, h) };
            parent.Controls.Add(c);
            return c;
        }

        public static FlatButton Button(Control parent, string text, bool primary, int x, int y)
        {
            var b = new FlatButton(text, primary) { Location = new Point(Theme.Px(x), Theme.Px(y)) };
            parent.Controls.Add(b);
            return b;
        }

        /// Button whose right edge sits at `right` (96-dpi units).
        public static FlatButton ButtonRight(Control parent, string text, bool primary, int right, int y)
        {
            var b = Button(parent, text, primary, 0, y);
            b.Left = Theme.Px(right) - b.Width;
            return b;
        }

        public static FlatButton Link(Control parent, string text, int right, int y)
        {
            var b = new FlatButton(text, false) { Link = true };
            b.Font = Theme.Small;
            b.FitWidth();
            b.Location = new Point(Theme.Px(right) - b.Width, Theme.Px(y));
            parent.Controls.Add(b);
            return b;
        }

        public static ToggleSwitch Toggle(Control parent, string name, int right, int y)
        {
            var t = new ToggleSwitch(name);
            t.Location = new Point(Theme.Px(right) - t.Width, Theme.Px(y));
            parent.Controls.Add(t);
            return t;
        }

        public static void Divider(Control parent, int x, int y, int w)
        {
            parent.Controls.Add(new Panel { BackColor = Theme.Border, Bounds = new Rectangle(Theme.Px(x), Theme.Px(y), Theme.Px(w), 1) });
        }

        /// Glyph label (icon font) at x, y.
        public static Label Icon(Control parent, string glyph, Color color, int x, int y)
        {
            var l = Label(parent, glyph, Theme.Glyph, color, x, y, 24, 24);
            l.TextAlign = ContentAlignment.MiddleCenter;
            l.AccessibleRole = AccessibleRole.Graphic;
            l.AccessibleName = "";
            return l;
        }

        /// A settings row inside a card: optional icon, title, optional grey line, switch at the right.
        public static ToggleSwitch SwitchRow(Control card, string glyph, string title, string sub, int y, int width)
        {
            var x = 16;
            if (glyph != null) { Icon(card, glyph, Theme.Ink2, 14, y + (sub == null ? 6 : 10)); x = 48; }
            if (sub == null) Label(card, title, Theme.Body, Theme.Ink, x, y + 6, width - x - 80, 24).TextAlign = ContentAlignment.MiddleLeft;
            else
            {
                Label(card, title, Theme.Body, Theme.Ink, x, y, width - x - 80, 22);
                Label(card, sub, Theme.Small, Theme.Mute, x, y + 22, width - x - 80, 20);
            }
            var t = Toggle(card, title, width - 14, y + 4);
            if (sub != null) t.AccessibleDescription = sub;
            return t;
        }

        public static void Set(Label l, string text) { if (l.Text != text) l.Text = text; }
        public static void Set(Label l, string text, Color color) { Set(l, text); if (l.ForeColor != color) l.ForeColor = color; }
        /// Sets Visible every time: Control.Visible reads false while the window itself is hidden.
        public static void Show(Control c, bool visible) { c.Visible = visible; }

        /// English day names and dots for decimals, like the rest of the window text.
        public static readonly System.Globalization.CultureInfo En = System.Globalization.CultureInfo.GetCultureInfo("en-GB");

        public static void Open(string url)
        {
            try { System.Diagnostics.Process.Start(url); }
            catch (Exception e) { MessageBox.Show("Could not open it: " + e.Message, Program.Title); }
        }

        public static string Pct(float? v) { return v.HasValue ? Math.Round(v.Value) + " %" : "–"; }
        public static string Gb(float v) { return v >= 10 ? Math.Round(v) + " GB" : v.ToString("0.0", Ui.En) + " GB"; }

        public static string Ago(DateTime t)
        {
            var s = DateTime.Now - t;
            if (s.TotalMinutes < 1) return "just now";
            if (s.TotalMinutes < 60) return (int)s.TotalMinutes + " min ago";
            if (t.Date == DateTime.Today) return "today " + t.ToString("HH:mm", Ui.En);
            if (t.Date == DateTime.Today.AddDays(-1)) return "yesterday " + t.ToString("HH:mm", Ui.En);
            return t.ToString("d MMM, HH:mm", Ui.En);
        }

        public static string Span(TimeSpan t)
        {
            if (t.TotalMinutes < 1) return "less than a minute";
            if (t.TotalHours < 1) return (int)t.TotalMinutes + " min";
            if (t.TotalDays < 1) return (int)t.TotalHours + " h " + t.Minutes + " min";
            return (int)t.TotalDays + (t.TotalDays < 2 ? " day " : " days ") + t.Hours + " h";
        }

        public static string Clock(TimeSpan t)
        {
            if (t < TimeSpan.Zero) t = TimeSpan.Zero;
            return t.TotalHours >= 1 ? ((int)t.TotalHours) + ":" + t.Minutes.ToString("00") + ":" + t.Seconds.ToString("00") : ((int)t.TotalMinutes) + ":" + t.Seconds.ToString("00");
        }
    }
}
