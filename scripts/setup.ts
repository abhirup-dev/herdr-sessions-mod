#!/usr/bin/env bun
// Points the Herdr app at this checkout: each mods/<name> becomes a link in the app's mods folder
// (edits here hot-reload there), and `hs` is linked onto PATH.
//   bun run setup         install or repair
//   bun run setup --off   remove our links; anything that isn't our link is left alone
// HERDR_APP_HOME picks another app folder; HS_BIN_DIR another place for `hs` (default ~/.local/bin).
// A real folder already at a mod's place is moved aside to ~/.cache/herdr-sessions-mod/replaced-<time>/.
import { $ } from "bun";

const repo = import.meta.dir.replace(/\/scripts$/, "");
const app = Bun.env.HERDR_APP_HOME ?? `${Bun.env.HOME}/.config/herdr-app`;
const bin = Bun.env.HS_BIN_DIR ?? `${Bun.env.HOME}/.local/bin`;
const off = Bun.argv.includes("--off");

const linkOf = async (path: string) => (await $`readlink ${path}`.nothrow().quiet()).stdout.toString().trim() || null;
const exists = async (path: string) => (await $`test -e ${path} -o -L ${path}`.nothrow().quiet()).exitCode === 0;

if (!(await exists(`${app}/mods`))) {
  console.error(`No Herdr app folder at ${app} (start the app once, or set HERDR_APP_HOME)`);
  process.exit(1);
}

const mods = (await $`ls ${repo}/mods`.quiet()).stdout.toString().split("\n").filter(Boolean);
const links: [string, string][] = [...mods.map((m) => [`${repo}/mods/${m}`, `${app}/mods/${m}`] as [string, string]), [`${repo}/cli/hs.ts`, `${bin}/hs`]];
const aside = `${Bun.env.HOME}/.cache/herdr-sessions-mod/replaced-${new Date().toISOString().replace(/[:.]/g, "-")}`;

for (const [src, dst] of links) {
  const now = await linkOf(dst);
  if (off) {
    if (now === src) {
      await $`rm ${dst}`;
      console.log(`removed  ${dst}`);
    }
    continue;
  }
  if (now === src) {
    console.log(`ok       ${dst}`);
    continue;
  }
  if (await exists(dst)) {
    await $`mkdir -p ${aside} && mv ${dst} ${aside}/`;
    console.log(`aside    ${dst} → ${aside}/`);
  }
  await $`mkdir -p ${dst.slice(0, dst.lastIndexOf("/"))} && ln -s ${src} ${dst}`;
  console.log(`linked   ${dst} → ${src}`);
}

if (!off) {
  for (const m of mods) {
    const r = await $`herdr-app check ${app}/mods/${m}`.nothrow().quiet();
    console.log(r.exitCode === 0 ? `checked  ${m}` : `FAILED   ${m}\n${r.stdout}${r.stderr}`);
  }
  console.log(`\nLayouts use them as "mod": "session-spaces" / "session-agents" in place of "spaces" / "agents".`);
}
