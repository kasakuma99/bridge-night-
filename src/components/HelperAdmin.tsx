import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Trash2, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth, useData } from "../data/context";
import { useConfirm, useToast } from "./ui";

/* ---------------------------------------------------------------- helper tokens (admin) */

interface TokenRow {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const when = (t: string | null) => (t ? new Date(t).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : "never");

/** Members see and make their own tokens; admins see everyone's and the review switch. */
export function HelperTokensPanel() {
  const sb = supabase;
  const { isAdmin, user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [review, setReview] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    if (!sb) return;
    const [t, s] = await Promise.all([
      sb.from("helper_tokens").select("id,name,created_at,last_used_at,revoked_at").order("created_at", { ascending: false }),
      sb.from("settings").select("review_helper_results").eq("id", 1).maybeSingle(),
    ]);
    if (!t.error) setRows(t.data as TokenRow[]);
    if (!s.error && s.data) setReview(s.data.review_helper_results as boolean);
  }, [sb]);
  useEffect(() => void load(), [load]);

  if (!sb) return null;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim() || `${user?.name ?? "My"}'s PC`;
    const { data: tok, error } = await sb.rpc("create_helper_token", { p_name: n });
    if (error || typeof tok !== "string") {
      toast(error?.code === "P0001" && error.message ? error.message : "Could not create the token. Try again.", { err: true });
      return;
    }
    setFresh({ name: n, token: tok });
    setName("");
    void load();
  };
  const revoke = async (r: TokenRow) => {
    if (!(await confirm({ title: `Revoke "${r.name}"?`, text: "That helper stops working right away. You can make a new token any time.", yes: "Revoke" })))
      return;
    const { error } = await sb.from("helper_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", r.id);
    toast(error ? "Could not revoke it. Try again." : `"${r.name}" revoked`, error ? { err: true } : undefined);
    void load();
  };
  const toggleReview = async (v: boolean) => {
    setReview(v);
    const { error } = await sb.from("settings").update({ review_helper_results: v }).eq("id", 1);
    if (error) {
      toast("Could not save that. Try again.", { err: true });
      void load();
    }
  };

  const activeRows = rows?.filter((r) => !r.revoked_at) ?? [];

  return (
    <section className="panel" aria-labelledby="ht-h">
      <h3 id="ht-h">{isAdmin ? "Helper tokens" : "Your helper token"}</h3>
      <p className="sub">
        {isAdmin
          ? "Everyone's helper tokens. Members make their own on the Helper page; you can revoke any of them here."
          : "The helper app needs a token to send results. Make one, paste it into the helper, done."}{" "}
        A token is shown only once.
      </p>
      {fresh && (
        <div className="panel" role="status" style={{ background: "var(--color-s2)" }}>
          <p>
            <b>Token for {fresh.name}</b> (copy it now, it won't be shown again):
          </p>
          <p>
            <code style={{ wordBreak: "break-all", fontFamily: "inherit" }}>{fresh.token}</code>
          </p>
          <div className="addf">
            <button
              className="btn sm pri"
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(fresh.token).then(
                  () => toast("Token copied"),
                  () => toast("Could not copy. Select it and press Ctrl+C.", { err: true }),
                )
              }
            >
              <Copy aria-hidden /> Copy token
            </button>
            <button className="btn sm ghost" type="button" onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      {activeRows.map((r) => (
        <div className="prow" key={r.id} style={{ gridTemplateColumns: "auto 1fr auto" }}>
          <KeyRound aria-hidden />
          <span>
            <b>{r.name}</b> <span className="sub">· last used {when(r.last_used_at)}</span>
          </span>
          <button className="btn sm ghost" type="button" aria-label={`Revoke ${r.name}`} onClick={() => void revoke(r)}>
            <Trash2 aria-hidden />
          </button>
        </div>
      ))}
      {rows && !activeRows.length && <p className="sub">No helper tokens yet.</p>}
      <form className="addf" onSubmit={create}>
        <input
          className="f"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`Name, e.g. ${user?.name ?? "My"}'s PC`}
          aria-label="Token name"
          maxLength={40}
        />
        <button className="btn pri" type="submit">
          <KeyRound aria-hidden /> Make a token
        </button>
      </form>
      {isAdmin && review !== null && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <input type="checkbox" checked={review} onChange={(e) => void toggleReview(e.target.checked)} />
          <span>Check helper results before they count (a member confirms each one)</span>
        </label>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- pending results (members) */

interface PendingRow {
  id: string;
  game_id: string;
  created_at: string;
  payload: {
    durationSec?: number;
    players: { playerId: string; side: "blue" | "red"; win: boolean; champion?: string; kills?: number; deaths?: number; assists?: number }[];
  };
}

export function PendingResults() {
  const sb = supabase;
  const { isMember } = useAuth();
  const { pname, store } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<PendingRow[]>([]);

  const load = useCallback(async () => {
    if (!sb || !isMember) return;
    const { data, error } = await sb.from("pending_results").select("id,game_id,created_at,payload").order("created_at");
    if (!error) setRows(data as PendingRow[]);
  }, [sb, isMember]);

  useEffect(() => {
    if (!sb || !isMember) return;
    void load();
    const ch = sb
      .channel("bn-pending")
      .on("postgres_changes", { event: "*", schema: "public", table: "pending_results" }, () => void load())
      .subscribe();
    const t = setInterval(() => void load(), 30_000);
    return () => {
      clearInterval(t);
      void sb.removeChannel(ch);
    };
  }, [sb, isMember, load]);

  if (!sb || !isMember || !rows.length) return null;

  const accept = async (r: PendingRow) => {
    const { data, error } = await sb.rpc("confirm_pending_result", { p_id: r.id });
    if (error) toast("Could not save that result. Try again.", { err: true });
    else toast(data ? "Result saved to the history" : "That game was already saved");
    void load();
    if ("refresh" in store) void (store as { refresh: () => Promise<void> }).refresh();
  };
  const discard = async (r: PendingRow) => {
    if (!(await confirm({ title: "Discard this result?", text: "It won't count. Nothing else changes.", yes: "Discard" }))) return;
    const { error } = await sb.from("pending_results").delete().eq("id", r.id);
    toast(error ? "Could not discard it. Try again." : "Result discarded", error ? { err: true } : undefined);
    void load();
  };

  return (
    <section className="panel" aria-labelledby="pr-h" style={{ marginBottom: 16 }}>
      <h2 id="pr-h">Pending results</h2>
      <p className="sub">Sent by the helper app. Check them, then confirm or discard.</p>
      {rows.map((r) => {
        const won = r.payload.players.find((p) => p.win)?.side;
        const team = (s: "blue" | "red") =>
          r.payload.players
            .filter((p) => p.side === s)
            .map((p) => `${pname(p.playerId)}${p.champion ? ` (${p.champion}${p.kills != null ? ` ${p.kills}/${p.deaths ?? 0}/${p.assists ?? 0}` : ""})` : ""}`)
            .join(", ");
        return (
          <div key={r.id} className="prow" style={{ gridTemplateColumns: "1fr auto auto", alignItems: "start" }}>
            <div>
              <p>
                <b style={{ color: "var(--color-blue)" }}>Blue{won === "blue" ? " · won" : ""}:</b> {team("blue")}
              </p>
              <p>
                <b style={{ color: "var(--color-red)" }}>Red{won === "red" ? " · won" : ""}:</b> {team("red")}
              </p>
              <p className="sub">
                {when(r.created_at)}
                {r.payload.durationSec ? ` · ${Math.round(r.payload.durationSec / 60)} min` : ""}
              </p>
            </div>
            <button className="btn sm pri" type="button" onClick={() => void accept(r)}>
              <Check aria-hidden /> Confirm
            </button>
            <button className="btn sm ghost" type="button" aria-label="Discard this result" onClick={() => void discard(r)}>
              <X aria-hidden />
            </button>
          </div>
        );
      })}
    </section>
  );
}
