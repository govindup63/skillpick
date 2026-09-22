import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR = join(homedir(), ".config", "skillpick");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Config {
  apiKey?: string;
  model: string;
  shortlist: number;
  excerptChars: number;
  gateThreshold: number;
  fitsThreshold: number;
  extraDirs: string[];
  disabled: boolean;
}

interface FileConfig {
  apiKey?: string;
  model?: string;
  shortlist?: number;
  excerptChars?: number;
  gateThreshold?: number;
  fitsThreshold?: number;
  extraDirs?: string[];
}

function readFileConfig(): FileConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as FileConfig;
}

// SKILLPICK_SKILL_DIRS is a path list, separated the way the platform
// separates PATH: ":" on macOS and Linux, ";" on Windows, where a bare colon
// belongs to the drive letter in "D:\skills". Colons still separate on
// Windows where they cannot be a drive letter, so a list copied from the
// docs keeps working.
export function splitSkillDirs(raw: string, platform: string = process.platform): string[] {
  if (platform !== "win32") return raw.split(":").filter(Boolean);
  return raw.split(";").flatMap(splitOffDriveLetters).filter(Boolean);
}

function splitOffDriveLetters(part: string): string[] {
  const dirs: string[] = [];
  let current = "";
  for (let i = 0; i < part.length; i++) {
    const char = part[i]!;
    const isDriveColon = /^[A-Za-z]$/.test(current) && /^[\\/]/.test(part[i + 1] ?? "");
    if (char === ":" && !isDriveColon) {
      dirs.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  dirs.push(current);
  return dirs;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function loadConfig(): Config {
  const file = readFileConfig();
  const extraFromEnv = splitSkillDirs(process.env.SKILLPICK_SKILL_DIRS ?? "");
  return {
    apiKey: process.env.TYPESAFE_API_KEY || file.apiKey,
    model: process.env.SKILLPICK_MODEL || file.model || "jev-latest",
    shortlist: envNumber("SKILLPICK_SHORTLIST", file.shortlist ?? 3),
    excerptChars: envNumber("SKILLPICK_EXCERPT_CHARS", file.excerptChars ?? 700),
    gateThreshold: envNumber("SKILLPICK_GATE_THRESHOLD", file.gateThreshold ?? 0.3),
    fitsThreshold: envNumber("SKILLPICK_FITS_THRESHOLD", file.fitsThreshold ?? 0.5),
    extraDirs: [...(file.extraDirs ?? []), ...extraFromEnv],
    disabled: process.env.SKILLPICK_DISABLED === "1",
  };
}
