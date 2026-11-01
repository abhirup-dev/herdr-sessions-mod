import { expect, test } from "bun:test";
import { add, assign, COLORS, colorOf, initial, labelOf, MAX, move, reconcile, remove, rename, setColor, target } from "../mods/session-spaces/sessions.js";

const sp = (active: string, ...ids: string[]) => ids.map((id) => ({ id, active: id === active }));

test("existing spaces join the default session, with a stored color", () => {
  const s = reconcile(initial(undefined), sp("a", "a", "b"), "a");
  expect(s.of).toEqual({ a: "s1", b: "s1" });
  expect(s.last.s1).toBe("a");
  expect(s.list[0].color).toBe(COLORS[0]);
});

test("an empty session stays shown; new spaces join it; a shortcut brings its session", () => {
  let s = add(reconcile(initial(undefined), sp("a", "a", "b"), "a"));
  expect(s.active).toBe("s2");
  s = reconcile(s, sp("a", "a", "b"), "a");
  expect(s.active).toBe("s2");
  s = reconcile(s, sp("c", "a", "b", "c"), "a");
  expect(s.of.c).toBe("s2");
  s = reconcile(s, sp("b", "a", "b", "c"), "c");
  expect(s.active).toBe("s1");
  expect(target(s, "s2", sp("b", "a", "b", "c"))?.id).toBe("c");
});

test("spaces missing for a moment keep their session", () => {
  let s = add(reconcile(initial(undefined), sp("a", "a"), "a"));
  s = assign(s, "a", "s2");
  s = reconcile(s, [], "a");
  expect(s.of.a).toBe("s2");
});

test("move, remove, rename, colors, cap", () => {
  let s = add(reconcile(initial(undefined), sp("a", "a", "b"), "a"), { name: " Work ", show: false });
  expect(s.active).toBe("s1");
  expect(labelOf(s, "s2")).toBe("Work");
  s = move(s, ["a", "b"], "s2");
  expect(s.of).toEqual({ a: "s2", b: "s2" });
  expect(move(s, ["a"], "nope")).toBe(s);
  s = remove(s, "s2");
  expect(s.of).toEqual({ a: "s1", b: "s1" });
  expect(remove(s, "s1")).toBe(s);
  expect(rename(s, "s1", " ").list[0].name).toBeUndefined();
  s = setColor(s, "s1", COLORS[3]);
  expect(colorOf(s, "s1")).toBe(COLORS[3]);
  expect(colorOf(add(s), "s2")).toBe(COLORS[0]);
  for (let i = 0; i < 10; i++) s = add(s);
  expect(s.list.length).toBe(MAX);
});
