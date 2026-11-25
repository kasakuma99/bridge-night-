import { useEffect, useRef, useState } from "react";
import { LogIn } from "lucide-react";
import { SAMPLE_MODE, useAuth } from "../../data/context";
import { Logo, useToast } from "../ui";
import { LOGIN_PROMPT_KEY, readAnsweredAt, shouldAskLogin } from "./logic";

// Captured at page load, before Supabase removes the login tokens from the address bar.
const START = { search: location.search, hash: location.hash };

const remember = () => {
  try {
    localStorage.setItem(LOGIN_PROMPT_KEY, String(Date.now()));
  } catch {
    /* private mode: it just asks again next time */
  }
};

/** A friendly "log in or just watch" popup for people who aren't logged in. Asks again after 7 days. */
export function LoginPrompt() {
  const { canLogin, ready, user, signIn } = useAuth();
  const toast = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const decided = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const loggedIn = !!user;

  // Decide once per page load, as soon as we know whether someone is logged in.
  useEffect(() => {
    if (!ready || decided.current) return;
    decided.current = true;
    let answeredAt: number | null = null;
    try {
      answeredAt = readAnsweredAt(localStorage.getItem(LOGIN_PROMPT_KEY));
    } catch {
      /* storage blocked */
    }
    if (shouldAskLogin({ sample: SAMPLE_MODE, canLogin, ready, loggedIn, ...START, answeredAt, now: Date.now() })) setOpen(true);
  }, [ready, canLogin, loggedIn]);

  // Logged in meanwhile (e.g. in another tab): never keep nagging.
  useEffect(() => {
    if (loggedIn && !SAMPLE_MODE) setOpen(false);
  }, [loggedIn]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      primary.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const watch = () => {
    remember();
    setOpen(false);
  };
  const login = async () => {
    remember();
    setBusy(true);
    try {
      await signIn(); // the browser now goes to Discord
      if (!canLogin) setOpen(false); // local preview: nothing to redirect to
    } catch {
      toast("Could not start the Discord login. Try again.", { err: true });
    } finally {
      if (!canLogin) setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="modal qol-login"
      aria-labelledby="lp-t"
      aria-describedby="lp-d"
      onCancel={(e) => {
        e.preventDefault();
        watch();
      }}
      onClose={() => setOpen(false)}
      onClick={(e) => e.target === e.currentTarget && watch()}
    >
      {open && (
        <div className="panel">
          <div className="qol-login-logo">
            <Logo size={44} />
          </div>
          <h2 id="lp-t">Welcome to Bridge Night</h2>
          <p className="sub" id="lp-d">
            Log in with Discord so you can make teams and save results. Just here to watch? No login needed.
          </p>
          <div className="qol-login-acts">
            <button ref={primary} className="btn pri" type="button" onClick={() => void login()} disabled={busy} aria-busy={busy}>
              <LogIn aria-hidden />
              {busy ? "Opening Discord…" : "Log in with Discord"}
            </button>
            <button className="btn ghost" type="button" onClick={watch}>
              Just watching
            </button>
          </div>
          <p className="note">New here? After your first login an admin approves you.</p>
        </div>
      )}
    </dialog>
  );
}
