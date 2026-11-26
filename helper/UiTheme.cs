// Bridge Night Helper: colours, fonts, shapes, the logo pictures and the bridge watermark.
// Near-black violet base with thin borders; the sunset gradient only on the logo, main buttons, active tiles and switches.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Reflection;

namespace BridgeNight
{
    static class Theme
    {
        // Surfaces
        public static readonly Color Base = Color.FromArgb(0x10, 0x0c, 0x16);
        public static readonly Color BaseTop = Color.FromArgb(0x17, 0x11, 0x20);
        public static readonly Color Card = Color.FromArgb(0x1a, 0x16, 0x21);
        public static readonly Color Raised = Color.FromArgb(0x26, 0x21, 0x2d);
        public static readonly Color RaisedHover = Color.FromArgb(0x30, 0x2a, 0x38);
        public static readonly Color Input = Color.FromArgb(0x13, 0x10, 0x18);
        public static readonly Color NavActive = Color.FromArgb(0x21, 0x1c, 0x28);
        public static readonly Color NavHover = Color.FromArgb(0x19, 0x15, 0x20);
        public static readonly Color Border = Color.FromArgb(0x2c, 0x27, 0x34);
        public static readonly Color BorderHi = Color.FromArgb(0x41, 0x3a, 0x4b);
        // Text
        public static readonly Color Ink = Color.FromArgb(0xf4, 0xef, 0xf9);
        public static readonly Color Ink2 = Color.FromArgb(0xcb, 0xbf, 0xd8);
        public static readonly Color Mute = Color.FromArgb(0x9d, 0x8f, 0xaf);
        public static readonly Color OnAccent = Color.FromArgb(0x1d, 0x0b, 0x14);
        // Sunset gradient
        public static readonly Color Pink = Color.FromArgb(0xff, 0x4f, 0x8e);
        public static readonly Color Coral = Color.FromArgb(0xff, 0x74, 0x66);
        public static readonly Color Orange = Color.FromArgb(0xff, 0x9c, 0x4a);
        // States and chart lines
        public static readonly Color Good = Color.FromArgb(0x45, 0xd6, 0xb8);
        public static readonly Color Warn = Color.FromArgb(0xff, 0xc0, 0x5c);
        public static readonly Color Bad = Color.FromArgb(0xff, 0x5d, 0x6c);
        public static readonly Color GpuLine = Color.FromArgb(0xff, 0x5c, 0x93);
        public static readonly Color CpuLine = Color.FromArgb(0xff, 0xc3, 0x4d);
        public static readonly Color MemLine = Color.FromArgb(0x7a, 0xa7, 0xff);
        public static readonly Color VramLine = Color.FromArgb(0xb9, 0x8c, 0xff);

        static readonly string TextFamily = Pick("Segoe UI Variable Text", "Segoe UI");
        static readonly string StrongFamily = Pick("Segoe UI Variable Text Semibold", "Segoe UI Semibold");
        static readonly string DisplayFamily = Pick("Segoe UI Variable Display Semib", "Segoe UI Semibold");
        static readonly string IconFamily = Pick("Segoe Fluent Icons", "Segoe MDL2 Assets");

        public static readonly Font Body = new Font(TextFamily, 10.5f);
        public static readonly Font Small = new Font(TextFamily, 9.5f);
        public static readonly Font Tiny = new Font(TextFamily, 8.5f);
        public static readonly Font Strong = new Font(StrongFamily, 10.5f);
        public static readonly Font SmallStrong = new Font(StrongFamily, 9.5f);
        public static readonly Font CardTitle = new Font(StrongFamily, 11f);
        public static readonly Font H1 = new Font(DisplayFamily, 18f);
        public static readonly Font H2 = new Font(DisplayFamily, 13.5f);
        public static readonly Font Hero = new Font(DisplayFamily, 19f);
        public static readonly Font Big = new Font(DisplayFamily, 17f);
        public static readonly Font Huge = new Font(DisplayFamily, 28f);
        public static readonly Font Mono = new Font("Consolas", 9.5f);
        public static readonly Font Glyph = new Font(IconFamily, 12f);
        public static readonly Font GlyphSmall = new Font(IconFamily, 9f);
        public static readonly Font GlyphBig = new Font(IconFamily, 15f);

        public const int CardRadius = 10, ControlRadius = 6;

        static string Pick(string want, string fallback)
        {
            using (var fonts = new InstalledFontCollection())
                foreach (var f in fonts.Families) if (f.Name == want) return want;
            return fallback;
        }

        /// System DPI / 96. The app is system DPI aware (app.manifest); all layout and painting goes through Px.
        public static readonly float Scale = ReadScale();
        static float ReadScale() { using (var g = Graphics.FromHwnd(IntPtr.Zero)) return g.DpiX / 96f; }
        public static int Px(float v) { return (int)Math.Round(v * Scale); }
        public static Rectangle R(int x, int y, int w, int h) { return new Rectangle(Px(x), Px(y), Px(w), Px(h)); }

        /// Pink to coral to orange; angle 0 = left to right, 90 = top to bottom.
        public static LinearGradientBrush Sunset(RectangleF r, float angle)
        {
            var b = new LinearGradientBrush(new RectangleF(r.X, r.Y, Math.Max(1, r.Width), Math.Max(1, r.Height)), Pink, Orange, angle);
            var blend = new ColorBlend();
            blend.Colors = new[] { Pink, Coral, Orange };
            blend.Positions = new[] { 0f, .55f, 1f };
            b.InterpolationColors = blend;
            return b;
        }

