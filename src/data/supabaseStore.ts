import type { PostgrestError, RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { AppData, DodgeEntry, EndReason, FeedPlayer, LiveFeed, LiveGame, Match, ParticipantStats, Player, Settings, Side, TeamSize } from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";
import { type DataStore, type StoreState, StoreError, validName } from "./store";

/* Rows as they come from the database. */
interface PlayerRow { id: string; name: string; active: boolean; created_at: string }
interface RiotRow { player_id: string; riot_id: string }
interface MatchRow {
  id: string; played_at: string; mode: number; winner: Side; sit_out: string[]; challenge: string | null;
  duration_min: number | null; game_id: string | null; live_id: string | null; surrender: "ff" | "early" | null;
  end_reason: EndReason | null; duration_sec: number | null; guests: FeedPlayer[] | null; game_mode: string | null; map: string | null;
}
interface PartRow {
  match_id: string; player_id: string; team: Side; slot: number; champion: string | null; kills: number | null;
  deaths: number | null; assists: number | null; items: number[] | null; damage: number | null;
  level: number | null; spells: number[] | null; augments: number[] | null;
}
interface DodgeRow { match_id: string; player_id: string | null; side: Side; champion: string; at: string }
interface SettingsRow {
  dodge_hours: number | string; dodges_per_team: number; reroll_limit: number; challenges_enabled: boolean; discord_url: string;
  save_live_games: boolean;
}

const ms = (t: string) => new Date(t).getTime();
const PAGE = 1000;

/** Readable messages for database errors. */
function friendly(e: PostgrestError | Error, fallback: string): StoreError {
  const pe = e as PostgrestError;
  if (pe.code === "42501" && /admins/i.test(pe.message)) return new StoreError(pe.message);
  if (pe.code === "42501") return new StoreError("Only members of our group can do that. Log in first.");
  if (pe.code === "23505") {
    if (/riot/i.test(pe.message + (pe.details ?? ""))) return new StoreError("That Riot ID is already used by another player");
    if (/name/i.test(pe.message + (pe.details ?? ""))) return new StoreError("That name is already on the list");
  }
  if (pe.code === "P0001" && pe.message) return new StoreError(pe.message);
  if (/fetch|network/i.test(e.message)) return new StoreError("No connection. Check your internet and try again.");
  return new StoreError(fallback);
}

export class SupabaseStore implements DataStore {
  readonly sample = false;
  private state: StoreState = {
    status: "loading",
    data: { players: [], matches: [], live: null, settings: { ...DEFAULT_SETTINGS } },
  };
  private subs = new Set<() => void>();
  private channel: RealtimeChannel | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private loading: Promise<void> | null = null;
  private again = false;
  /** live game writes are queued so they reach the database in order */
  private liveQueue: Promise<unknown> = Promise.resolve();
  private pendingLive = 0;
  private allowed = false;

  constructor(private sb: SupabaseClient) {
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && this.soon());
    // Riot IDs become visible / hidden when someone logs in or out.
    sb.auth.onAuthStateChange((ev) => {
      if (ev === "SIGNED_IN" || ev === "SIGNED_OUT" || ev === "USER_UPDATED") this.soon(0);
    });
  }

  setAccess(allowed: boolean) {
    if (allowed === this.allowed) return;
    this.allowed = allowed;
    if (this.channel) void this.sb.removeChannel(this.channel);
    this.channel = null;
    if (!allowed) {
      clearTimeout(this.timer);
      this.set({ status: "loading", data: { players: [], matches: [], live: null, settings: { ...DEFAULT_SETTINGS } } });
      return;
    }
    void this.refresh();
    this.channel = this.sb
      .channel("bn-data")
      .on("postgres_changes", { event: "*", schema: "public" }, (p) => {
        // The live game changes every few seconds: take it as it comes instead of loading everything again.
        if (p.table === "live_feed") this.showFeed(p.eventType === "DELETE" ? null : ((p.new as { data?: LiveFeed }).data ?? null));
        else this.soon();
      })
      .subscribe((s) => {
        // After a reconnect, catch up on anything we missed.
        if (s === "SUBSCRIBED" && this.state.status === "ready") this.soon();
      });
  }

  private showFeed(feed: LiveFeed | null) {
    if (!this.allowed || this.state.status !== "ready") return;
    const was = this.state.data.feed;
    this.set({ ...this.state, data: { ...this.state.data, feed } });
    // A game was just saved: Past games and Stats need it.
    if (feed?.savedAs && feed.savedAs !== was?.savedAs) this.soon();
  }

  private set(s: StoreState) {
    this.state = s;
    this.subs.forEach((f) => f());
  }
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  getState = () => this.state;

  private soon(delay = 150) {
    if (!this.allowed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  private async all<T>(table: string, select: string, order: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb.from(table).select(select).order(order).range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE) return out;
    }
  }

  /** Loads everything. Ratings, streaks etc. are calculated from this by the site. */
  refresh(): Promise<void> {
    if (!this.allowed) return Promise.resolve();
    if (this.loading) {
      this.again = true;
      return this.loading;
    }
    this.loading = (async () => {
      try {
        const [players, riot, matches, parts, dodges, live, settings, feed] = await Promise.all([
          this.all<PlayerRow>("players", "id,name,active,created_at", "created_at"),
          // Riot IDs are members-only: visitors are refused (on purpose), so treat that as "no Riot IDs".
          this.all<RiotRow>("player_riot_ids", "player_id,riot_id", "player_id").catch(() => [] as RiotRow[]),
          this.all<MatchRow>("matches", "id,played_at,mode,winner,sit_out,challenge,duration_min,game_id,live_id,surrender,end_reason,duration_sec,guests,game_mode,map", "played_at"),
          this.all<PartRow>("match_participants", "match_id,player_id,team,slot,champion,kills,deaths,assists,items,damage,level,spells,augments", "match_id"),
          this.all<DodgeRow>("dodge_log", "match_id,player_id,side,champion,at", "at"),
          this.sb.from("live_game").select("data").maybeSingle(),
          this.sb.from("settings").select("*").eq("id", 1).maybeSingle(),
          this.sb.from("live_feed").select("data").maybeSingle(),
        ]);
        if (live.error) throw live.error;
        if (settings.error) throw settings.error;
        if (feed.error) throw feed.error;
        const conf = settings.data as SettingsRow | null;
        // Until the release, games from League only count as a test.
        const tests = conf?.save_live_games === false ? await this.all<{ data: Match }>("test_games", "data", "created_at") : [];
        if (!this.allowed) return;
        const data = this.build(players, riot, matches, parts, dodges, live.data?.data ?? null, conf);
        const known = new Set(data.matches.map((m) => m.gameId));
        for (const t of tests) if (!known.has(t.data.gameId)) data.matches.push(t.data);
        // A newer look at the live game may have arrived while this was loading.
        const now = this.state.data.feed;
        const got = (feed.data?.data ?? null) as LiveFeed | null;
        data.feed = now && got && now.id === got.id && now.updatedAt > got.updatedAt ? now : got;
        // Don't let a refresh overwrite a live-game change that is still on its way to the database.
        if (this.pendingLive) data.live = this.state.data.live;
        this.set({ status: "ready", data });
      } catch (e) {
        console.error("[bridge-night] loading data failed", e);
        if (this.allowed && this.state.status !== "ready")
          this.set({ ...this.state, status: "error", error: "Could not load the data. Check your connection and reload." });
      } finally {
        this.loading = null;
        if (this.again) {
          this.again = false;
          this.soon(0);
        }
      }
    })();
    return this.loading;
  }

  private build(
    players: PlayerRow[], riot: RiotRow[], matches: MatchRow[], parts: PartRow[], dodges: DodgeRow[],
    live: LiveGame | null, s: SettingsRow | null,
  ): AppData {
    const riotBy = new Map(riot.map((r) => [r.player_id, r.riot_id]));
    const partsBy = new Map<string, PartRow[]>();
    for (const p of parts) (partsBy.get(p.match_id) ?? partsBy.set(p.match_id, []).get(p.match_id)!).push(p);
    const dodgesBy = new Map<string, DodgeEntry[]>();
    for (const d of dodges)
      (dodgesBy.get(d.match_id) ?? dodgesBy.set(d.match_id, []).get(d.match_id)!).push({
        playerId: d.player_id ?? "", champion: d.champion, side: d.side, at: ms(d.at),
      });
    return {
      players: players.map<Player>((p) => ({
        id: p.id, name: p.name, active: p.active, createdAt: ms(p.created_at),
        ...(riotBy.has(p.id) ? { riotId: riotBy.get(p.id) } : {}),
      })),
      matches: matches.map<Match>((m) => {
        const ps = (partsBy.get(m.id) ?? []).sort((a, b) => a.slot - b.slot);
        const stats: Record<string, ParticipantStats> = {};
        for (const p of ps) {
          const st: ParticipantStats = {};
          if (p.champion) st.champion = p.champion;
          if (p.kills != null) st.kills = p.kills;
          if (p.deaths != null) st.deaths = p.deaths;
          if (p.assists != null) st.assists = p.assists;
          if (p.items) st.items = p.items;
          if (p.damage != null) st.damage = p.damage;
          if (p.level != null) st.level = p.level;
          if (p.spells) st.spells = p.spells;
          if (p.augments) st.augments = p.augments;
          stats[p.player_id] = st;
        }
        return {
          id: m.id,
          playedAt: ms(m.played_at),
          mode: m.mode as TeamSize,
          blue: ps.filter((p) => p.team === "blue").map((p) => p.player_id),
          red: ps.filter((p) => p.team === "red").map((p) => p.player_id),
          winner: m.winner,
          stats,
          dodges: dodgesBy.get(m.id) ?? [],
          sitOut: m.sit_out ?? [],
          ...(m.challenge ? { challenge: m.challenge } : {}),
          ...(m.duration_min ? { durationMin: m.duration_min } : {}),
          ...(m.game_id ? { gameId: m.game_id } : {}),
          ...(m.live_id ? { liveId: m.live_id } : {}),
          ...(m.surrender ? { surrender: m.surrender } : {}),
          ...(m.end_reason ? { end: m.end_reason } : {}),
          ...(m.duration_sec ? { durationSec: m.duration_sec } : {}),
          ...(m.guests?.length ? { guests: m.guests } : {}),
          ...(m.game_mode ? { gameMode: m.game_mode } : {}),
          ...(m.map ? { map: m.map } : {}),
        };
      }),
      live,
      settings: s
        ? {
            dodgeHours: Number(s.dodge_hours),
            dodgesPerTeam: s.dodges_per_team,
            rerollLimit: s.reroll_limit,
            challengesEnabled: s.challenges_enabled,
            discordUrl: s.discord_url,
          }
        : { ...DEFAULT_SETTINGS },
    };
  }

  /* ---------- writes ---------- */

  private async run<T>(p: PromiseLike<{ data: T; error: PostgrestError | null }>, fallback: string): Promise<T> {
    let res: { data: T; error: PostgrestError | null };
    try {
      res = await p;
    } catch (e) {
      throw friendly(e as Error, fallback);
    }
    if (res.error) {
      console.error("[bridge-night]", fallback, res.error);
      throw friendly(res.error, fallback);
    }
    return res.data;
  }

  private async setRiot(playerId: string, riotId: string | undefined) {
    const r = riotId?.trim();
    if (r && !/^[^#]{1,40}#[^#]{1,10}$/.test(r)) throw new StoreError("A Riot ID looks like Name#TAG");
    if (r) await this.run(this.sb.from("player_riot_ids").upsert({ player_id: playerId, riot_id: r }), "Could not save the Riot ID");
    else await this.run(this.sb.from("player_riot_ids").delete().eq("player_id", playerId), "Could not remove the Riot ID");
  }

  async addPlayer(name: string, riotId?: string) {
    const n = validName(name, this.state.data.players);
    const row = await this.run(
      this.sb.from("players").insert({ name: n }).select("id,name,active,created_at").single(),
      "Could not add the player",
    );
    const p = row as PlayerRow;
    if (riotId?.trim()) await this.setRiot(p.id, riotId);
    await this.refresh();
    return { id: p.id, name: p.name, active: p.active, createdAt: ms(p.created_at), riotId: riotId?.trim() || undefined };
  }

  async updatePlayer(id: string, patch: Partial<Pick<Player, "name" | "riotId">>) {
    if (patch.name != null) {
      const name = validName(patch.name, this.state.data.players, id);
      await this.run(this.sb.from("players").update({ name }).eq("id", id), "Could not rename the player");
    }
    if (patch.riotId != null) await this.setRiot(id, patch.riotId);
    await this.refresh();
  }

  async removePlayer(id: string) {
    await this.run(this.sb.from("players").update({ active: false }).eq("id", id), "Could not remove the player");
    const L = this.state.data.live;
    if (L && [...L.blue, ...L.red, ...(L.captains?.pool ?? [])].includes(id)) await this.setLive(null);
    await this.refresh();
  }

  async saveSettings(s: Settings) {
    await this.run(
      this.sb
        .from("settings")
        .update({
          dodge_hours: s.dodgeHours,
          dodges_per_team: s.dodgesPerTeam,
          reroll_limit: s.rerollLimit,
          challenges_enabled: s.challengesEnabled,
          discord_url: s.discordUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1),
      "Could not save the settings",
    );
    await this.refresh();
  }

  /** Shows the change at once (drafting feels instant), then saves it in order. */
  setLive(live: LiveGame | null) {
    const before = this.state.data.live;
    this.set({ ...this.state, data: { ...this.state.data, live } });
    this.pendingLive++;
    const job = this.liveQueue.then(async () => {
      try {
        await this.run(this.sb.rpc("set_live", { p_data: live }), "Could not update the live game");
      } catch (e) {
        if (this.pendingLive === 1) this.set({ ...this.state, data: { ...this.state.data, live: before } });
        throw e;
      } finally {
        this.pendingLive--;
        if (!this.pendingLive) this.soon();
      }
    });
    this.liveQueue = job.catch(() => {});
    return job;
  }

  // Only the helper app sends the live game, through the "live" function.
  async setFeed() {
    throw new StoreError("The live game comes from the helper app");
  }

  async decideFeed(feedId: string, choice: Side | "skip") {
    const { error } = await this.sb.functions.invoke("live", { body: { type: "decide", feedId, choice } });
    if (error) {
      const res = (error as { context?: unknown }).context;
      const body = res instanceof Response ? ((await res.json().catch(() => null)) as { note?: string } | null) : null;
      throw res instanceof Response && body?.note && res.status < 500 ? new StoreError(body.note) : friendly(error as Error, "Could not save the result");
    }
    await this.refresh();
  }

  /** Games from before the release are only tests: they can't be changed, and go away then. */
  private real(matchId: string) {
    if (/^g/.test(matchId)) throw new StoreError("This is a test game. Test games disappear at the release.");
  }

  async saveResult(liveId: string, winner: Side) {
    await this.liveQueue; // make sure the last picks / K/D/A reached the database first
    const id = (await this.run(this.sb.rpc("save_live_result", { p_live_id: liveId, p_winner: winner }), "Could not save the result")) as
      | string
      | null;
    await this.refresh();
    if (!id) return null;
    return this.state.data.matches.find((m) => m.id === id) ?? null;
  }

  async flipWinner(matchId: string) {
    this.real(matchId);
    const m = this.state.data.matches.find((x) => x.id === matchId);
    if (!m) return;
    await this.run(
      this.sb.from("matches").update({ winner: m.winner === "blue" ? "red" : "blue" }).eq("id", matchId),
      "Could not change the winner",
    );
    await this.refresh();
  }

  async deleteMatch(matchId: string) {
    this.real(matchId);
    await this.run(this.sb.from("matches").delete().eq("id", matchId), "Could not delete the game");
    await this.refresh();
  }

  exportBackup() {
    const { players, matches, settings } = this.state.data;
    return JSON.stringify({ app: "bridge-night", version: 1, exportedAt: new Date().toISOString(), players, matches, settings }, null, 2);
  }

  async restoreBackup(json: string) {
    let d: unknown;
    try {
      d = JSON.parse(json);
    } catch {
      throw new StoreError("That file isn't valid JSON");
    }
    const b = d as { app?: string; players?: unknown; matches?: unknown };
    if (b?.app !== "bridge-night" || !Array.isArray(b.players) || !Array.isArray(b.matches))
      throw new StoreError("That file isn't a Bridge Night backup");
    await this.run(this.sb.rpc("restore_backup", { p: d }), "Could not restore the backup");
    await this.refresh();
  }

  async resetSample() {
    throw new StoreError("Sample data is only for local development");
  }

  dispose() {
    if (this.channel) void this.sb.removeChannel(this.channel);
  }
}
