/** Built-in champion list, used until (or if) Data Dragon can't be reached. */
export const FALLBACK_CHAMPIONS =
  "Aatrox,Ahri,Akali,Akshan,Alistar,Ambessa,Amumu,Anivia,Annie,Aphelios,Ashe,Aurelion Sol,Aurora,Azir,Bard,Bel'Veth,Blitzcrank,Brand,Braum,Briar,Caitlyn,Camille,Cassiopeia,Cho'Gath,Corki,Darius,Diana,Dr. Mundo,Draven,Ekko,Elise,Evelynn,Ezreal,Fiddlesticks,Fiora,Fizz,Galio,Gangplank,Garen,Gnar,Gragas,Graves,Gwen,Hecarim,Heimerdinger,Hwei,Illaoi,Irelia,Ivern,Janna,Jarvan IV,Jax,Jayce,Jhin,Jinx,K'Sante,Kai'Sa,Kalista,Karma,Karthus,Kassadin,Katarina,Kayle,Kayn,Kennen,Kha'Zix,Kindred,Kled,Kog'Maw,LeBlanc,Lee Sin,Leona,Lillia,Lissandra,Lucian,Lulu,Lux,Malphite,Malzahar,Maokai,Master Yi,Mel,Milio,Miss Fortune,Mordekaiser,Morgana,Naafiri,Nami,Nasus,Nautilus,Neeko,Nidalee,Nilah,Nocturne,Nunu & Willump,Olaf,Orianna,Ornn,Pantheon,Poppy,Pyke,Qiyana,Quinn,Rakan,Rammus,Rek'Sai,Rell,Renata Glasc,Renekton,Rengar,Riven,Rumble,Ryze,Samira,Sejuani,Senna,Seraphine,Sett,Shaco,Shen,Shyvana,Singed,Sion,Sivir,Skarner,Smolder,Sona,Soraka,Swain,Sylas,Syndra,Tahm Kench,Taliyah,Talon,Taric,Teemo,Thresh,Tristana,Trundle,Tryndamere,Twisted Fate,Twitch,Udyr,Urgot,Varus,Vayne,Veigar,Vel'Koz,Vex,Vi,Viego,Viktor,Vladimir,Volibear,Warwick,Wukong,Xayah,Xerath,Xin Zhao,Yasuo,Yone,Yorick,Yunara,Yuumi,Zac,Zed,Zeri,Ziggs,Zilean,Zoe,Zyra".split(
    ",",
  );

export interface Champion {
  /** Display name, e.g. "Kai'Sa". This is what we store in matches. */
  name: string;
  /** Data Dragon id, e.g. "Kaisa", "MonkeyKing". */
  id: string;
}

const ID_EXCEPTIONS: Record<string, string> = {
  Wukong: "MonkeyKing",
  "Nunu & Willump": "Nunu",
  "Renata Glasc": "Renata",
  LeBlanc: "Leblanc",
  "Kai'Sa": "Kaisa",
  "Cho'Gath": "Chogath",
  "Kha'Zix": "Khazix",
  "Bel'Veth": "Belveth",
  "Vel'Koz": "Velkoz",
  "Kog'Maw": "KogMaw",
  "Rek'Sai": "RekSai",
  "K'Sante": "KSante",
};

/** Best guess of the Data Dragon id from a display name (only used for the fallback list). */
export const guessId = (name: string) => ID_EXCEPTIONS[name] ?? name.replace(/[^A-Za-z0-9]/g, "");

const NAME_BY_ID = new Map(FALLBACK_CHAMPIONS.map((n) => [guessId(n).toLowerCase(), n]));
/** English display name for a Data Dragon id ("MonkeyKing" -> "Wukong"), whatever language the client uses. */
export const championFromId = (id: string, fallback?: string) => NAME_BY_ID.get(id.toLowerCase()) ?? (fallback || id);

/* Build-site slugs. Both sites use one word for these, not the full name. */
const SHORT: Record<string, string> = { "Nunu & Willump": "nunu", "Renata Glasc": "renata", Wukong: "wukong" };

