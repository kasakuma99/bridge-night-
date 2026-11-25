import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw, WifiOff, X } from "lucide-react";
import { useToast } from "../ui";
import { entryScript } from "./logic";

const onNetChange = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/** A calm strip while the device is offline, and a "Back online" toast when it returns. */
export function OfflineBanner() {
  const online = useSyncExternalStore(onNetChange, () => navigator.onLine, () => true);
  const toast = useToast();
  const was = useRef(online);
  useEffect(() => {
    if (online && !was.current) toast("Back online");
    was.current = online;
  }, [online, toast]);
  if (online) return null;
  return (
    <p className="qol-offline" role="status">
      <WifiOff aria-hidden />
      You're offline. What you see may be out of date, and changes won't save until you're back online.
    </p>
  );
}

/** Live site only: when a newer version was deployed, offer a reload (checked every 10 minutes and when the tab comes back). */
export function UpdateNotice() {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const mine = document.querySelector('script[type="module"][src]')?.getAttribute("src");
    if (!mine) return;
    let busy = false;
    let found = false;
    const check = async () => {
      if (found || busy || document.visibilityState !== "visible" || !navigator.onLine) return;
      busy = true;
      try {
        const r = await fetch("/", { cache: "no-store" });
        const now = r.ok ? entryScript(await r.text()) : null;
        if (now && now !== mine) {
          found = true;
          setFresh(true);
        }
      } catch {
        /* offline or blocked: try again later */
      } finally {
        busy = false;
      }
    };
    const t = setInterval(() => void check(), 10 * 60_000);
    const vis = () => void check();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
  if (!fresh) return null;
  return (
    <div className="qol-update" role="status">
      <RefreshCw aria-hidden />
      <span>A new version of Bridge Night is out.</span>
      <button className="btn sm pri" type="button" onClick={() => location.reload()}>
        Reload
      </button>
      <button className="icon" type="button" aria-label="Not now" onClick={() => setFresh(false)}>
        <X aria-hidden />
      </button>
    </div>
  );
}
