// Text views for people and agents. Colors only on a terminal, and never with NO_COLOR.
import type { Agent, Model, Session, Space } from "./model.ts";

const tty = process.stdout.isTTY && !Bun.env.NO_COLOR;
const rgb = (hex: string, s: string) => {
  if (!tty) return s;
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
};
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);

const GLYPH: Record<string, string> = { working: "◐", blocked: "!", done: "✓", idle: "○" };
const where = (m: string | null) => m ?? "This computer";

export function sessionLine(x: Session): string {
  const counts = dim(`${x.spaces.length} spaces · ${x.agents.length} agents`);
  return `${rgb(x.color, "●")} ${x.n} ${bold(x.label)}${x.shown ? dim(" (shown)") : ""}  ${counts}  ${dim(x.id)}`;
}

export function agentLine(a: Agent, withSession?: Session): string {
  const who = a.name || a.app || a.terminal;
  const tag = withSession ? `${rgb(withSession.color, `[${withSession.n}]`)} ` : "";
  return `${tag}${GLYPH[a.status] ?? "·"} ${who} ${dim(a.status)}  ${a.spaceName} · ${a.tabName}  ${dim(a.terminal)}`;
}

function spaceLines(w: Space, lead: string, agents: boolean): string[] {
  const head = `${w.name}${w.active ? dim("  ◂ shown") : ""}  ${dim(w.id)}`;
  if (!agents) return [head];
  return [head, ...w.agents.map((a, i) => `${lead}${i === w.agents.length - 1 ? "└─" : "├─"} ${agentLine(a)}`)];
}

// Session → machine → space → agent, in the sidebar's order.
export function tree(m: Model, only: Session[] = m.sessions, agents = true): string {
  const out: string[] = [];
  for (const x of only) {
    out.push(sessionLine(x));
    const machines = [...new Set(x.spaces.map((w) => w.machine))];
    machines.forEach((mc, i) => {
      const lastM = i === machines.length - 1;
      out.push(`${lastM ? "└─" : "├─"} ${dim(where(mc))}`);
      const ws = x.spaces.filter((w) => w.machine === mc);
      ws.forEach((w, j) => {
        const lastW = j === ws.length - 1;
        const [head, ...rest] = spaceLines(w, `${lastM ? "   " : "│  "}${lastW ? "   " : "│  "}`, agents);
        out.push(`${lastM ? "   " : "│  "}${lastW ? "└─" : "├─"} ${head}`, ...rest);
      });
    });
    if (!x.spaces.length) out.push(dim("└─ (no spaces)"));
    out.push("");
  }
  const filter =
    m.filter === "all" ? "all sessions" : m.filter === "follow" ? "the shown session" : m.sessions.find((x) => x.id === m.filter)?.label;
  out.push(dim(`agents panel: ${filter ?? m.filter}, sorted by ${m.sort}${m.window ? "" : " · no window open: spaces unknown"}`));
  return out.join("\n");
}
