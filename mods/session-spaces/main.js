// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder.
// Above the list, session tiles (sessions.js): each shows only its spaces, still
// under their machines. Drag a space onto a tile to move it, double-click it to name it,
// right-click it for its color, name and removal.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Button, RadioGroup, Radio } from "gpui-base";
import { nextCommand, spaces, machines, panes, run, openOverlay, closeOverlay, props, exec, hc, theme, shared, setShared, watchFolder, window, layout } from "herdr";
import { KEY, MAX, COLORS, initial, reconcile, add, remove, assign, move, target, rename, colorOf, setColor, labelOf } from "./sessions.js";

// The tile menu asks the sidebar copy to open its name field (the menu is another copy).
const RENAME = "space.sessions.rename";

const session = () => initial(shared(KEY));
const inSession = (w) => { const s = session(); return (s.of[w.id] ?? s.active) === s.active; };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    if (props()?.sessionMenu) return;
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.seen = spaces().find((w) => w.active)?.id;
    // The tile name field; made once, as InputState needs init.
    this.editing = null;
    this.input = InputState.new({ placeholder: "Name" });
    const save = (_e, cx) => {
      if (!this.editing) return;
      setShared(KEY, rename(session(), this.editing, this.input.value()));
      this.editing = null;
      cx.notify();
    };
    this.input.on("submit", save);
    this.input.on("blur", save);
    this.machines = [];
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    // `hs` drives sessions with `herdr-app do 'session-spaces.<op>:<json>'`; each answer
    // lands in shared "hs.ack" with the request's seq, so the CLI knows it was applied.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const at = c.indexOf(":");
        let arg = {};
        try { arg = at < 0 ? {} : JSON.parse(c.slice(at + 1)); } catch { setShared("hs.ack", { error: "bad JSON" }); continue; }
        let error = null;
        try { this.command(at < 0 ? c : c.slice(0, at), arg); } catch (e) { error = String(e?.message ?? e); }
        setShared("hs.ack", { seq: arg.seq ?? null, error });
        cx.notify();
      }
    });
  }

  checkNew(cx) {
    const asked = shared(RENAME);
    if (asked) {
      setShared(RENAME, null);
      const x = session().list.find((y) => y.id === asked);
      if (x && !narrow()) this.edit(x, cx);
    }
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null })).filter((r) => this.shown.has(r.w.id) && inSession(r.w));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    return out;
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    // Only machines this session has spaces on; an empty session offers every machine.
    const mine = spaces().filter(inSession);
    const remote = [...new Set([...mine.map(w => w.machine).filter(Boolean), ...(mine.length ? [] : this.machines.map(m => m.name))])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length && rows.length) return rows.map(draw);
    if (!remote.length && loading(null)) return [loadingRow(null)];
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const machine = this.machines.find(k => k.name === m);
      const connected = !m || machine?.state === "connected";
      const folded = this.folded.has(m);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().when(collapsed, el => el.justify_center()).text_size(11).text_color(t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", m ? { machine: m } : {}); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().when(collapsed, el => el.justify_center()).rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", m ? { machine: m } : {}))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).when(!collapsed, el => el.child("New space there"));
      return [head, ...(folded ? [] : mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, i, g, tree }, t) {
    const on = w.active;
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === i && this.over !== i, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === i && this.pressed !== i, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(this.pressed < i, line => line.bottom(0))
          .when(this.pressed > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = i;
        this.over = i;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces()[this.pressed];
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? i : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === i && from !== i) run("space.move", { id: spaces()[from].id, index: i + 1 });
        else if (from === i) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?")))
          .child(div().flex_shrink(0).max_w(150).truncate().text_color(t.foreground).child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1()),
      );
  }

  compact({ w, i }, t) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().text_color(tone(t, w.status)).child(glyph(w.status)));
  }

  // Naming in place: Enter or leaving the field saves. Focus waits for the field to be drawn.
  edit(x, cx) {
    this.editing = x.id;
    this.input.set_value(x.name ?? "");
    if (x.name) this.input.set_selected_range({ start: 0, end: x.name.length });
    cx.notify();
    cx.timer.after(30, () => this.input.focus());
    cx.timer.after(300, () => this.input.focus());
  }

  // One `hs` request. Session ids are resolved by the CLI; this checks they exist.
  command(op, a) {
    const s = session();
    const known = (id) => { if (!s.list.some((x) => x.id === id)) throw new Error(`no session ${id}`); return id; };
    const hex = (c) => { if (!/^#[0-9a-f]{6}$/i.test(c ?? "")) throw new Error(`not a #rrggbb color: ${c}`); return c; };
    switch (op) {
      case "add":
        if (s.list.length >= MAX) throw new Error(`at most ${MAX} sessions`);
        return setShared(KEY, add(s, { name: a.name, color: a.color && hex(a.color), show: a.show !== false }));
      case "remove":
        if (s.list.length < 2) throw new Error("the last session can't be removed");
        return setShared(KEY, remove(s, known(a.id)));
      case "rename": return setShared(KEY, rename(s, known(a.id), a.name ?? ""));
      case "color": return setShared(KEY, setColor(s, known(a.id), hex(a.color)));
      case "move": return setShared(KEY, move(s, a.spaces ?? [], known(a.to)));
      case "show": return this.pick(known(a.id));
      case "filter": return setShared("agents.sessions", a.mode === "all" || a.mode === "follow" ? a.mode : known(a.mode));
      case "sort":
        if (!["priority", "grouped", "session"].includes(a.by)) throw new Error(`unknown sort ${a.by}`);
        return setShared("agents.sort", a.by);
      default: throw new Error(`unknown command ${op}`);
    }
  }

  pick(id) {
    const s = session();
    setShared(KEY, { ...s, active: id });
    const w = target(s, id, spaces());
    if (w) run("space.select", { id: w.id });
  }

  // The session tiles: a row sharing the sidebar's width (two make wide
  // rectangles, more get narrower), a column of numbers on the rail.
  sessions(s, sp, t, collapsed) {
    const count = (id) => sp.filter((w) => s.of[w.id] === id).length;
    const tile = (x, n) => {
      const on = x.id === s.active;
      if (!collapsed && this.editing === x.id) {
        return div().id(`session-${x.id}`).h(32).flex_1().min_w(0).px(10).flex().items_center().rounded(8)
          .border_1().border_color(t.accent).bg(t.background).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.input).h_full().text_size(12.5).text_color(t.foreground));
      }
      return h_flex().id(`session-${x.id}`).h(collapsed ? 26 : 32).when(!collapsed, el => el.flex_1().min_w(0)).when(collapsed, el => el.flex_none())
        .items_center().gap(6).rounded(collapsed ? 6 : 8)
        .when(collapsed, el => el.justify_center())
        .when(!collapsed, el => el.px(10).justify_between().border_1().border_color(on ? t.selected : t.border))
        .when(on, el => el.bg(t.selected).text_color(t.foreground))
        .when(!on, el => el.text_color(t.muted).hover(st => st.bg(t.hover).text_color(t.foreground)))
        .cursor_pointer()
        // A space dragged from the list drops into this session.
        .on_mouse_up("left", (_e, cx) => {
          if (this.twice) this.twice = false;
          else if (this.pressed !== null) {
            const w = spaces()[this.pressed];
            this.pressed = null;
            this.over = null;
            if (w) setShared(KEY, assign(session(), w.id, x.id));
          } else this.pick(x.id);
          cx.notify();
        })
        .on_mouse_down("left", (e, cx) => { this.twice = e.click_count === 2 && !collapsed; if (this.twice) this.edit(x, cx); })
        .on_mouse_down("right", () => openOverlay({ mod: "session-spaces", kind: "popup", width: 216, height: 132, props: { sessionMenu: x.id } }))
        .when(!collapsed, el => el.child(h_flex().min_w(0).gap(7).items_center()
          .child(div().size(7).rounded(4).flex_none().bg(colorOf(s, x.id)))
          .child(div().min_w(0).truncate().font_semibold().child(x.name || String(n + 1)))))
        .when(collapsed, el => el.child(div().font_semibold().when(!on, d => d.text_color(colorOf(s, x.id))).child(String(n + 1))))
        .when(!collapsed && count(x.id) > 0, el => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(String(count(x.id)))));
    };
    const plus = h_flex().id("session-new").size(26).when(collapsed, el => el.w_full()).flex_none()
      .items_center().justify_center().rounded(6).text_color(t.dim)
      .hover(st => st.bg(t.hover).text_color(t.foreground))
      .on_click(() => setShared(KEY, add(session())))
      .child(svg("mods/workspace-chrome/plus.svg").size(13));
    const tiles = s.list.map(tile);
    if (collapsed) return v_flex().flex_none().px(4).pt(4).pb(6).gap(2).children(tiles).when(s.list.length < MAX, el => el.child(plus));
    return h_flex().flex_none().pl(8).pr(10).pt(4).pb(6).gap(6).items_center()
      .children(tiles)
      // One session keeps a half-width tile, the size it has beside a second.
      .when(s.list.length === 1, el => el.child(div().flex_1()))
      .when(s.list.length < MAX, el => el.child(plus));
  }

  // A tile's right-click menu: its color (a radio group of swatches), rename, remove.
  sessionMenu(t, id) {
    const s = session();
    const item = (key, text, enabled, act) => Button.new(key).disabled(!enabled)
      .w_full().h(30).px(8).flex().items_center().justify_start().rounded(7)
      .text_color(enabled ? t.foreground : t.dim)
      .when(enabled, el => el.cursor_pointer().hover(st => st.bg(t.hover)))
      .on_click(() => { act(); closeOverlay(props().overlay); })
      .child(text);
    const swatch = (c) => Radio.new(`color-${c}`).checked(c === colorOf(s, id))
      .on_change(() => setShared(KEY, setColor(session(), id, c)))
      .size(20).flex_none().rounded(10).flex().items_center().justify_center().cursor_pointer()
      .border_2().border_color(c === colorOf(s, id) ? t.foreground : t.popover)
      .hover(el => el.border_color(t.muted))
      .child(div().size(12).rounded(6).bg(c));
    return v_flex().w_full().p(5).bg(t.popover).text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(labelOf(s, id)))
      .child(RadioGroup.new("session-colors").px(6).pb(8).flex().gap(6).items_center().children(COLORS.map(swatch)))
      .child(item("session-rename", "Rename", true, () => setShared(RENAME, id)))
      .child(item("session-remove", "Remove session", s.list.length > 1, () => setShared(KEY, remove(session(), id))));
  }

  render() {
    const t = theme();
    if (props()?.sessionMenu) return this.sessionMenu(t, props().sessionMenu);
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    const now = reconcile(session(), sp, this.seen);
    this.seen = sp.find((w) => w.active)?.id;
    if (JSON.stringify(now) !== JSON.stringify(shared(KEY))) setShared(KEY, now);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(this.sessions(now, sp, t, collapsed))
      .child(h_flex().h(31).pl(collapsed ? 0 : 16).pr(collapsed ? 0 : 10).items_center().justify_between().when(collapsed, el => el.justify_center()).text_size(11.5).text_color(t.dim)
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 4 : 8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(t, collapsed)));
  }
}
