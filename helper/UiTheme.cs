// Bridge Night Helper: colours, fonts, shapes and the BN mark.
// helper/tools/make-icon.ps1 draws app.ico with the same mark; keep the two in step.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace BridgeNight
{
    /// Vice City sunset look.
    static class Theme
    {
        // Surfaces
        public static readonly Color Sidebar = Color.FromArgb(0x12, 0x08, 0x21);
        public static readonly Color NavActive = Color.FromArgb(0x24, 0x12, 0x3a);
        public static readonly Color NavHover = Color.FromArgb(0x1b, 0x0d, 0x2e);
        public static readonly Color Surface = Color.FromArgb(0x1a, 0x0f, 0x2a);
        public static readonly Color Border = Color.FromArgb(0x3d, 0x25, 0x59);
        public static readonly Color Input = Color.FromArgb(0x12, 0x0a, 0x1f);
        public static readonly Color Raised = Color.FromArgb(0x2a, 0x18, 0x40);
        public static readonly Color RaisedHover = Color.FromArgb(0x36, 0x20, 0x52);
        public static readonly Color BorderHi = Color.FromArgb(0x5a, 0x3a, 0x80);
        // Text
        public static readonly Color Ink = Color.FromArgb(0xf6, 0xee, 0xfc);
        public static readonly Color Mute = Color.FromArgb(0xb7, 0xa6, 0xcc);
        public static readonly Color OnAccent = Color.FromArgb(0x1a, 0x0a, 0x16);
        // Accents (no green: success is teal-cyan, used sparingly)
        public static readonly Color Pink = Color.FromArgb(0xff, 0x3e, 0x8f);
        public static readonly Color Coral = Color.FromArgb(0xff, 0x6b, 0x5b);
        public static readonly Color Orange = Color.FromArgb(0xff, 0x9f, 0x45);
        public static readonly Color Amber = Color.FromArgb(0xff, 0xc0, 0x6a);
        public static readonly Color Teal = Color.FromArgb(0x4f, 0xd8, 0xe8);
        // Window sky: night purple at the top, magenta in the middle, sunset orange at the bottom
        static readonly Color[] Sky =
        {
            Color.FromArgb(0x1a, 0x0b, 0x2e), Color.FromArgb(0x2d, 0x0f, 0x4a), Color.FromArgb(0xc2, 0x18, 0x5b),
            Color.FromArgb(0xff, 0x3e, 0x8f), Color.FromArgb(0xff, 0x7a, 0x3d), Color.FromArgb(0xff, 0xb3, 0x47),
        };
        static readonly float[] SkyStops = { 0f, .38f, .68f, .82f, .93f, 1f };

        public static readonly Font Body = new Font("Segoe UI", 10f);
        public static readonly Font Small = new Font("Segoe UI", 9f);
        public static readonly Font Strong = new Font("Segoe UI Semibold", 10f);
        public static readonly Font Caps = new Font("Segoe UI Semibold", 8.25f);
        public static readonly Font Big = new Font("Segoe UI Semibold", 14f);
        public static readonly Font Huge = new Font("Segoe UI Semibold", 26f);
        public static readonly Font H1 = new Font("Segoe UI Semibold", 18f);
        public static readonly Font Mono = new Font("Consolas", 9.5f);
        public static readonly Font Glyph = new Font("Segoe MDL2 Assets", 11f);

        public const int CardRadius = 12, ControlRadius = 8;

        /// System DPI / 96; the app is system DPI aware (app.manifest), so one factor fits all painting.
        public static readonly float Scale = ReadScale();
        static float ReadScale() { using (var g = Graphics.FromHwnd(IntPtr.Zero)) return g.DpiX / 96f; }
        public static int Px(float v) { return (int)Math.Round(v * Scale); }

        /// Pink to coral to orange; angle 0 = left to right, 90 = top to bottom.
        public static LinearGradientBrush Sunset(RectangleF r, float angle)
        {
            var b = new LinearGradientBrush(new RectangleF(r.X, r.Y, Math.Max(1, r.Width), Math.Max(1, r.Height)), Pink, Orange, angle);
            var blend = new ColorBlend();
            blend.Colors = new[] { Pink, Coral, Orange };
            blend.Positions = new[] { 0f, .5f, 1f };
            b.InterpolationColors = blend;
            return b;
        }

        /// The window background: vertical sunset sky plus a soft orange glow at the bottom.
        public static void PaintSky(Graphics g, Rectangle r)
        {
            if (r.Width <= 0 || r.Height <= 0) return;
            using (var b = new LinearGradientBrush(r, Sky[0], Sky[Sky.Length - 1], 90f))
            {
                var blend = new ColorBlend();
                blend.Colors = Sky;
                blend.Positions = SkyStops;
                b.InterpolationColors = blend;
                g.FillRectangle(b, r);
            }
            var glow = new RectangleF(r.X - r.Width * .1f, r.Bottom - r.Height * .32f, r.Width * 1.2f, r.Height * .64f);
            using (var path = new GraphicsPath())
            {
                path.AddEllipse(glow);
                using (var b = new PathGradientBrush(path))
                {
                    b.CenterColor = Color.FromArgb(110, 0xff, 0xc0, 0x6a);
                    b.SurroundColors = new[] { Color.FromArgb(0, 0xff, 0x7a, 0x3d) };
                    g.FillPath(b, path);
                }
            }
        }

        public static GraphicsPath Round(RectangleF r, float radius)
        {
            var d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            var p = new GraphicsPath();
            if (d <= 0) { p.AddRectangle(r); return p; }
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        /// The BN mark: dark violet rounded square, sunset rim, "BN" in the sunset gradient.
        public static void DrawMark(Graphics g, RectangleF r)
        {
            var s = Math.Min(r.Width, r.Height);
            var rim = s >= 24 ? Math.Max(1f, s / 22f) : 0f;
            var box = new RectangleF(r.X + rim / 2, r.Y + rim / 2, s - rim, s - rim);
            using (var path = Round(box, s * .24f))
            {
                using (var bg = new LinearGradientBrush(r, Color.FromArgb(0x2d, 0x0f, 0x4a), Color.FromArgb(0x12, 0x08, 0x21), 90f))
                    g.FillPath(bg, path);
                if (rim > 0)
                    using (var rb = Sunset(r, 45f))
                    using (var pen = new Pen(rb, rim)) g.DrawPath(pen, path);
            }
            using (var family = new FontFamily("Segoe UI"))
            using (var text = new GraphicsPath())
            {
                var style = s >= 32 ? FontStyle.Bold | FontStyle.Italic : FontStyle.Bold;
                text.AddString("BN", family, (int)style, 100f, PointF.Empty, StringFormat.GenericTypographic);
                var b = text.GetBounds();
                var k = Math.Min(s * (s <= 16 ? .9f : .62f) / b.Width, s * (s <= 16 ? .62f : .46f) / b.Height);
                using (var m = new Matrix())
                {
                    m.Translate(r.X + s / 2, r.Y + s / 2);
                    m.Scale(k, k);
                    m.Translate(-(b.X + b.Width / 2), -(b.Y + b.Height / 2));
                    text.Transform(m);
                }
                using (var fg = Sunset(text.GetBounds(), 45f)) g.FillPath(fg, text);
            }
        }

        public static Bitmap MarkBitmap(int size)
        {
            var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                DrawMark(g, new RectangleF(0, 0, size, size));
            }
            return bmp;
        }

        static Icon small, large;
        /// Tray size (16 px at 100 %) and window size (32 px); made once and kept for the app's lifetime.
        public static Icon SmallIcon { get { return small ?? (small = MarkIcon(System.Windows.Forms.SystemInformation.SmallIconSize.Width)); } }
        public static Icon LargeIcon { get { return large ?? (large = MarkIcon(System.Windows.Forms.SystemInformation.IconSize.Width)); } }

        static Icon MarkIcon(int size)
        {
            using (var b = MarkBitmap(size)) return Icon.FromHandle(b.GetHicon());
        }
    }
}
