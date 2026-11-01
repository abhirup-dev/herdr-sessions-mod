// Sessions joined with the window: which spaces and agents each one holds. Pure, so it's tested.
import { COLORS, colorOf, initial, KEY, labelOf } from "../../mods/session-spaces/sessions.js";
import type { LsSpace, Shared } from "./state.ts";

export type Agent = {
  terminal: string;
  pane: string;
  status: string;
  app: string | null;
  name: string | null;
  space: string;
  spaceName: string;
  tab: string;
  tabName: string;
  machine: string | null;
  session: string;
  subAgents: number;
};
export type Space = {
  id: string;
  name: string;
  machine: string | null;
  folder: string;
  active: boolean;
  session: string;
  tabs: { id: string; name: string }[];
  agents: Agent[];
};
export type Session = {
  id: string;
  n: number;
  name: string | null;
  label: string;
  color: string;
  shown: boolean;
  spaces: Space[];
  agents: Agent[];
};
export type Model = {
  sessions: Session[];
  spaces: Space[];
  agents: Agent[];
  filter: "all" | "follow" | string;
  sort: string;
  window: boolean;
};

type State = { list: { id: string; name?: string; color?: string }[]; active: string; of: Record<string, string> };

export function build(shared: Shared, ls: LsSpace[] | null): Model {
  const s = initial(shared[KEY]) as State;
  // A space the mod hasn't seen yet joins the shown session, as the mod will place it.
  const sessionOf = (id: string) => (s.list.some((x) => x.id === s.of[id]) ? s.of[id] : s.active);
  const spaces: Space[] = (ls ?? []).map((w) => {
    const session = sessionOf(w.id);
    const agents = w.tabs.flatMap((t) =>
      t.terminals
        .filter((x) => x.status)
        .map((x) => ({
          terminal: x.terminal,
          pane: x.pane,
          status: x.status as string,
          app: x.app,
          name: x.name,
          space: w.id,
          spaceName: w.name,
          tab: t.id,
          tabName: t.name,
          machine: w.machine,
          session,
          subAgents: x.sub_agents?.length ?? 0,
        })),
    );
    return {
      id: w.id,
      name: w.name,
      machine: w.machine,
      folder: w.folder,
      active: w.active,
      session,
      tabs: w.tabs.map((t) => ({ id: t.id, name: t.name })),
      agents,
    };
  });
  const sessions = s.list.map((x, i) => ({
    id: x.id,
    n: i + 1,
    name: x.name ?? null,
    label: labelOf(s, x.id),
    color: colorOf(s, x.id),
    shown: x.id === s.active,
    spaces: spaces.filter((w) => w.session === x.id),
    agents: spaces.filter((w) => w.session === x.id).flatMap((w) => w.agents),
  }));
  const raw = shared["agents.sessions"] ?? (shared["agents.allSessions"] ? "all" : "follow");
  return {
    sessions,
    spaces,
    agents: spaces.flatMap((w) => w.agents),
    filter: raw as string,
    sort: (shared["agents.sort"] as string) ?? "priority",
    window: ls !== null,
  };
}

// A session by id ("s2"), number ("2") or name (any case); throws with the choices otherwise.
export function findSession(m: Model, ref: string): Session {
  const r = ref.trim().toLowerCase();
  const hit =
    m.sessions.find((x) => x.id === r) ??
    m.sessions.find((x) => String(x.n) === r) ??
    m.sessions.find((x) => x.label.toLowerCase() === r);
  if (hit) return hit;
  throw new Error(`no session "${ref}"; have: ${m.sessions.map((x) => `${x.n} ${x.label}`).join(", ")}`);
}

// Spaces by id or name (any case; "machine/name" for a remote one). A name on several machines
// must be qualified.
export function findSpace(m: Model, ref: string): Space {
  const r = ref.trim().toLowerCase();
  const byId = m.spaces.find((w) => w.id.toLowerCase() === r);
  if (byId) return byId;
  const qualified = (w: Space) => (w.machine ? `${w.machine}/${w.name}` : w.name).toLowerCase();
  const hits = m.spaces.filter((w) => w.name.toLowerCase() === r || qualified(w) === r);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(`"${ref}" is ambiguous: ${hits.map((w) => `${qualified(w)} (${w.id})`).join(", ")}`);
  throw new Error(`no space "${ref}"`);
}

// A color: a palette number (1-6), a palette name, or #rrggbb.
export const PALETTE: Record<string, string> = {
  teal: COLORS[0],
  orange: COLORS[1],
  blue: COLORS[2],
  violet: COLORS[3],
  green: COLORS[4],
  pink: COLORS[5],
};
export function parseColor(ref: string): string {
  const r = ref.trim().toLowerCase();
  if (/^[1-6]$/.test(r)) return COLORS[Number(r) - 1];
  if (PALETTE[r]) return PALETTE[r];
  if (/^#[0-9a-f]{6}$/.test(r)) return r;
  throw new Error(`not a color: "${ref}" (use 1-6, ${Object.keys(PALETTE).join("/")}, or #rrggbb)`);
}

// Spaces and agents whose names, tabs, folders or apps contain `q`.
export function search(m: Model, q: string) {
  const r = q.toLowerCase();
  const has = (...xs: (string | null | undefined)[]) => xs.some((x) => x?.toLowerCase().includes(r));
  return {
    spaces: m.spaces.filter((w) => has(w.name, w.folder, w.machine, ...w.tabs.map((t) => t.name))),
    agents: m.agents.filter((a) => has(a.name, a.app, a.tabName, a.spaceName, a.terminal)),
  };
}
