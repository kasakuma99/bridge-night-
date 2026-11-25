import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, KeyRound, LogIn, LogOut } from "lucide-react";
import { SAMPLE_MODE, useAuth, type AuthUser } from "../../data/context";
import { initials, useToast } from "../ui";

function Face({ user, size }: { user: AuthUser; size: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: size * 0.4 };
  return user.avatar && !broken ? (
    <img className="qol-face" src={user.avatar} alt="" width={size} height={size} style={style} onError={() => setBroken(true)} />
  ) : (
    <span className="qol-face" style={style} aria-hidden>
      {initials(user.name)}
    </span>
  );
}

/** Header: "Log in" for visitors, or your Discord avatar + name with a small menu (status, Log out). */
export function AccountMenu() {
  const { canLogin, ready, user, pending, isAdmin, isMember, signIn, signOut } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  if ((!canLogin && !SAMPLE_MODE) || !ready) return null;
  if (!user)
    return (
      <button
        className="btn sm"
        type="button"
        onClick={() => signIn().catch(() => toast("Could not start the Discord login. Try again.", { err: true }))}
      >
        <LogIn aria-hidden />
        <span>Log in</span>
      </button>
    );

  const status = isAdmin ? "Admin" : isMember ? "Member" : pending ? "Waiting for approval" : "Logged in";
  const logout = async () => {
    setOpen(false);
    try {
      await signOut();
      toast("Logged out");
    } catch {
      toast("Could not log out. Try again.", { err: true });
    }
  };

  return (
    <div className="qol-acct" ref={box}>
      <button
        ref={btn}
        className="btn sm ghost qol-acct-btn"
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Account: ${user.name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Face user={user} size={24} />
        <span className="qol-acct-name">{user.name}</span>
        <ChevronDown aria-hidden className="qol-chev" />
      </button>
      {open && (
        <div className="qol-acct-pop panel" id={id}>
          <div className="qol-acct-who">
            <Face user={user} size={40} />
            <div>
              <b>{user.name}</b>
              <span className="sub">{status}</span>
            </div>
          </div>
          {isMember && (
            <Link className="btn sm ghost" to="/helper" onClick={() => setOpen(false)}>
              <KeyRound aria-hidden /> Helper app &amp; token
            </Link>
          )}
          <button className="btn sm ghost" type="button" onClick={() => void logout()}>
            <LogOut aria-hidden /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
