#!/usr/bin/env bun
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CONFIG_DIR, CONFIG_FILE, loadConfig, type Config } from "./config.ts";
import { Picker, suggestionBlock, type Suggestion } from "./pick.ts";
import { rosterDirs, scanRoster, type Skill } from "./roster.ts";
import { formatHookOutput, HOOK_FORMATS, type HookFormat } from "./hook-format.ts";
import { findTargets, TARGETS, type Target } from "./targets.ts";

const MIN_PROMPT_CHARS = 12;

function usage(): never {
  console.log(`skillpick - pick the right agent skill for a prompt with TypeSafe's Jev

Usage:
  skillpick suggest "<prompt>" [--json] [--verbose]   rank installed skills for a prompt
  skillpick hook [--agent claude|codex|gemini|droid|copilot|plain]
                                                       prompt-submit adapter: agent JSON in on stdin, agent-shaped JSON out
  skillpick roster                                     list the skills skillpick can see from this directory
  skillpick install --<agent> [--<agent> ...]          wire the hook or plugin into an agent
  skillpick uninstall --<agent> [...]                  remove it
                                                       agents: claude codex gemini droid opencode amp copilot(experimental) all
  skillpick set-key <TYPESAFE_API_KEY>                 store the API key in ${CONFIG_FILE}
  skillpick doctor                                     check key, roster, and hook wiring

Environment:
  TYPESAFE_API_KEY          API key (overrides the config file)
  SKILLPICK_DISABLED=1      make the hook a no-op
  SKILLPICK_SKILL_DIRS      extra skill directories, colon separated
  SKILLPICK_GATE_THRESHOLD  default 0.30   SKILLPICK_FITS_THRESHOLD  default 0.30
  SKILLPICK_SHORTLIST       default 3      SKILLPICK_EXCERPT_CHARS   default 700`);
  process.exit(1);
}

function loadRoster(config: Config, cwd: string): Skill[] {
  return scanRoster(rosterDirs(cwd, config.extraDirs));
}

function printVerbose(suggestion: Suggestion, skills: Skill[]) {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const { wide, rerank } = suggestion;
  if (wide) {
    console.error(`call 1: ${skills.length} skills, ${wide.inputTokens} tokens, ${wide.ms}ms`);
    console.error(`  needs a skill: ${wide.gate.toFixed(2)}  ${JSON.stringify(wide.gates)}`);
    for (const r of wide.ranked.slice(0, 5)) {
      const desc = byName.get(r.name)?.description ?? "";
      console.error(`  ${r.probability.toFixed(3)}  ${r.name.padEnd(32)} ${desc.slice(0, 70)}`);
    }
  }
  if (rerank) {
    console.error(`call 2: ${rerank.inputTokens} tokens, ${rerank.ms}ms, choice -> ${rerank.winner}`);
    for (const [name, fit] of Object.entries(rerank.fits)) {
      console.error(`  fits ${fit.toFixed(2)}  ${name}`);
    }
  }
  console.error(`result: ${suggestion.reason}${suggestion.skill ? ` -> ${suggestion.skill}` : ""}`);
}

async function cmdSuggest(args: string[]) {
  const json = args.includes("--json");
  const verbose = args.includes("--verbose");
  const prompt = args.filter((a) => !a.startsWith("--")).join(" ").trim();
  if (!prompt) usage();
  const config = loadConfig();
  if (!config.apiKey) {
    console.error("No TypeSafe API key. Run `skillpick set-key <key>` or export TYPESAFE_API_KEY.");
    process.exit(1);
  }
  const skills = loadRoster(config, process.cwd());
  const suggestion = await new Picker(config).suggest(prompt, skills);
  if (verbose) printVerbose(suggestion, skills);
  if (json) {
    console.log(JSON.stringify(suggestion, null, 2));
  } else {
    console.log(suggestion.skill ?? "(none)");
  }
}

