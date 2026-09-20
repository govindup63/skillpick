import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const HOME = homedir();
const HOOK_TIMEOUT_SECONDS = 15;
const ADAPTERS_DIR = resolve(import.meta.dir, "..", "adapters");

export const BUN = process.execPath;
export const CLI = resolve(import.meta.dir, "cli.ts");

function hookCommand(agent: string): string {
  return `"${BUN}" run "${CLI}" hook --agent ${agent}`;
}

// Most agents group hooks under a matcher; Copilot lists them flat.
type HookEntry = Record<string, unknown> & { hooks?: Record<string, unknown>[] };

export interface Target {
  key: string;
  name: string;
  file: string;
  status: "supported" | "experimental";
  install(): void;
  uninstall(): boolean;
  installed(): boolean;
  // A skillpick entry whose cli.ts no longer exists, e.g. the clone was moved.
  stalePath(): string | undefined;
}

function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

function writeJson(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function commandsOf(entry: HookEntry): string[] {
  return [entry.command, ...(entry.hooks ?? []).map((h) => h.command)].filter((c): c is string => typeof c === "string");
}

function isOurs(entry: HookEntry): boolean {
  return commandsOf(entry).some((c) => c.includes(CLI));
}

const CLI_PATH_RE = /"([^"]*skillpick[^"]*cli\.ts)"/;

function staleCliPath(text: string): string | undefined {
  const path = text.match(CLI_PATH_RE)?.[1];
  return path && path !== CLI && !existsSync(path) ? path : undefined;
}

// Claude Code, Codex, Gemini CLI and Droid all keep an array of matcher
// groups per event. They differ in the file, whether the events sit under a
// top-level "hooks" key, the event name, and the fields on each hook.
function jsonHookTarget(opts: {
  key: string;
  name: string;
  file: string;
  wrapped: boolean;
  event: string;
  entry: () => HookEntry;
  status?: Target["status"];
  base?: Record<string, unknown>;
}): Target {
  const events = (data: Record<string, unknown>, create: boolean): Record<string, HookEntry[]> | undefined => {
    if (!opts.wrapped) return data as Record<string, HookEntry[]>;
    if (!data.hooks && create) data.hooks = {};
    return data.hooks as Record<string, HookEntry[]> | undefined;
  };
  return {
    key: opts.key,
    name: opts.name,
    file: opts.file,
    status: opts.status ?? "supported",
    install() {
      const data = { ...opts.base, ...readJson(opts.file) };
      const map = events(data, true)!;
      const kept = (map[opts.event] ?? []).filter((e) => !isOurs(e));
      map[opts.event] = [...kept, opts.entry()];
      writeJson(opts.file, data);
    },
    uninstall() {
      const data = readJson(opts.file);
      const map = events(data, false);
      const list = map?.[opts.event];
      if (!list?.some(isOurs)) return false;
      const kept = list.filter((e) => !isOurs(e));
      if (kept.length) map![opts.event] = kept;
      else delete map![opts.event];
      writeJson(opts.file, data);
      return true;
    },
    installed() {
      return events(readJson(opts.file), false)?.[opts.event]?.some(isOurs) ?? false;
    },
    stalePath() {
      for (const entry of events(readJson(opts.file), false)?.[opts.event] ?? []) {
        for (const command of commandsOf(entry)) {
          const stale = staleCliPath(command);
          if (stale) return stale;
        }
      }
      return undefined;
    },
  };
}

// OpenCode and Amp load TypeScript plugins from a directory. The adapter
// source is copied there with the bun and cli paths filled in.
function pluginTarget(opts: { key: string; name: string; file: string; adapter: string }): Target {
  return {
    key: opts.key,
    name: opts.name,
    file: opts.file,
    status: "supported",
    install() {
      const source = readFileSync(join(ADAPTERS_DIR, opts.adapter), "utf8")
        .replace("__SKILLPICK_BUN__", BUN)
        .replace("__SKILLPICK_CLI__", CLI);
      mkdirSync(dirname(opts.file), { recursive: true });
      writeFileSync(opts.file, source);
    },
    uninstall() {
      if (!existsSync(opts.file)) return false;
      rmSync(opts.file);
      return true;
    },
    installed() {
      return existsSync(opts.file) && readFileSync(opts.file, "utf8").includes(CLI);
    },
    stalePath() {
      return existsSync(opts.file) ? staleCliPath(readFileSync(opts.file, "utf8")) : undefined;
    },
  };
}

export const TARGETS: Target[] = [
  jsonHookTarget({
    key: "claude",
    name: "Claude Code",
    file: join(HOME, ".claude", "settings.json"),
    wrapped: true,
    event: "UserPromptSubmit",
    entry: () => ({ hooks: [{ type: "command", command: hookCommand("claude"), timeout: HOOK_TIMEOUT_SECONDS }] }),
  }),
  jsonHookTarget({
    key: "codex",
    name: "Codex",
    file: join(HOME, ".codex", "hooks.json"),
    wrapped: true,
    event: "UserPromptSubmit",
    entry: () => ({ hooks: [{ type: "command", command: hookCommand("codex"), timeout: HOOK_TIMEOUT_SECONDS }] }),
  }),
  jsonHookTarget({
    key: "gemini",
    name: "Gemini CLI",
    file: join(HOME, ".gemini", "settings.json"),
    wrapped: true,
    event: "BeforeAgent",
    entry: () => ({
      matcher: "*",
      hooks: [{ name: "skillpick", type: "command", command: hookCommand("gemini"), timeout: HOOK_TIMEOUT_SECONDS * 1000 }],
    }),
  }),
  jsonHookTarget({
    key: "droid",
    name: "Factory Droid",
    file: join(HOME, ".factory", "hooks.json"),
    wrapped: false,
    event: "UserPromptSubmit",
    entry: () => ({ hooks: [{ type: "command", command: hookCommand("droid"), timeout: HOOK_TIMEOUT_SECONDS }] }),
  }),
  jsonHookTarget({
    key: "copilot",
    name: "Copilot CLI",
    file: join(HOME, ".copilot", "hooks", "skillpick.json"),
    wrapped: true,
    event: "userPromptTransformed",
    status: "experimental",
    base: { version: 1 },
    entry: () => ({ type: "command", command: hookCommand("copilot"), timeoutSec: HOOK_TIMEOUT_SECONDS }),
  }),
  pluginTarget({
    key: "opencode",
    name: "OpenCode",
    file: join(HOME, ".config", "opencode", "plugins", "skillpick.ts"),
    adapter: "opencode.ts",
  }),
  pluginTarget({
    key: "amp",
    name: "Amp",
    file: join(HOME, ".config", "amp", "plugins", "skillpick.ts"),
    adapter: "amp.ts",
  }),
];

export function findTargets(keys: string[]): Target[] {
  return TARGETS.filter((t) => keys.includes(t.key));
}
