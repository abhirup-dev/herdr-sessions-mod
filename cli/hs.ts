#!/usr/bin/env bun
// hs: Herdr Sessions CLI. Shows and changes the sidebar's sessions (groups of spaces) for people
// and agents. Every change goes through the session-spaces mod in the open window.
import cac from "cac";
import { MAX } from "../mods/session-spaces/sessions.js";
import { build, findSession, findSpace, type Model, PALETTE, parseColor, search } from "./lib/model.ts";
import { agentLine, sessionLine, tree } from "./lib/render.ts";
import { readShared, readWindow, send } from "./lib/state.ts";
import pkg from "../package.json";

const load = async (): Promise<Model> => build(await readShared(), readWindow());
const print = (json: boolean, data: unknown, text: () => string) => console.log(json ? JSON.stringify(data, null, 2) : text());
// After a change: the session as it is now.
const after = async (id: string) => {
  const m = await load();
  const x = m.sessions.find((s) => s.id === id);
  console.log(x ? sessionLine(x) : `removed ${id}`);
};

const cli = cac("hs");

cli
  .command("[session]", "Tree: session › machine › space › agent")
  .alias("tree")
  .option("--no-agents", "Spaces only")
  .option("--json", "Machine-readable")
  .action(async (ref: string | undefined, o) => {
    const m = await load();
    const only = ref ? [findSession(m, ref)] : m.sessions;
    print(o.json, ref ? only[0] : m, () => tree(m, only, o.agents));
  });

cli
  .command("ls", "List sessions")
  .option("--json", "Machine-readable")
  .action(async (o) => {
    const m = await load();
    print(
      o.json,
      m.sessions.map(({ spaces, agents, ...x }) => ({ ...x, spaces: spaces.length, agents: agents.length })),
      () => m.sessions.map(sessionLine).join("\n"),
    );
  });

cli
  .command("spaces [session]", "List spaces and their session")
  .option("--json", "Machine-readable")
  .action(async (ref: string | undefined, o) => {
    const m = await load();
    const ws = ref ? findSession(m, ref).spaces : m.spaces;
    const of = (id: string) => m.sessions.find((x) => x.id === id);
    print(o.json, ws, () =>
      ws.map((w) => `[${of(w.session)?.n}] ${w.machine ? `${w.machine}/` : ""}${w.name}  ${w.id}  ${w.folder}`).join("\n"),
    );
  });

cli
  .command("agents [session]", "List agents and their session")
  .option("--status <status>", "Only working, blocked, done or idle")
  .option("--json", "Machine-readable")
  .action(async (ref: string | undefined, o) => {
    const m = await load();
    let list = ref ? findSession(m, ref).agents : m.agents;
    if (o.status) list = list.filter((a) => a.status === o.status);
    const of = (id: string) => m.sessions.find((x) => x.id === id);
    print(o.json, list, () => list.map((a) => agentLine(a, of(a.session))).join("\n") || "no agents");
  });

cli
  .command("find <query>", "Search spaces and agents")
  .option("--json", "Machine-readable")
  .action(async (q: string, o) => {
    const m = await load();
    const r = search(m, q);
    const of = (id: string) => m.sessions.find((x) => x.id === id);
    print(o.json, r, () =>
      [
        ...r.spaces.map((w) => `space  [${of(w.session)?.n} ${of(w.session)?.label}] ${w.name}  ${w.id}`),
        ...r.agents.map((a) => `agent  ${agentLine(a, of(a.session))}`),
      ].join("\n") || "nothing matches",
    );
  });

cli
  .command("add [name]", `Add a session (max ${MAX})`)
  .option("--color <color>", "1-6, a palette name or #rrggbb")
  .option("--no-show", "Keep the shown session")
  .action(async (name: string | undefined, o) => {
    const before = new Set((await load()).sessions.map((x) => x.id));
    const shared = await send("add", { name, color: o.color && parseColor(o.color), show: o.show });
    const m = build(shared, readWindow());
    const added = m.sessions.find((x) => !before.has(x.id));
    console.log(added ? sessionLine(added) : "added");
  });