async function cmdHook(args: string[]) {
  const agentArg = args[args.indexOf("--agent") + 1];
  const format: HookFormat = args.includes("--plain")
    ? "plain"
    : HOOK_FORMATS.includes(agentArg as HookFormat)
      ? (agentArg as HookFormat)
      : "claude";
  const config = loadConfig();
  if (config.disabled || !config.apiKey) return;
  const raw = await Bun.stdin.text();
  let prompt = "";
  let cwd = process.cwd();
  let input: { prompt?: string; cwd?: string; transformedPrompt?: string } = {};
  try {
    input = JSON.parse(raw) as typeof input;
    prompt = (input.prompt ?? "").trim();
    if (input.cwd) cwd = input.cwd;
  } catch {
    return;
  }
  // Slash commands already name a skill; very short prompts are follow-ups.
  if (prompt.startsWith("/") || prompt.length < MIN_PROMPT_CHARS) return;

  const skills = loadRoster(config, cwd);
  if (skills.length === 0) return;
  try {
    const suggestion = await new Picker(config).suggest(prompt, skills);
    if (process.env.SKILLPICK_DEBUG === "1") printVerbose(suggestion, skills);
    console.log(formatHookOutput(format, suggestionBlock(suggestion.skill), input));
  } catch (error) {
    // Never block the prompt over a failed suggestion.
    console.error(`skillpick: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function cmdRoster() {
  const config = loadConfig();
  const dirs = rosterDirs(process.cwd(), config.extraDirs);
  const skills = loadRoster(config, process.cwd());
  console.log(`directories searched:`);
  for (const dir of dirs) console.log(`  ${existsSync(dir) ? "✓" : "✗"} ${dir}`);
  console.log(`\n${skills.length} skills:`);
  for (const skill of skills) console.log(`  ${skill.name.padEnd(32)} ${skill.description.slice(0, 80)}`);
}

function selectTargets(args: string[]): Target[] {
  const keys = args.filter((a) => a.startsWith("--")).map((a) => a.slice(2));
  const named = findTargets(keys);
  const targets = args.includes("--all")
    ? TARGETS.filter((t) => t.status === "supported" || named.includes(t))
    : named;
  if (!targets.length) {
    console.error(`Pick at least one agent: ${TARGETS.map((t) => `--${t.key}`).join(" ")} or --all`);
    process.exit(1);
  }
  return targets;
}

function cmdInstall(args: string[]) {
  for (const target of selectTargets(args)) {
    target.install();
    const note = target.status === "experimental" ? " (experimental, see README)" : "";
    console.log(`${target.name}: installed -> ${target.file}${note}`);
  }
  console.log("Restart the agent for it to take effect. Codex and Gemini ask you to review and trust the hook once.");
  if (!loadConfig().apiKey) {
    console.log("\nNo API key found. Run `skillpick set-key <key>` (get one at https://console.typesafe.ai/keys).");
  }
}

function cmdUninstall(args: string[]) {
  for (const target of selectTargets(args)) {
    const removed = target.uninstall();
    console.log(`${target.name}: ${removed ? "removed from" : "nothing to remove in"} ${target.file}`);
  }
}

function cmdSetKey(key: string | undefined) {
  if (!key) usage();
  mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = existsSync(CONFIG_FILE) ? JSON.parse(readFileSync(CONFIG_FILE, "utf8")) : {};
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...existing, apiKey: key }, null, 2) + "\n");
  chmodSync(CONFIG_FILE, 0o600);
  console.log(`Saved API key to ${CONFIG_FILE}`);
}

async function cmdDoctor() {
  const config = loadConfig();
  const skills = loadRoster(config, process.cwd());
  console.log(`API key:   ${config.apiKey ? "found" : "missing (run `skillpick set-key <key>`)"}`);
  console.log(`model:     ${config.model}`);
  console.log(`roster:    ${skills.length} skills from ${process.cwd()}`);
  for (const target of TARGETS) {
    const state = target.installed() ? "installed" : "not installed";
    console.log(`hook:      ${target.name.padEnd(14)} ${state.padEnd(14)} ${target.file}`);
  }
  console.log(`disabled:  ${config.disabled}`);
  if (config.apiKey) {
    try {
      const picker = new Picker(config);
      const result = await picker.rankWide("Format this Python file with black and fix lint errors", skills.slice(0, 5), true);
      console.log(`API check: ok (${result.ms}ms, ${result.inputTokens} tokens)`);
    } catch (error) {
      console.log(`API check: failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "suggest":
    await cmdSuggest(rest);
    break;
  case "hook":
    await cmdHook(rest);
    break;
  case "roster":
    cmdRoster();
    break;
  case "install":
    cmdInstall(rest);
    break;
  case "uninstall":
    cmdUninstall(rest);
    break;
  case "set-key":
    cmdSetKey(rest[0]);
    break;
  case "doctor":
    await cmdDoctor();
    break;
  default:
    usage();
}
