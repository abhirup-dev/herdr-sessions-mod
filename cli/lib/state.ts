// Where hs reads and writes. Reads: the app's shared.json (sessions, filter, sort) and
// `herdr-app ls` (spaces, tabs, agents). Writes go through the session-spaces mod, never the
// file: the running app owns shared.json and would overwrite an outside edit.
export const appHome = () => Bun.env.HERDR_APP_HOME ?? `${Bun.env.HOME}/.config/herdr-app`;

export type Shared = Record<string, unknown>;

export async function readShared(): Promise<Shared> {
  const file = Bun.file(`${appHome()}/shared.json`);
  return (await file.exists()) ? JSON.parse(await file.text()) : {};
}

function herdrApp(args: string[]) {
  const r = Bun.spawnSync(["herdr-app", ...args]);
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

export type Terminal = {
  terminal: string;
  pane: string;
  status: string | null;
  app: string | null;
  name: string | null;
  sub_agents: unknown[];
};
export type LsSpace = {
  id: string;
  name: string;
  folder: string;
  machine: string | null;
  active: boolean;
  tabs: { id: string; name: string; active: boolean; terminals: Terminal[] }[];
};

// The open window's spaces; null when no window is running.
export function readWindow(): LsSpace[] | null {
  const r = herdrApp(["ls"]);
  if (r.code !== 0) return null;
  try {
    return JSON.parse(r.out).spaces ?? [];
  } catch {
    return null;
  }
}

// One request to the session-spaces mod; resolves once the mod acknowledges it in shared.json.
export async function send(op: string, arg: Record<string, unknown> = {}, timeoutMs = 3000): Promise<Shared> {
  const seq = crypto.randomUUID();
  const r = herdrApp(["do", `session-spaces.${op}:${JSON.stringify({ ...arg, seq })}`]);
  if (r.code !== 0) throw new Error(`herdr-app do failed: ${(r.err || r.out).trim() || `exit ${r.code}`}`);
  const reply = JSON.parse(r.out || "{}");
  if (reply.error) throw new Error(reply.error);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const shared = await readShared();
    const ack = shared["hs.ack"] as { seq?: string; error?: string | null } | undefined;
    if (ack?.seq === seq) {
      if (ack.error) throw new Error(ack.error);
      return shared;
    }
    await Bun.sleep(50);
  }
  throw new Error("Herdr didn't confirm: is the window open, with a layout that shows the session-spaces mod?");
}
