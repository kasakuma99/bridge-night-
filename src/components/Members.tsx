import { useCallback, useEffect, useState } from "react";
import { Check, Shield, UserCheck, UserMinus, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth, useData } from "../data/context";
import { useConfirm, useToast } from "./ui";

interface MemberRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  role: "pending" | "member" | "admin" | "blocked";
  /** The player of the site this person is. */
  player_id: string | null;
  created_at: string;
}

/** Admin only: approve people who logged in, remove members, make admins. */
export function MembersPanel() {
  const sb = supabase;
  const { user } = useAuth();
  const { active, player } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!sb) return;
    const { data, error } = await sb.from("members").select("user_id,display_name,avatar_url,role,created_at,player_id").order("created_at");
    if (error) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setRows(data as MemberRow[]);
  }, [sb]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (!sb) return null;

  const setRole = async (m: MemberRow, role: MemberRow["role"], msg: string) => {
    const { error } = await sb.from("members").update({ role }).eq("user_id", m.user_id);
    if (error) toast(error.code === "P0001" ? error.message : "Could not change that. Try again.", { err: true });
    else toast(msg);
    void load();
  };
  const link = async (m: MemberRow, id: string) => {
    const { error } = await sb.from("members").update({ player_id: id || null }).eq("user_id", m.user_id);
    if (error) toast(error.code === "23505" ? "That player already belongs to someone else" : "Could not save that. Try again.", { err: true });
    else toast(id ? `${m.display_name} is ${player(id)?.name}` : `${m.display_name} is no player now`);
    void load();
  };
  const remove = async (m: MemberRow, pending: boolean) => {
    const ok = await confirm({
      title: pending ? `Decline ${m.display_name}?` : `Remove ${m.display_name}?`,
      text: pending
        ? "They can't see the site, also when they log in again. You can let them in later."
        : "They can't see the site anymore, also when they log in again. You can let them back in later.",
      yes: pending ? "Decline" : "Remove",
    });
    if (!ok) return;
    await setRole(m, "blocked", pending ? `${m.display_name} declined` : `${m.display_name} removed`);
  };

  const pending = rows?.filter((r) => r.role === "pending") ?? [];
  const blocked = rows?.filter((r) => r.role === "blocked") ?? [];
  const members = rows?.filter((r) => r.role === "member" || r.role === "admin") ?? [];
  const taken = new Set(rows?.map((r) => r.player_id));

  const playerOf = (m: MemberRow) => {
    const own = m.player_id ? player(m.player_id) : undefined;
    const free = active.filter((p) => !taken.has(p.id));
    return (
      <select className="f" aria-label={`Which player is ${m.display_name}?`} value={m.player_id ?? ""} onChange={(e) => void link(m, e.target.value)}>
        <option value="">No player</option>
        {own && <option value={own.id}>{own.name}</option>}
        {free.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    );
  };

  const face = (m: MemberRow) =>
    m.avatar_url ? (
      <img src={m.avatar_url} alt="" width={32} height={32} style={{ borderRadius: 999 }} />
    ) : (
      <span aria-hidden style={{ width: 32, height: 32, borderRadius: 999, background: "var(--color-s3)", display: "inline-block" }} />
    );

  return (
    <section className="panel" aria-labelledby="mem-h">
      <h3 id="mem-h">Members</h3>
      <p className="sub">
        Friends log in with Discord. They show up here as waiting, and you approve them. Only members can see the site. Choose which player each member is.
      </p>
      {failed && <p className="note">Could not load the members.</p>}
      {rows === null && !failed && <p className="sub">Loading…</p>}
      {pending.length > 0 && (
        <div>
          <h4>Waiting for approval</h4>
          {pending.map((m) => (
            <div className="prow mem" key={m.user_id}>
              {face(m)}
              <b>{m.display_name || "Unknown"}</b>
              {playerOf(m)}
              <button className="btn sm pri" type="button" onClick={() => void setRole(m, "member", `${m.display_name} approved`)}>
                <Check aria-hidden /> Approve
              </button>
              <button className="btn sm ghost" type="button" aria-label={`Decline ${m.display_name}`} onClick={() => void remove(m, true)}>
                <X aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
      {members.map((m) => {
        const me = m.user_id === user?.id;
        return (
          <div className="prow mem" key={m.user_id}>
            {face(m)}
            <span>
              <b>{m.display_name || "Unknown"}</b> {m.role === "admin" && <span className="sub">· admin</span>}
              {me && <span className="sub"> · you</span>}
            </span>
            {playerOf(m)}
            {me ? (
              <span />
            ) : m.role === "admin" ? (
              <button className="btn sm ghost" type="button" onClick={() => void setRole(m, "member", `${m.display_name} is a normal member now`)}>
                Make member
              </button>
            ) : (
              <button className="btn sm ghost" type="button" onClick={() => void setRole(m, "admin", `${m.display_name} is an admin now`)}>
                <Shield aria-hidden /> Make admin
              </button>
            )}
            {me ? (
              <span />
            ) : (
              <button className="btn sm ghost" type="button" aria-label={`Remove ${m.display_name}`} onClick={() => void remove(m, false)}>
                <UserMinus aria-hidden />
              </button>
            )}
          </div>
        );
      })}
      {blocked.length > 0 && (
        <details className="blocked">
          <summary>No access ({blocked.length})</summary>
          {blocked.map((m) => (
            <div className="prow" key={m.user_id} style={{ gridTemplateColumns: "auto 1fr auto" }}>
              {face(m)}
              <span>{m.display_name || "Unknown"}</span>
              <button className="btn sm ghost" type="button" onClick={() => void setRole(m, "member", `${m.display_name} is a member now`)}>
                <UserCheck aria-hidden /> Let in
              </button>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
