import { useRef, useState } from "react";
import { Download, Trash2, Upload } from "lucide-react";
import { SAMPLE_MODE, useAuth, useData } from "../data/context";
import { Avatar, useConfirm, useToast } from "../components/ui";
import { MembersPanel } from "../components/Members";
import { HelperTokensPanel } from "../components/HelperAdmin";
import { StoreError } from "../data/store";
import { FEATURES } from "../lib/features";
import type { Player, Settings } from "../lib/types";
import { RIOT_ID_RE, clampInt, isDiscordInvite, plural } from "../lib/util";

/** House rules only show the settings of features that are on. */
const HAS_RULES = FEATURES.dodges || FEATURES.rerollLimit || FEATURES.challenges;

export default function Players() {
  const { data, store, active } = useData();
  const { isMember, isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [riot, setRiot] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const err = (e: unknown, fallback: string) => toast(e instanceof StoreError ? e.message : fallback, { err: true });

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (riot.trim() && !RIOT_ID_RE.test(riot.trim())) return toast("Riot IDs look like Name#TAG", { err: true });
    try {
      const p = await store.addPlayer(name, riot);
      setName("");
      setRiot("");
      toast(`${p.name} added`);
    } catch (e2) {
      err(e2, "Could not add the player");
    }
  };

  const remove = async (p: Player) => {
    if (await confirm({ title: `Remove ${p.name}?`, text: "Their past games stay in the history.", yes: "Remove" })) {
      await store.removePlayer(p.id);
      toast(`${p.name} removed`);
    }
  };

  const download = () => {
    const blob = new Blob([store.exportBackup()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bridge-night-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Backup downloaded");
  };
  const restore = async (f: File) => {
    const text = await f.text();
    const yes = await confirm({
      title: "Restore from this backup?",
      text: "All players, games and settings are replaced with the ones in the file. This can't be undone, so download a backup first.",
      yes: "Restore",
    });
    if (!yes) return;
    try {
      await store.restoreBackup(text);
      toast("Backup restored");
    } catch (e) {
      err(e, "Could not restore the backup");
    }
  };

  return (
    <section>
      <div className="head">
        <div>
          <h1>Players &amp; settings</h1>
          <p className="sub">Anyone can look. Only our group can make changes here, after logging in with Discord.</p>
        </div>
      </div>
      <div className="settings" style={HAS_RULES || isAdmin ? undefined : { gridTemplateColumns: "minmax(0, 1fr)" }}>
        <section className="panel" aria-labelledby="pl-h">
          <div className="ph">
            <h2 id="pl-h">Players</h2>
            <p className="sub">{plural(active.length, "player")}</p>
          </div>
          <div>
            {active.length ? (
              active.map((p) => (isMember ? <PlayerRow key={p.id} p={p} onRemove={() => remove(p)} /> : (
                <div className="prow" key={p.id} style={{ gridTemplateColumns: "auto 1fr" }}>
                  <Avatar id={p.id} />
                  <b>{p.name}</b>
                </div>
              )))
            ) : (
              <p className="sub">No players yet.</p>
            )}
          </div>
          {isAdmin ? (
            <form className="addf" onSubmit={add}>
              <input className="f" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="New player name" required maxLength={20} />
              <input className="f" value={riot} onChange={(e) => setRiot(e.target.value)} placeholder="Riot ID (optional)" aria-label="Riot ID" maxLength={30} />
              <button className="btn pri" type="submit">
                Add player
              </button>
            </form>
          ) : isMember ? (
            <p className="note">Only the admin adds, removes and renames players and sets Riot IDs.</p>
          ) : (
            <p className="note">Riot IDs are only visible to logged-in members.</p>
          )}
        </section>
        <div className="stack2">
          {HAS_RULES && <HouseRules settings={data.settings} disabled={!isMember} />}
          <DiscordBox settings={data.settings} disabled={!isAdmin} />
          {isAdmin && !SAMPLE_MODE && <MembersPanel />}
          {isAdmin && !SAMPLE_MODE && <HelperTokensPanel />}
          {isAdmin && (
            <section className="panel">
              <h3>Backup</h3>
              <p className="sub">Save all players, games and settings as a file, or bring them back from one.</p>
              <div className="addf">
                <button className="btn" type="button" onClick={download}>
                  <Download aria-hidden /> Download backup (JSON)
                </button>
                <button className="btn ghost" type="button" onClick={() => fileRef.current?.click()}>
                  <Upload aria-hidden /> Restore from backup
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void restore(f);
                  }}
                />
              </div>
            </section>
          )}
          {SAMPLE_MODE && isAdmin && (
            <section className="panel">
              <h3>Sample data</h3>
              <p className="sub">Local development only. Bring back the sample players and games.</p>
              <div className="addf">
                <button
                  className="btn ghost"
                  type="button"
                  onClick={async () => {
                    if (await confirm({ title: "Reset sample data?", text: "Your changes are replaced with the sample players and games.", yes: "Reset" })) {
                      await store.resetSample();
                      toast("Sample data restored");
                    }
                  }}
                >
                  Reset sample data
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}

function PlayerRow({ p, onRemove }: { p: Player; onRemove: () => void }) {
  const { store } = useData();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(p.name);
  const [riot, setRiot] = useState(p.riotId ?? "");
  const badRiot = !!riot.trim() && !RIOT_ID_RE.test(riot.trim());
  const saveName = async () => {
    if (name.trim() === p.name) return;
    try {
      await store.updatePlayer(p.id, { name });
      toast("Name saved");
    } catch (e) {
      toast(e instanceof StoreError ? e.message : "Could not save", { err: true });
      setName(p.name);
    }
  };
  const saveRiot = async () => {
    if (riot.trim() === (p.riotId ?? "")) return;
    if (badRiot) return toast("Riot IDs look like Name#TAG", { err: true });
    await store.updatePlayer(p.id, { riotId: riot });
    toast("Riot ID saved");
  };
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && e.currentTarget.blur();
  return (
    <div className="prow">
      <Avatar id={p.id} />
      {isAdmin ? (
        <input className="f" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={enter} aria-label={`Name of ${p.name}`} maxLength={20} />
      ) : (
        <b title="Only admins can rename players" style={{ alignSelf: "center" }}>
          {p.name}
        </b>
      )}
      {isAdmin ? (
        <input
          className="f riot"
          value={riot}
          onChange={(e) => setRiot(e.target.value)}
          onBlur={saveRiot}
          onKeyDown={enter}
          placeholder="Riot ID (Name#TAG)"
          aria-label={`Riot ID of ${p.name}`}
          aria-invalid={badRiot}
          maxLength={30}
        />
      ) : (
        <span className="sub" title="Only admins can change Riot IDs" style={{ alignSelf: "center" }}>
          {p.riotId ?? "No Riot ID yet"}
        </span>
      )}
      {isAdmin ? (
        <button className="icon" type="button" onClick={onRemove} aria-label={`Remove ${p.name}`}>
          <Trash2 aria-hidden />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function HouseRules({ settings, disabled }: { settings: Settings; disabled: boolean }) {
  const { store } = useData();
  const toast = useToast();
  const [h, setH] = useState(String(settings.dodgeHours));
  const [d, setD] = useState(String(settings.dodgesPerTeam));
  const [r, setR] = useState(String(settings.rerollLimit));
  const [fun, setFun] = useState(settings.challengesEnabled);
  return (
    <section className="panel">
      <h3>House rules</h3>
      <p className="sub">
        {FEATURES.dodges &&
          "Dodges: after a long enough break a new night starts, and each side gets this many dodges in champ select for the whole night, from 1v1 to 4v4. "}
        {FEATURES.rerollLimit && "Rerolls: how often you can reroll teams before a game."}
      </p>
      <form
        className="addf"
        onSubmit={async (e) => {
          e.preventDefault();
          const s: Settings = {
            ...settings,
            // Settings of hidden features keep their saved values.
            ...(FEATURES.dodges && { dodgeHours: clampInt(h, 1, 72, 12), dodgesPerTeam: clampInt(d, 0, 5, 2) }),
            ...(FEATURES.rerollLimit && { rerollLimit: clampInt(r, -1, 10, 2) }),
            ...(FEATURES.challenges && { challengesEnabled: fun }),
          };
          await store.saveSettings(s);
          setH(String(s.dodgeHours));
          setD(String(s.dodgesPerTeam));
          toast("House rules saved");
        }}
      >
        <fieldset disabled={disabled} style={{ display: "contents" }}>
          {FEATURES.dodges && (
            <>
              <label>
                Break needed (hours)
                <input className="f" type="number" min={1} max={72} inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} />
              </label>
              <label>
                Dodges per team
                <input className="f" type="number" min={0} max={5} inputMode="numeric" value={d} onChange={(e) => setD(e.target.value)} />
              </label>
            </>
          )}
          {FEATURES.rerollLimit && (
            <label>
              Rerolls per game
              <select className="f" value={r} onChange={(e) => setR(e.target.value)}>
                <option value="-1">No limit</option>
                <option value="0">None</option>
                {[1, 2, 3, 5].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          )}
          {FEATURES.challenges && (
            <label className="chk">
              <input type="checkbox" checked={fun} onChange={(e) => setFun(e.target.checked)} /> Offer a random challenge in champ select
              (like "No Flash")
            </label>
          )}
          <button className="btn" type="submit">
            Save rules
          </button>
        </fieldset>
      </form>
    </section>
  );
}

function DiscordBox({ settings, disabled }: { settings: Settings; disabled: boolean }) {
  const { store } = useData();
  const toast = useToast();
  const [url, setUrl] = useState(settings.discordUrl);
  if (disabled) return null;
  return (
    <section className="panel">
      <h3>Discord</h3>
      <p className="sub">Your server invite. The "Join our Discord" buttons use it.</p>
      <form
        className="addf"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = url.trim();
          if (v && !isDiscordInvite(v)) return toast("That doesn't look like a Discord invite link", { err: true });
          await store.saveSettings({ ...settings, discordUrl: v });
          toast(v ? "Discord link saved" : "Discord link removed");
        }}
      >
        <input className="f" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://discord.gg/..." aria-label="Discord invite link" />
        <button className="btn" type="submit">
          Save link
        </button>
      </form>
    </section>
  );
}
