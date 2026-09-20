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

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function loadConfig(): Config {
  const file = readFileConfig();
  const extraFromEnv = (process.env.SKILLPICK_SKILL_DIRS ?? "")
    .split(":")
    .filter(Boolean);
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
