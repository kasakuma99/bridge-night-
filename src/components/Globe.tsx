import { useEffect, useRef } from "react";

/**
 * The spinning globe from the UI kit (lenny-ui-kit/retro.js), with text running around it.
 * Decoration only. Draws one still frame under prefers-reduced-motion.
 */
export function Globe({ text, size = 96 }: { text: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const label = text + "   ";
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    const cx = size / 2;
    const cy = size / 2;
    const R = size * 0.36;

    // fake continents: clusters of points on the sphere
    let seed = 7;
    const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const land: { lat: number; lon: number; c: string }[] = [];
    for (let b = 0; b < 10; b++) {
      const lat0 = (rand() - 0.5) * 2.2;
      const lon0 = rand() * Math.PI * 2;
      for (let p = 0; p < 70; p++)
        land.push({ lat: lat0 + (rand() - 0.5) * 0.7, lon: lon0 + (rand() - 0.5) * 0.9, c: rand() > 0.5 ? "#5f9a3a" : "#d8c48a" });
    }

    const project = (lat: number, lon: number, rot: number) => {
      const l = lon + rot;
      return { x: cx + R * Math.cos(lat) * Math.sin(l), y: cy - R * Math.sin(lat), z: Math.cos(lat) * Math.cos(l) };
    };

    const drawText = (rot: number, front: boolean) => {
      const step = (Math.PI * 2) / label.length;
      // Longer labels get smaller letters so they still fit around the globe.
      ctx.font = `bold ${Math.round(size * 0.17 * Math.min(1, 9 / label.length))}px "Trebuchet MS", Verdana, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < label.length; i++) {
        const a = -i * step + rot * 1.6;
        const z = Math.cos(a);
        if (z > 0 !== front) continue;
        ctx.save();
        ctx.translate(cx + R * 1.18 * Math.sin(a), cy + R * 0.35);
        ctx.scale(z, 1);
        ctx.globalAlpha = front ? 1 : 0.35;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#11143a";
        ctx.strokeText(label[i], 0, 0);
        ctx.fillStyle = "#e9ecf8";
        ctx.fillText(label[i], 0, 0);
        ctx.restore();
      }
    };

    let raf = 0;
    const frame = (t: number) => {
      const rot = t / 4000;
      ctx.clearRect(0, 0, size, size);
      drawText(rot, false);

      const g = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.4, R * 0.1, cx, cy, R);
      g.addColorStop(0, "#3a78c9");
      g.addColorStop(0.7, "#123a7a");
      g.addColorStop(1, "#04112b");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      for (const p of land) {
        const q = project(p.lat, p.lon, rot);
        if (q.z <= 0) continue;
        ctx.globalAlpha = 0.4 + q.z * 0.6;
        ctx.fillStyle = p.c;
        ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1;

      ctx.strokeStyle = "rgba(200, 210, 255, .18)";
      ctx.lineWidth = 0.7;
      for (let m = 0; m < 12; m++) {
        ctx.beginPath();
        let started = false;
        for (let lat = -Math.PI / 2; lat <= Math.PI / 2 + 0.01; lat += Math.PI / 12) {
          const q = project(lat, (m * Math.PI) / 6, rot);
          if (q.z < 0) {
            started = false;
            continue;
          }
          if (started) ctx.lineTo(q.x, q.y);
          else ctx.moveTo(q.x, q.y);
          started = true;
        }
        ctx.stroke();
      }

      const s = ctx.createRadialGradient(cx - R * 0.45, cy - R * 0.5, 0, cx - R * 0.45, cy - R * 0.5, R * 0.6);
      s.addColorStop(0, "rgba(255,255,255,.35)");
      s.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = s;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      drawText(rot, true);
      if (!still) raf = requestAnimationFrame(frame);
    };
    frame(0);
    return () => cancelAnimationFrame(raf);
  }, [text, size]);

  return <canvas ref={ref} className="k-globe" style={{ width: size, height: size }} aria-hidden />;
}
