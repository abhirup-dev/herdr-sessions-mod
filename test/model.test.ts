import { expect, test } from "bun:test";
import { build, findSession, findSpace, parseColor, search } from "../cli/lib/model.ts";
import type { LsSpace } from "../cli/lib/state.ts";

const term = (terminal: string, status: string | null, app: string | null = "claude-code") => ({ terminal, pane: `p${terminal}`, status, app, name: null, sub_agents: [] });
const ls: LsSpace[] = [
  { id: "spA", name: "dotfiles", folder: "/d", machine: null, active: true, tabs: [{ id: "t1", name: "Setup", active: true, terminals: [term("t7", "working"), term("t8", null, null)] }] },
  { id: "vps/spB", name: "dotfiles", folder: "/home", machine: "vps", active: false, tabs: [{ id: "t2", name: "Ops", active: false, terminals: [term("vps/t1", "idle", "pi")] }] },
  { id: "spNew", name: "fresh", folder: "/f", machine: null, active: false, tabs: [] },
];
const shared = {
  "space.sessions": { list: [{ id: "s1", name: "Personal", color: "#22a99a" }, { id: "s2", color: "#e3814f" }], active: "s1", of: { spA: "s1", "vps/spB": "s2" }, last: {} },
  "agents.sessions": "all",
};

test("joins sessions, spaces and agents; unseen spaces go to the shown session", () => {
  const m = build(shared, ls);
  expect(m.sessions.map((x) => [x.label, x.spaces.map((w) => w.id)])).toEqual([["Personal", ["spA", "spNew"]], ["Session 2", ["vps/spB"]]]);
  expect(m.agents.map((a) => [a.terminal, a.session])).toEqual([["t7", "s1"], ["vps/t1", "s2"]]);
  expect(m.filter).toBe("all");
  expect(m.sort).toBe("priority");
});

test("no window: sessions only", () => {
  const m = build(shared, null);
  expect(m.window).toBe(false);
  expect(m.sessions.length).toBe(2);
});

test("session refs: id, number, name", () => {
  const m = build(shared, ls);
  expect(findSession(m, "s2").id).toBe("s2");
  expect(findSession(m, "2").id).toBe("s2");
  expect(findSession(m, "personal").id).toBe("s1");
  expect(findSession(m, "Session 2").id).toBe("s2");
  expect(() => findSession(m, "9")).toThrow(/have: 1 Personal, 2 Session 2/);
});

test("space refs: id, unique name, machine/name; ambiguous names fail", () => {
  const m = build(shared, ls);
  expect(findSpace(m, "fresh").id).toBe("spNew");
  expect(findSpace(m, "vps/dotfiles").id).toBe("vps/spB");
  expect(findSpace(m, "spA").id).toBe("spA");
  expect(() => findSpace(m, "dotfiles")).toThrow(/ambiguous/);
  expect(() => findSpace(m, "nope")).toThrow(/no space/);
});

test("colors and search", () => {
  expect(parseColor("3")).toBe("#5b8def");
  expect(parseColor("Pink")).toBe("#d9649a");
  expect(parseColor("#ABCDEF")).toBe("#abcdef");
  expect(() => parseColor("red")).toThrow(/not a color/);
  const r = search(build(shared, ls), "ops");
  expect(r.spaces.map((w) => w.id)).toEqual(["vps/spB"]);
  expect(r.agents.map((a) => a.terminal)).toEqual(["vps/t1"]);
});