/** U.GG: lowercase letters only, e.g. "drmundo", "kaisa", "belveth", "missfortune". */
export const uggSlug = (name: string) => SHORT[name] ?? name.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Mobalytics: drop ' . &, spaces become hyphens, e.g. "dr-mundo", "kaisa", "miss-fortune". */
export const mobaSlug = (name: string) =>
  SHORT[name] ?? name.toLowerCase().replace(/['.&]/g, "").trim().replace(/\s+/g, "-");

export const uggUrl = (name: string) => `https://u.gg/lol/champions/aram-mayhem/${uggSlug(name)}-aram-mayhem`;
export const mobaUrl = (name: string) => `https://mobalytics.gg/lol/champions/${mobaSlug(name)}/mayhem-builds`;

/* ---------- Data Dragon ---------- */

const DD = "https://ddragon.leagueoflegends.com";
const CACHE_KEY = "bn-ddragon-v2";
const CACHE_MS = 12 * 36e5;

export interface DDragon {
  version: string | null;
  champions: Champion[];
  items: Record<number, string>;
  /** Summoner spells by number. */
  spells: Record<number, { id: string; name: string }>;
}

export const fallbackDDragon = (): DDragon => ({
  version: null,
  champions: FALLBACK_CHAMPIONS.map((name) => ({ name, id: guessId(name) })),
  items: SAMPLE_ITEM_NAMES,
  spells: {},
});

export const champIcon = (v: string | null, id: string) => (v ? `${DD}/cdn/${v}/img/champion/${id}.png` : null);
export const spellIcon = (v: string | null, id: string) => (v ? `${DD}/cdn/${v}/img/spell/${id}.png` : null);
export const itemIcon = (v: string | null, id: number) => (v ? `${DD}/cdn/${v}/img/item/${id}.png` : null);
/** Full splash art (no version in the path). Data Dragon sends CORS headers, so canvas effects can read it. */
export const champSplash = (id: string, skin = 0) => `${DD}/cdn/img/champion/splash/${id}_${skin}.jpg`;
/** Tall loading-screen art. */
export const champLoading = (id: string, skin = 0) => `${DD}/cdn/img/champion/loading/${id}_${skin}.jpg`;

export async function loadDDragon(signal?: AbortSignal): Promise<DDragon> {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (c && Date.now() - c.at < CACHE_MS && c.data?.version) return c.data;
  } catch {
    /* ignore */
  }
  const versions: string[] = await (await fetch(`${DD}/api/versions.json`, { signal })).json();
  const v = versions[0];
  const [ch, it, sp] = await Promise.all([
    fetch(`${DD}/cdn/${v}/data/en_US/champion.json`, { signal }).then((r) => r.json()),
    fetch(`${DD}/cdn/${v}/data/en_US/item.json`, { signal }).then((r) => r.json()),
    fetch(`${DD}/cdn/${v}/data/en_US/summoner.json`, { signal }).then((r) => r.json()),
  ]);
  const champions: Champion[] = Object.values(ch.data as Record<string, { id: string; name: string }>)
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const items: Record<number, string> = {};
  for (const [id, x] of Object.entries(it.data as Record<string, { name: string }>)) items[+id] = x.name;
  const spells: DDragon["spells"] = {};
  for (const x of Object.values(sp.data as Record<string, { id: string; key: string; name: string }>)) spells[+x.key] = { id: x.id, name: x.name };
  const data: DDragon = { version: v, champions, items, spells };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* storage full: fine */
  }
  return data;
}

/* ---------- augments (Community Dragon: Data Dragon doesn't have them) ---------- */

const CD = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default";
const AUG_KEY = "bn-augments-v1";

export interface Augment {
  name: string;
  icon: string | null;
  rarity: string;
}

export const augmentIconUrl = (path: string) =>
  /^\/lol-game-data\/assets\//i.test(path) ? CD + path.slice("/lol-game-data/assets".length).toLowerCase() : null;

export async function loadAugments(): Promise<Record<number, Augment>> {
  try {
    const c = JSON.parse(localStorage.getItem(AUG_KEY) || "null");
    if (c && Date.now() - c.at < CACHE_MS) return c.data;
  } catch {
    /* ignore */
  }
  const raw: unknown = await (await fetch(`${CD}/v1/cherry-augments.json`)).json();
  const data: Record<number, Augment> = {};
  for (const x of Array.isArray(raw) ? raw : [])
    if (typeof x?.id === "number")
      data[x.id] = {
        name: String(x.nameTRA || x.augmentNameId || `Augment ${x.id}`),
        icon: augmentIconUrl(String(x.augmentSmallIconPath ?? "")),
        rarity: String(x.rarity ?? "").replace(/^k/, "").toLowerCase(),
      };
  try {
    localStorage.setItem(AUG_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* storage full: fine */
  }
  return data;
}

/** Names for the items used in sample data, so they read well even offline. */
export const SAMPLE_ITEM_NAMES: Record<number, string> = {
  3006: "Berserker's Greaves",
  3020: "Sorcerer's Shoes",
  3047: "Plated Steelcaps",
  3111: "Mercury's Treads",
  3031: "Infinity Edge",
  3089: "Rabadon's Deathcap",
  3157: "Zhonya's Hourglass",
  3071: "Black Cleaver",
  3065: "Spirit Visage",
  3068: "Sunfire Aegis",
  3036: "Lord Dominik's Regards",
  3135: "Void Staff",
  3153: "Blade of the Ruined King",
  3046: "Phantom Dancer",
  3742: "Dead Man's Plate",
  3075: "Thornmail",
  3165: "Morellonomicon",
  3116: "Rylai's Crystal Scepter",
  6655: "Luden's Companion",
  3094: "Rapid Firecannon",
};

export const CHALLENGES = [
  "Full AP builds, even on AD champions",
  "Full AD builds, even on mages",
  "No Flash",
  "Tank items only",
  "No boots",
  "Always take the leftmost augment",
  "Trade champions with a teammate before the game",
  "No champion rerolls",
  "Everyone takes Mark (snowball)",
  "No Heal or Barrier",
];
