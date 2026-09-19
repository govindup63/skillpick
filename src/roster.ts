import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface Skill {
  name: string;
  description: string;
  body: string;
  path: string;
}

// Frontmatter is a small YAML subset: `key: value`, plus `key: >` / `key: |`
// block scalars for multi-line descriptions. That covers every SKILL.md the
// skills CLI and Claude Code produce, without pulling in a YAML dependency.
export function parseFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const key = kv[1]!;
    let value = kv[2]!.trim();
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const block: string[] = [];
      i++;
      while (i < lines.length && (lines[i]!.startsWith("  ") || lines[i]!.trim() === "")) {
        block.push(lines[i]!.trim());
        i++;
      }
      value = value.startsWith(">") ? block.join(" ").trim() : block.join("\n").trim();
      fields[key] = value;
      continue;
    }
    i++;
    // A plain scalar may continue on indented lines that are not new keys.
    while (i < lines.length && /^\s+\S/.test(lines[i]!) && !/^[A-Za-z0-9_-]+:\s/.test(lines[i]!)) {
      value += " " + lines[i]!.trim();
      i++;
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return { fields, body: match[2]!.trim() };
}

// One entry per agent that reads SKILL.md folders, plus the cross-agent
// locations from agentskills.io. Duplicates collapse by real path and name.
const PROJECT_SKILL_SUBDIRS = [
  ".agents/skills",
  ".claude/skills",
  ".codex/skills",
  ".cursor/skills",
  ".gemini/skills",
  ".opencode/skills",
  ".factory/skills",
  ".kimi/skills",
  ".github/skills",
  ".windsurf/skills",
];

export const DEFAULT_SKILL_DIRS = [
  ".agents/skills",
  ".config/agents/skills",
  ".claude/skills",
  ".codex/skills",
  ".cursor/skills",
  ".gemini/skills",
  ".config/opencode/skills",
  ".config/amp/skills",
  ".factory/skills",
  ".kimi/skills",
  ".copilot/skills",
  ".codeium/windsurf/skills",
].map((dir) => join(homedir(), dir));

export function projectSkillDirs(cwd: string): string[] {
  return PROJECT_SKILL_SUBDIRS.map((dir) => join(cwd, dir));
}

const BODY_CHARS = 1600;

function readSkill(dir: string): Skill | undefined {
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) return undefined;
  const { fields, body } = parseFrontmatter(readFileSync(file, "utf8"));
  const name = fields.name || basename(dir);
  const description = (fields.description ?? "").replace(/\s+/g, " ").trim();
  if (!description) return undefined;
  return { name, description, body: body.slice(0, BODY_CHARS), path: file };
}

export function scanRoster(dirs: string[]): Skill[] {
  const seen = new Set<string>();
  const skills: Skill[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const skillDir = join(dir, entry);
      let real: string;
      try {
        real = realpathSync(skillDir);
        if (!statSync(real).isDirectory()) continue;
      } catch {
        continue;
      }
      if (seen.has(real)) continue;
      const skill = readSkill(real);
      if (!skill || seen.has(`name:${skill.name}`)) continue;
      seen.add(real);
      seen.add(`name:${skill.name}`);
      skills.push(skill);
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function rosterDirs(cwd: string, extra: string[]): string[] {
  return [...projectSkillDirs(cwd), ...DEFAULT_SKILL_DIRS, ...extra];
}
