// Sessions: groups of spaces, one shown at a time, picked from tiles above the list.
// Stored in shared.json under "space.sessions":
//   { list: [{ id }], active, of: { spaceId: sessionId }, last: { sessionId: spaceId } }
// A space id is unique across machines, so one map covers this computer and every remote.
// No imports: node runs sessions.test.js against this file.

export const KEY = "space.sessions";
export const MAX = 4;
// The space avatars' palette, so session colors sit with them in the sidebar.
export const COLORS = ["#22a99a", "#e3814f", "#5b8def", "#8b7cf6", "#3fae6a", "#d9649a"];

// A session's color: picked, else its place in the palette.
export function colorOf(s, id) {
  const n = Math.max(0, s.list.findIndex((x) => x.id === id));
  return s.list[n]?.color ?? COLORS[n % COLORS.length];
}

export function setColor(s, id, color) {
  return { ...s, list: s.list.map((x) => (x.id === id ? { ...x, color } : x)) };
}

// "Personal", else "Session 2".
export function labelOf(s, id) {
  const n = s.list.findIndex((x) => x.id === id);
  return s.list[n]?.name || `Session ${n + 1}`;
}

export function initial(s) {
  return s?.list?.length ? s : { list: [{ id: "s1" }], active: "s1", of: {}, last: {} };
}

// New spaces join the shown session. A space shown
// some other way (a shortcut, space.next) brings its session along; `seen` is the
// space shown at the last look, so picking an empty session doesn't bounce back.
export function reconcile(s, sp, seen) {
  const known = new Set(s.list.map((x) => x.id));
  const active = known.has(s.active) ? s.active : s.list[0].id;
  // Spaces missing now keep their entry: at startup, or with a machine away, spaces()
  // lacks them. shortcut: closed spaces' entries stay too (a few bytes each); prune
  // them by machine if the map ever grows large.
  const of = Object.fromEntries(Object.entries(s.of ?? {}).filter(([, x]) => known.has(x)));
  for (const w of sp) if (!of[w.id]) of[w.id] = active;
  const shown = sp.find((w) => w.active);
  const next = shown && shown.id !== seen && of[shown.id] !== active ? of[shown.id] : active;
  const last = Object.fromEntries(Object.entries(s.last ?? {}).filter(([k]) => known.has(k)));
  if (shown && of[shown.id] === next) last[next] = shown.id;
  // Each session keeps its color in the data, so other mods (the agents list) read it as is.
  const list = s.list.some((x) => !x.color) ? s.list.map((x) => ({ ...x, color: colorOf(s, x.id) })) : s.list;
  return { list, active: next, of, last };
}

// A new, empty session: shown unless `show` is false, named and colored if asked.
export function add(s, { name, color, show = true } = {}) {
  if (s.list.length >= MAX) return s;
  const n = Math.max(0, ...s.list.map((x) => parseInt(x.id.slice(1), 10) || 0)) + 1;
  const id = `s${n}`;
  const used = new Set(s.list.map((x) => colorOf(s, x.id)));
  const free = COLORS.find((c) => !used.has(c)) ?? COLORS[s.list.length % COLORS.length];
  const entry = { id, color: color ?? free, ...(name?.trim() ? { name: name.trim() } : {}) };
  return { ...s, list: [...s.list, entry], active: show ? id : s.active };
}

// Removing a session never closes spaces: they move to the first session left.
export function remove(s, id) {
  if (s.list.length < 2) return s;
  const list = s.list.filter((x) => x.id !== id);
  const to = list[0].id;
  const of = Object.fromEntries(Object.entries(s.of).map(([w, x]) => [w, x === id ? to : x]));
  const { [id]: _gone, ...last } = s.last ?? {};
  return { list, active: s.active === id ? to : s.active, of, last };
}

export function assign(s, spaceId, id) {
  return { ...s, of: { ...s.of, [spaceId]: id } };
}

// The space to show for a session: the last one shown there, else its first.
export function target(s, id, sp) {
  return sp.find((w) => w.id === s.last?.[id] && s.of[w.id] === id) ?? sp.find((w) => s.of[w.id] === id) ?? null;
}

// A session's shown name; blank goes back to its number.
export function rename(s, id, name) {
  return { ...s, list: s.list.map((x) => (x.id === id ? { ...x, name: name.trim() || undefined } : x)) };
}

// Moves spaces into a session; unknown sessions change nothing.
export function move(s, spaceIds, id) {
  if (!s.list.some((x) => x.id === id)) return s;
  return { ...s, of: { ...s.of, ...Object.fromEntries(spaceIds.map((w) => [w, id])) } };
}