cli.command("rm <session>", "Remove a session (spaces move to the first)").action(async (ref: string) => {
  const x = findSession(await load(), ref);
  await send("remove", { id: x.id });
  console.log(`removed ${x.label}; its ${x.spaces.length} spaces moved to the first session`);
});

cli.command("rename <session> [name]", "Rename (no name: back to its number)").action(async (ref: string, name = "") => {
  const x = findSession(await load(), ref);
  await send("rename", { id: x.id, name });
  await after(x.id);
});

cli.command("color <session> <color>", "Set a session's color").action(async (ref: string, c: string) => {
  const x = findSession(await load(), ref);
  await send("color", { id: x.id, color: parseColor(c) });
  await after(x.id);
});

cli.command("show <session>", "Show a session in the sidebar").action(async (ref: string) => {
  const x = findSession(await load(), ref);
  await send("show", { id: x.id });
  await after(x.id);
});

cli.command("move <session> <...spaces>", "Move spaces into a session").action(async (ref: string, refs: string[]) => {
  const m = await load();
  const x = findSession(m, ref);
  const ws = refs.map((r) => findSpace(m, r));
  await send("move", { to: x.id, spaces: ws.map((w) => w.id) });
  console.log(`moved ${ws.map((w) => w.name).join(", ")} → ${x.label}`);
});

cli
  .command("filter <mode>", "Agents panel filter: all | follow | <session>")
  .action(async (mode: string) => {
    const m = await load();
    const value = mode === "all" || mode === "follow" ? mode : findSession(m, mode).id;
    await send("filter", { mode: value });
    console.log(`agents panel shows ${value === "all" ? "all sessions" : value === "follow" ? "the shown session" : findSession(m, value).label}`);
  });

cli.command("sort <by>", "Agents panel order: priority | space | session").action(async (by: string) => {
  const map: Record<string, string> = { priority: "priority", space: "grouped", grouped: "grouped", session: "session" };
  if (!map[by]) throw new Error(`sort by priority, space or session, not "${by}"`);
  await send("sort", { by: map[by] });
  console.log(`agents panel sorted by ${by}`);
});

cli.command("colors", "List palette colors").action(() => {
  Object.entries(PALETTE).forEach(([name, hex], i) => console.log(`${i + 1} ${name.padEnd(7)} ${hex}`));
});

const EXAMPLES = [
  "hs                                  everything, as a tree",
  "hs agents work --status blocked     who needs you in Work",
  "hs move work rift-ergo vpsme/abhirup",
  "hs add Ops --color pink --no-show",
  "hs filter all                       agents panel: every session",
];
cli.help((all) => {
  // cac's per-command "--help" list repeats the command list; examples are clearer.
  const sections = all
    .filter((x) => !x.title?.startsWith("For more info"))
    .map((x) => ({ ...x, body: x.body.replace(/ \(default: true\)/g, "") }));
  if (sections.some((x) => x.title === "Commands")) sections.push({ title: "Examples", body: EXAMPLES.map((e) => `  $ ${e}`).join("\n") });
  sections.splice(1, 0, {
    title: "About",
    body: [
      "  hs is the CLI for the Herdr Sessions mod: https://github.com/abhirup-dev/herdr-sessions-mod",
      "  Sessions group the Herdr sidebar's spaces. Changes need the app open with a",
      "  layout showing session-spaces. --json on any read command for agents.",
    ].join("\n"),
  });
  sections.push({
    title: "Refs",
    body: [
      "  <session>  id (s2), number (2) or name (work, any case)",
      "  <space>    id, name, or machine/name when a name is on several machines",
      "  <color>    1-6, teal|orange|blue|violet|green|pink, or #rrggbb",
    ].join("\n"),
  });
  return sections;
});
cli.version(pkg.version);

try {
  cli.parse(process.argv, { run: false });
  await cli.runMatchedCommand();
} catch (e) {
  console.error(`hs: ${(e as Error).message}`);
  process.exit(1);
}