        public static Color Mix(Color a, Color b, float t)
        {
            return Color.FromArgb((int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
        }

        /// Window size the backdrop is painted for (96-dpi units): sidebar, title bar and pages share one picture.
        public const int WindowW = 1040, WindowH = 680;

        /// The window background for one part of the window: soft violet at the top fading to near black,
        /// plus the faint bridge outline in the bottom-right corner. `at` = where this part sits in the window.
        public static void PaintBackdrop(Graphics g, Rectangle part, Point at)
        {
            var state = g.Save();
            g.TranslateTransform(-at.X, -at.Y);
            var win = new Rectangle(0, 0, Px(WindowW), Px(WindowH));
            using (var b = new LinearGradientBrush(win, BaseTop, Base, 90f))
            {
                var blend = new ColorBlend();
                blend.Colors = new[] { BaseTop, Base, Color.FromArgb(0x0c, 0x09, 0x11) };
                blend.Positions = new[] { 0f, .4f, 1f };
                b.InterpolationColors = blend;
                g.FillRectangle(b, new Rectangle(part.X + at.X, part.Y + at.Y, part.Width, part.Height));
            }
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var size = Px(460);
            DrawBridgeOutline(g, new RectangleF(win.Right + Px(70) - size, win.Bottom + Px(110) - size, size, size), Color.FromArgb(16, 0xff, 0xb3, 0x8a));
            g.Restore(state);
        }

        /// The outline logo (logo/bridge-night-outline.svg, 64 x 64 units) drawn into r.
        public static void DrawBridgeOutline(Graphics g, RectangleF r, Color color)
        {
            var k = r.Width / 64f;
            Func<float, float, PointF> P = (x, y) => new PointF(r.X + x * k, r.Y + y * k);
            using (var pen = new Pen(color, .9f * k) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
            {
                g.DrawArc(pen, r.X + 17 * k, r.Y + 27 * k, 30 * k, 30 * k, 180, 180);
                foreach (var l in new[] { new[] { 18.5f, 35.4f, 45.5f, 35.4f }, new[] { 17.6f, 39.1f, 46.4f, 39.1f }, new[] { 27f, 24f, 27f, 42f },
                    new[] { 32f, 26f, 32f, 42f }, new[] { 37f, 24f, 37f, 42f }, new[] { 22f, 17f, 22f, 46f }, new[] { 42f, 17f, 42f, 46f },
                    new[] { 0f, 42f, 64f, 42f }, new[] { 15f, 48.5f, 49f, 48.5f }, new[] { 21f, 52.5f, 43f, 52.5f }, new[] { 27f, 56.5f, 37f, 56.5f } })
                    g.DrawLine(pen, P(l[0], l[1]), P(l[2], l[3]));
                // The cables: quadratic curves M2 36 Q16 30 22 18 Q32 34 42 18 Q48 30 62 36, as cubic Beziers.
                Action<float, float, float, float, float, float> Q = (x0, y0, cx, cy, x1, y1) =>
                    g.DrawBezier(pen, P(x0, y0), P(x0 + (cx - x0) * 2 / 3, y0 + (cy - y0) * 2 / 3), P(x1 + (cx - x1) * 2 / 3, y1 + (cy - y1) * 2 / 3), P(x1, y1));
                Q(2, 36, 16, 30, 22, 18);
                Q(22, 18, 32, 34, 42, 18);
                Q(42, 18, 48, 30, 62, 36);
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

        /* ---------------------------------------------------------------- logo pictures (embedded by build.ps1) */

        static readonly Dictionary<int, Bitmap> logos = new Dictionary<int, Bitmap>();

        static Stream Resource(string name) { return Assembly.GetExecutingAssembly().GetManifestResourceStream(name); }

        /// The logo at `size` device pixels, scaled from the nearest bigger PNG; cached.
        public static Bitmap Logo(int size)
        {
            Bitmap b;
            if (logos.TryGetValue(size, out b)) return b;
            var src = size <= 32 ? 32 : size <= 64 ? 64 : size <= 128 ? 128 : 256;
            b = new Bitmap(size, size, PixelFormat.Format32bppPArgb);
            using (var s = Resource("logo-" + src + ".png"))
            using (var g = Graphics.FromImage(b))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                if (s != null) using (var img = Image.FromStream(s)) g.DrawImage(img, new Rectangle(0, 0, size, size));
                else using (var br = Sunset(new RectangleF(0, 0, size, size), 45f)) g.FillRectangle(br, 0, 0, size, size);
            }
            logos[size] = b;
            return b;
        }

        public static void DrawLogo(Graphics g, Rectangle r) { g.DrawImage(Logo(r.Width), r.Location); }

        static Icon small, large;
        /// Tray size (16 px at 100 %) and window size (32 px), from app.ico; made once.
        public static Icon SmallIcon { get { return small ?? (small = AppIcon(System.Windows.Forms.SystemInformation.SmallIconSize.Width)); } }
        public static Icon LargeIcon { get { return large ?? (large = AppIcon(System.Windows.Forms.SystemInformation.IconSize.Width)); } }

        static Icon AppIcon(int size)
        {
            using (var s = Resource("app.ico"))
            {
                if (s != null) return new Icon(s, size, size);
            }
            using (var b = Logo(size).Clone() as Bitmap) return Icon.FromHandle(b.GetHicon());
        }
    }
}
