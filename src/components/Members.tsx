import { useCallback, useEffect, useState } from "react";
import { Check, Shield, UserMinus, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../data/context";
import { useConfirm, useToast } from "./ui";

interface MemberRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  role: "pending" | "member" | "admin";
  created_at: string;
}

/** Admin only: approve people who logged in, remove members, make admins. */
export function MembersPanel() {
  const sb = supabase;
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!sb) return;
    const { data, error } = await sb.from("members").select("user_id,display_name,avatar_url,role,created_at").order("created_at");
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
    if (error) toast("Could not change that. Try again.", { err: true });
    else toast(msg);
    void load();
  };
  const remove = async (m: MemberRow, pending: boolean) => {
    const ok = await confirm({
      title: pending ? `Decline ${m.display_name}?` : `Remove ${m.display_name}?`,
      text: pending
        ? "They won't be able to make changes. If they log in again, they show up here again."
        : "They can still view the site, but can't change anything anymore.",
      yes: pending ? "Decline" : "Remove",
    });
    if (!ok) return;
    const { error } = await sb.from("members").delete().eq("user_id", m.user_id);
    if (error) toast("Could not remove them. Try again.", { err: true });
    else toast(pending ? `${m.display_name} declined` : `${m.display_name} removed`);
    void load();
  };

  const pending = rows?.filter((r) => r.role === "pending") ?? [];
  const members = rows?.filter((r) => r.role !== "pending") ?? [];

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
        Friends log in with Discord on this site. They show up here as waiting, and you approve them. Only members can change data.
      </p>
      {failed && <p className="note">Could not load the members.</p>}
      {rows === null && !failed && <p className="sub">Loading…</p>}
      {pending.length > 0 && (
        <div>
          <h4>Waiting for approval</h4>
          {pending.map((m) => (
            <div className="prow" key={m.user_id} style={{ gridTemplateColumns: "auto 1fr auto auto" }}>
              {face(m)}
              <b>{m.display_name || "Unknown"}</b>
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
          <div className="prow" key={m.user_id} style={{ gridTemplateColumns: "auto 1fr auto auto" }}>
            {face(m)}
            <span>
              <b>{m.display_name || "Unknown"}</b> {m.role === "admin" && <span className="sub">· admin</span>}
              {me && <span className="sub"> · you</span>}
            </span>
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
    </section>
  );
}
