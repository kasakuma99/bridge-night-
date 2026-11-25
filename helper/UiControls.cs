// Bridge Night Helper: custom-drawn controls (buttons, toggle switches, inputs, cards, sidebar items).
// Each one keeps the normal WinForms control underneath, so Tab, Enter/Space and screen readers keep working.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace BridgeNight
{
    /// Window background panel: paints the sunset sky. Labels on it use a transparent BackColor.
    class SkyPanel : Panel
    {
        public SkyPanel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Surface; // never seen; the sky is painted over it
        }

        protected override void OnPaintBackground(PaintEventArgs e) { Theme.PaintSky(e.Graphics, ClientRectangle); }
    }

    /// Solid dark rounded card. Its corners show the parent's background, children sit on Theme.Surface.
    class Card : Panel
    {
        readonly string title;
        public bool Glow;

        public Card(string title)
        {
            this.title = title;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Surface;
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            if (Parent == null) { e.Graphics.Clear(BackColor); return; }
            var state = e.Graphics.Save();
            e.Graphics.TranslateTransform(-Left, -Top);
            InvokePaintBackground(Parent, new PaintEventArgs(e.Graphics, Bounds));
            e.Graphics.Restore(state);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var w = Glow ? 1.5f * Theme.Scale : 1f;
            var r = new RectangleF(w / 2, w / 2, Width - w - .5f, Height - w - .5f);
            using (var path = Theme.Round(r, Theme.Px(Theme.CardRadius)))
            {
                using (var fill = new SolidBrush(BackColor)) g.FillPath(fill, path);
                if (Glow) using (var b = Theme.Sunset(r, 0f)) using (var p = new Pen(b, w)) g.DrawPath(p, path);
                else using (var p = new Pen(Theme.Border)) g.DrawPath(p, path);
            }
            if (!string.IsNullOrEmpty(title))
                TextRenderer.DrawText(g, title.ToUpperInvariant(), Theme.Caps, new Point(Theme.Px(20), Theme.Px(16)), Theme.Mute, TextFormatFlags.NoPrefix);
            base.OnPaint(e);
        }
    }

    /// Rounded button: gradient when primary; hover, pressed, disabled and keyboard-focus states.
    class FlatButton : Button
    {
        bool primary, hover, pressed;

        public FlatButton(string text, bool primary)
        {
            this.primary = primary;
            Text = text;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            Font = Theme.Strong;
            Cursor = Cursors.Hand;
            UseMnemonic = false;
            // Measured in device pixels; divide back to 96-dpi units because AutoScale scales sizes afterwards.
            Size = new Size((int)(TextRenderer.MeasureText(text, Font).Width / Theme.Scale) + 48, 42);
        }

        public bool Primary { get { return primary; } set { primary = value; Invalidate(); } }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; pressed = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { if (e.Button == MouseButtons.Left) { pressed = true; Invalidate(); } base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
        protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Parent != null ? Parent.BackColor : Theme.Surface);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var inset = Theme.Px(3); // room for the focus ring
            var r = new RectangleF(inset, inset, Width - 2 * inset - 1, Height - 2 * inset - 1);
            var text = Theme.Ink;
            using (var path = Theme.Round(r, Theme.Px(Theme.ControlRadius)))
            {
                if (!Enabled)
                {
                    using (var b = new SolidBrush(Theme.Raised)) g.FillPath(b, path);
                    text = Theme.Mute;
                }
                else if (primary)
                {
                    using (var b = Theme.Sunset(r, 0f)) g.FillPath(b, path);
                    if (pressed) using (var b = new SolidBrush(Color.FromArgb(50, 0, 0, 0))) g.FillPath(b, path);
                    else if (hover) using (var b = new SolidBrush(Color.FromArgb(36, 255, 255, 255))) g.FillPath(b, path);
                    text = Theme.OnAccent;
                }
                else
                {
                    using (var b = new SolidBrush(pressed ? Theme.Surface : hover ? Theme.RaisedHover : Theme.Raised)) g.FillPath(b, path);
                    using (var p = new Pen(hover ? Theme.BorderHi : Theme.Border)) g.DrawPath(p, path);
                }
            }
            if (Focused && ShowFocusCues) FocusRing(g, r, Theme.Px(Theme.ControlRadius));
            TextRenderer.DrawText(g, Text, Font, Rectangle.Round(r), text,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis);
        }

        public static void FocusRing(Graphics g, RectangleF shape, float radius)
        {
            var gap = 2f * Theme.Scale;
            var ring = RectangleF.Inflate(shape, gap, gap);
            using (var path = Theme.Round(ring, radius + gap))
            using (var p = new Pen(Theme.Amber, 1.5f * Theme.Scale)) g.DrawPath(p, path);
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
            Size = new Size(54, 34);
            Cursor = Cursors.Hand;
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnCheckedChanged(EventArgs e) { Invalidate(); base.OnCheckedChanged(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Parent != null ? Parent.BackColor : Theme.Surface);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float tw = Theme.Px(44), th = Theme.Px(24);
            var track = new RectangleF((Width - tw) / 2, (Height - th) / 2, tw, th);
            using (var path = Theme.Round(track, th / 2))
            {
                if (Checked) using (var b = Theme.Sunset(track, 0f)) g.FillPath(b, path);
                else
                {
                    using (var b = new SolidBrush(hover ? Theme.RaisedHover : Theme.Raised)) g.FillPath(b, path);
                    using (var p = new Pen(hover ? Theme.BorderHi : Theme.Border)) g.DrawPath(p, path);
                }
                if (!Enabled) using (var b = new SolidBrush(Color.FromArgb(120, Theme.Surface))) g.FillPath(b, path);
            }
            var k = th - Theme.Px(6);
            var knob = new RectangleF(Checked ? track.Right - k - Theme.Px(3) : track.X + Theme.Px(3), track.Y + Theme.Px(3), k, k);
            using (var b = new SolidBrush(Checked ? Theme.Ink : Theme.Mute)) g.FillEllipse(b, knob);
            if (Focused && ShowFocusCues) FlatButton.FocusRing(g, track, th / 2);
        }
    }

    /// Dark rounded text box: a borderless TextBox inside a painted frame; pink frame while typing.
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
            Box.Font = new Font("Segoe UI", 10.5f);
            Box.AccessibleName = accessibleName;
            Box.GotFocus += delegate { Invalidate(); };
            Box.LostFocus += delegate { Invalidate(); };
            Box.MouseEnter += delegate { hover = true; Invalidate(); };
            Box.MouseLeave += delegate { hover = false; Invalidate(); };
            Controls.Add(Box);
            Height = 42;
            Cursor = Cursors.IBeam;
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { Box.Focus(); base.OnMouseDown(e); }

        protected override void OnLayout(LayoutEventArgs e)
        {
            base.OnLayout(e);
            var pad = Theme.Px(14);
            Box.SetBounds(pad, (Height - Box.Height) / 2, Math.Max(10, Width - 2 * pad), Box.Height);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Parent != null ? Parent.BackColor : Theme.Surface);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var inset = Theme.Px(3);
            var r = new RectangleF(inset, inset, Width - 2 * inset - 1, Height - 2 * inset - 1);
            var focused = Box.Focused;
            using (var path = Theme.Round(r, Theme.Px(Theme.ControlRadius)))
            {
                if (focused)
                    using (var glow = Theme.Round(RectangleF.Inflate(r, 2 * Theme.Scale, 2 * Theme.Scale), Theme.Px(Theme.ControlRadius) + 2 * Theme.Scale))
                    using (var p = new Pen(Color.FromArgb(70, Theme.Pink), 3f * Theme.Scale)) g.DrawPath(p, glow);
                using (var b = new SolidBrush(Theme.Input)) g.FillPath(b, path);
                using (var p = new Pen(focused ? Theme.Pink : hover ? Theme.BorderHi : Theme.Border, focused ? 1.5f * Theme.Scale : 1f)) g.DrawPath(p, path);
            }
        }
    }

    /// One sidebar item. Selectable: Tab reaches it, Enter or Space opens the page.
    class NavItem : Control
    {
        readonly string glyph;
        bool selected, hover;

        public NavItem(string text, string glyph)
        {
            Text = text;
            this.glyph = glyph;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                ControlStyles.ResizeRedraw | ControlStyles.Selectable | ControlStyles.StandardClick, true);
            TabStop = true;
            Cursor = Cursors.Hand;
            AccessibleRole = AccessibleRole.PageTab;
            AccessibleName = text;
            Size = new Size(196, 42);
        }

        public bool Selected
        {
            get { return selected; }
            set { selected = value; AccessibleDescription = value ? "Current page" : null; Invalidate(); }
        }

        protected override bool IsInputKey(Keys keyData) { return keyData == Keys.Enter || base.IsInputKey(keyData); }
        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space) { e.Handled = true; OnClick(EventArgs.Empty); }
            base.OnKeyDown(e);
        }
        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Theme.Sidebar);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var inset = Theme.Px(3);
            var r = new RectangleF(inset, inset, Width - 2 * inset - 1, Height - 2 * inset - 1);
            var radius = Theme.Px(Theme.ControlRadius);
            if (selected || hover)
                using (var path = Theme.Round(r, radius))
                using (var b = new SolidBrush(selected ? Theme.NavActive : Theme.NavHover)) g.FillPath(b, path);
            if (selected)
            {
                var bar = new RectangleF(r.X, r.Y + Theme.Px(9), Theme.Px(3), r.Height - Theme.Px(18));
                using (var path = Theme.Round(bar, bar.Width / 2))
                using (var b = Theme.Sunset(bar, 90f)) g.FillPath(b, path);
            }
            var ink = selected || hover ? Theme.Ink : Theme.Mute;
            var glyphBox = new Rectangle(Theme.Px(16), 0, Theme.Px(24), Height);
            TextRenderer.DrawText(g, glyph, Theme.Glyph, glyphBox, selected ? Theme.Orange : ink,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, Text, selected ? Theme.Strong : Theme.Body, new Rectangle(Theme.Px(50), 0, Width - Theme.Px(56), Height), ink,
                TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis);
            if (Focused && ShowFocusCues) FlatButton.FocusRing(g, RectangleF.Inflate(r, -Theme.Px(2), -Theme.Px(2)), radius);
        }
    }

    /// Small round gauge: a ring that fills with the value, green below 60 %, orange below 85 %, red above.
    class Gauge : Control
    {
        public static readonly Color Green = Color.FromArgb(0x3d, 0xdc, 0x84);
        public static readonly Color Red = Color.FromArgb(0xff, 0x4d, 0x6d);
        readonly string caption;
        float? value;

        public Gauge(string caption)
        {
            this.caption = caption;
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            TabStop = false;
            AccessibleRole = AccessibleRole.ProgressBar;
            AccessibleName = caption + " load";
            AccessibleDescription = "not available";
        }

        public static Color Level(float v) { return v < 60 ? Green : v < 85 ? Theme.Amber : Red; }

        public float? Value
        {
            set
            {
                // Redraw only when the shown number changes.
                if (value.HasValue == this.value.HasValue && (!value.HasValue || Math.Round(value.Value) == Math.Round(this.value.Value))) return;
                this.value = value;
                AccessibleDescription = value.HasValue ? Math.Round(value.Value) + " percent" : "not available";
                Invalidate();
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float w = Theme.Px(6), pad = w / 2 + 1;
            var ring = new RectangleF(pad, pad, Width - 2 * pad, Height - 2 * pad);
            using (var track = new Pen(Theme.Raised, w)) g.DrawEllipse(track, ring);
            if (value.HasValue && value.Value > 0.5f)
            {
                using (var arc = new Pen(Level(value.Value), w) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                    g.DrawArc(arc, ring, -90, 360f * value.Value / 100f);
            }
            var text = value.HasValue ? Math.Round(value.Value) + "%" : "–";
            var mid = Height / 2;
            TextRenderer.DrawText(g, text, Theme.Strong, new Rectangle(0, mid - Theme.Px(15), Width, Theme.Px(20)), Theme.Ink,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
            TextRenderer.DrawText(g, caption, Theme.Caps, new Rectangle(0, mid + Theme.Px(3), Width, Theme.Px(16)), Theme.Mute,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
        }
    }

    /// Label with a coloured status dot in front.
    class DotLabel : Label
    {
        Color dot = Theme.Mute;

        public DotLabel() { SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint, true); UseMnemonic = false; }

        public Color Dot { get { return dot; } set { if (dot != value) { dot = value; Invalidate(); } } }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float d = Theme.Px(10);
            var c = new RectangleF(Theme.Px(1), (Height - d) / 2, d, d);
            using (var halo = new SolidBrush(Color.FromArgb(60, dot))) g.FillEllipse(halo, RectangleF.Inflate(c, 3 * Theme.Scale, 3 * Theme.Scale));
            using (var b = new SolidBrush(dot)) g.FillEllipse(b, c);
            TextRenderer.DrawText(g, Text, Font, new Rectangle(Theme.Px(20), 0, Width - Theme.Px(20), Height), ForeColor,
                TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis);
        }
    }
}
