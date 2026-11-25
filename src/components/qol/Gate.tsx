import { useState, type ReactNode } from "react";
import { Clock, LogIn, LogOut, RefreshCw, ShieldX } from "lucide-react";
import { useAuth } from "../../data/context";
import { Logo, Skeleton, useToast } from "../ui";

/** All that people see who aren't approved members: log in, wait, or no access. */
export function Gate() {
  const { access, user, signIn, signOut, canLogin } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const login = async () => {
    setBusy(true);
    try {
      await signIn(); // the browser now goes to Discord
    } catch {
      toast("Could not start the Discord login. Try again.", { err: true });
      setBusy(false);
    }
    if (!canLogin) setBusy(false); // local preview: nothing to redirect to
  };
  const logout = async () => {
    try {
      await signOut();
    } catch {
      toast("Could not log out. Try again.", { err: true });
    }
  };

  if (access === "loading")
    return (
      <div role="status" aria-busy="true" aria-label="Loading">
        <Skeleton h={260} />
      </div>
    );

  const out = (
    <button className="btn ghost" type="button" onClick={() => void logout()}>
      <LogOut aria-hidden />
      Log out
    </button>
  );
  const card = (icon: ReactNode, title: string, text: ReactNode, acts: ReactNode, note?: string) => (
    <section className="qol-gate">
      <div className="panel">
        <div className="qol-login-logo">{icon}</div>
        <h1>{title}</h1>
        <p className="sub" role="status">
          {text}
        </p>
        <div className="qol-login-acts">{acts}</div>
        {note && <p className="note">{note}</p>}
      </div>
    </section>
  );

  switch (access) {
    case "pending":
      return card(
        <Clock aria-hidden />,
        "Waiting for approval",
        <>Hi {user?.name}! An admin needs to let you in. This page opens by itself when they do.</>,
        out,
      );
    case "blocked":
      return card(<ShieldX aria-hidden />, "No access", "This account can't see Bridge Night. Ask an admin if you think that's wrong.", out);
    case "error":
      return card(
        <RefreshCw aria-hidden />,
        "Something went wrong",
        "Could not check whether you're a member. Check your connection and try again.",
        <>
          <button className="btn pri" type="button" onClick={() => window.location.reload()}>
            <RefreshCw aria-hidden />
            Try again
          </button>
          {out}
        </>,
      );
    default:
      return card(
        <Logo size={44} />,
        "Welcome to Bridge Night",
        "This site is private. Log in with Discord to get in.",
        <button className="btn pri" type="button" onClick={() => void login()} disabled={busy} aria-busy={busy}>
          <LogIn aria-hidden />
          {busy ? "Opening Discord…" : "Log in with Discord"}
        </button>,
        "New here? After your first login an admin approves you.",
      );
  }
}
