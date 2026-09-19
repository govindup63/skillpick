// Benchmark skillpick against a labeled request set.
//
//   cd <project with your skills>; bun run <skillpick>/bench/run.ts [--repeats 3] [--out bench/results.json]
//
// Every request gets both calls regardless of the gate, so thresholds can be
// swept offline from one set of raw answers. A subset is re-run to measure
// run-to-run consistency.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.ts";
import { Picker } from "../src/pick.ts";
import { rosterDirs, scanRoster } from "../src/roster.ts";

interface Request {
  gold: string | null;
  text: string;
}

interface Raw {
  text: string;
  gold: string | null;
  ranked: { name: string; probability: number }[];
  gate: number;
  winner: string;
  fits: Record<string, number>;
  ms1: number;
  ms2: number;
  tokens1: number;
  tokens2: number;
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
};
const REPEATS = Number(flag("--repeats", "3"));
const OUT = resolve(flag("--out", resolve(import.meta.dir, "results.json")));
const CONCURRENCY = 4;
const PRICE_PER_MTOK = 0.042;

const config = loadConfig();
if (!config.apiKey) throw new Error("TYPESAFE_API_KEY missing");
const picker = new Picker(config);
const skills = scanRoster(rosterDirs(process.cwd(), config.extraDirs));
const requests = JSON.parse(readFileSync(resolve(import.meta.dir, "requests.json"), "utf8")) as Request[];
const byName = new Map(skills.map((s) => [s.name, s]));

const missing = requests.filter((r) => r.gold && !byName.has(r.gold));
if (missing.length) throw new Error(`gold skills not in roster: ${missing.map((m) => m.gold).join(", ")}`);

async function measure(request: Request): Promise<Raw> {
  const wide = await picker.rankWide(request.text, skills, true);
  const shortlist = wide.ranked.slice(0, config.shortlist).map((r) => byName.get(r.name)!);
  const rerank = await picker.rerank(request.text, shortlist);
  return {
    text: request.text,
    gold: request.gold,
    ranked: wide.ranked.slice(0, 5),
    gate: wide.gate,
    winner: rerank.winner,
    fits: rerank.fits,
    ms1: wide.ms,
    ms2: rerank.ms,
    tokens1: wide.inputTokens,
    tokens2: rerank.inputTokens,
  };
}

async function pool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
        process.stderr.write(`\r${i + 1}/${items.length}`);
      }
    }),
  );
  process.stderr.write("\n");
  return results;
}

function decide(raw: Raw, gateT: number, fitsT: number): string | null {
  if (raw.gate < gateT) return null;
  if (Math.max(...Object.values(raw.fits)) < fitsT) return null;
  return raw.winner;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

function pct(n: number, d: number): string {
  return `${((100 * n) / d).toFixed(1)}%`;
}

console.error(`${skills.length} skills, ${requests.length} requests (${requests.filter((r) => r.gold).length} covered)`);
const started = performance.now();
const raws = await pool(requests, measure);
const wall = performance.now() - started;

const covered = raws.filter((r) => r.gold);
const uncovered = raws.filter((r) => !r.gold);

// Consistency: re-run a slice of covered requests and compare picks and numbers.
const slice = covered.slice(0, 12);
const reruns: Raw[][] = [];
for (let i = 1; i < REPEATS; i++) reruns.push(await pool(slice, measure));
let samePick = 0;
let gateDrift = 0;
let topDrift = 0;
let comparisons = 0;
for (const [i, base] of slice.entries()) {
  for (const run of reruns) {
    const other = run[i]!;
    comparisons++;
    if (decide(base, config.gateThreshold, config.fitsThreshold) === decide(other, config.gateThreshold, config.fitsThreshold)) samePick++;
    gateDrift += Math.abs(base.gate - other.gate);
    topDrift += Math.abs((base.ranked[0]?.probability ?? 0) - (other.ranked[0]?.probability ?? 0));
  }
}

const lines: string[] = [];
const push = (s = "") => lines.push(s);

push(`## Benchmark: ${skills.length} skills, ${requests.length} requests`);
push();
push(`Run on ${new Date().toLocaleDateString("en-CA")} with model \`${config.model}\`, thresholds gate ${config.gateThreshold} / fits ${config.fitsThreshold}.`);
push();

const wideTop1 = covered.filter((r) => r.ranked[0]?.name === r.gold).length;
const wideTop3 = covered.filter((r) => r.ranked.slice(0, 3).some((x) => x.name === r.gold)).length;
const rerankTop1 = covered.filter((r) => r.winner === r.gold).length;
const finalPicks = covered.map((r) => decide(r, config.gateThreshold, config.fitsThreshold));
const finalCorrect = finalPicks.filter((p, i) => p === covered[i]!.gold).length;
const finalWrong = finalPicks.filter((p, i) => p !== null && p !== covered[i]!.gold).length;
const finalQuiet = finalPicks.filter((p) => p === null).length;
const needless = uncovered.filter((r) => decide(r, config.gateThreshold, config.fitsThreshold) !== null);

push(`### Accuracy`);
push();
push(`| Metric | Result |`);
push(`| --- | --- |`);
push(`| Call 1 top-1 (gold skill ranked first out of ${skills.length}) | ${wideTop1}/${covered.length} (${pct(wideTop1, covered.length)}) |`);
push(`| Call 1 top-3 (gold skill reaches the shortlist) | ${wideTop3}/${covered.length} (${pct(wideTop3, covered.length)}) |`);
push(`| Call 2 winner is the gold skill | ${rerankTop1}/${covered.length} (${pct(rerankTop1, covered.length)}) |`);
push(`| Final suggestion correct (after both thresholds) | ${finalCorrect}/${covered.length} (${pct(finalCorrect, covered.length)}) |`);
push(`| Final suggestion wrong skill | ${finalWrong}/${covered.length} (${pct(finalWrong, covered.length)}) |`);
push(`| Final suggestion stayed quiet on a covered request | ${finalQuiet}/${covered.length} (${pct(finalQuiet, covered.length)}) |`);
push(`| Needless suggestion on uncovered requests | ${needless.length}/${uncovered.length} (${pct(needless.length, uncovered.length)}) |`);
push();

push(`### Latency, tokens, cost`);
push();
const ms1 = raws.map((r) => r.ms1);
const ms2 = raws.map((r) => r.ms2);
const total = raws.map((r) => r.ms1 + r.ms2);
const tokens = raws.map((r) => r.tokens1 + r.tokens2);
const meanTokens = tokens.reduce((a, b) => a + b, 0) / tokens.length;
push(`| | p50 | p95 | mean |`);
push(`| --- | --- | --- | --- |`);
push(`| Call 1 (${skills.length}-way Choice + 3 gates) | ${percentile(ms1, 0.5)} ms | ${percentile(ms1, 0.95)} ms | ${Math.round(ms1.reduce((a, b) => a + b, 0) / ms1.length)} ms |`);
push(`| Call 2 (rerank top ${config.shortlist}) | ${percentile(ms2, 0.5)} ms | ${percentile(ms2, 0.95)} ms | ${Math.round(ms2.reduce((a, b) => a + b, 0) / ms2.length)} ms |`);
push(`| Both calls, sequential | ${percentile(total, 0.5)} ms | ${percentile(total, 0.95)} ms | ${Math.round(total.reduce((a, b) => a + b, 0) / total.length)} ms |`);
push();
push(`Input tokens per prompt: ${Math.round(meanTokens)} on average, which is $${((meanTokens * PRICE_PER_MTOK) / 1e6).toFixed(5)} at $${PRICE_PER_MTOK}/Mtok. One thousand prompts cost about $${((meanTokens * PRICE_PER_MTOK) / 1e3).toFixed(2)}. The whole run (${raws.length} prompts, ${CONCURRENCY} in parallel) took ${(wall / 1000).toFixed(1)} s wall clock.`);
push();

push(`### Consistency (${slice.length} prompts, ${REPEATS} runs each)`);
push();
push(`| Metric | Result |`);
push(`| --- | --- |`);
push(`| Same final suggestion across runs | ${samePick}/${comparisons} (${pct(samePick, comparisons)}) |`);
push(`| Mean drift in gate score | ${(gateDrift / comparisons).toFixed(3)} |`);
push(`| Mean drift in top-1 probability | ${(topDrift / comparisons).toFixed(3)} |`);
push();

push(`### Threshold sweep (offline, same answers)`);
push();
push(`Rows are the gate threshold, columns the fits threshold. Each cell is correct / wrong / needless.`);
push();
const gates = [0.2, 0.3, 0.4, 0.5];
const fitsTs = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
push(`| gate \\ fits | ${fitsTs.join(" | ")} |`);
push(`| --- | ${fitsTs.map(() => "---").join(" | ")} |`);
for (const g of gates) {
  const cells = fitsTs.map((f) => {
    const picks = covered.map((r) => decide(r, g, f));
    const ok = picks.filter((p, i) => p === covered[i]!.gold).length;
    const bad = picks.filter((p, i) => p !== null && p !== covered[i]!.gold).length;
    const nl = uncovered.filter((r) => decide(r, g, f) !== null).length;
    return `${ok} / ${bad} / ${nl}`;
  });
  push(`| ${g.toFixed(1)} | ${cells.join(" | ")} |`);
}
push();

push(`### Misses`);
push();
push(`| Request | Gold | Call 1 top | Final | Gate | Best fit |`);
push(`| --- | --- | --- | --- | --- | --- |`);
for (const [i, r] of covered.entries()) {
  const pick = finalPicks[i];
  if (pick === r.gold) continue;
  push(`| ${r.text.slice(0, 60)} | ${r.gold} | ${r.ranked[0]?.name} (${r.ranked[0]?.probability.toFixed(2)}) | ${pick ?? "quiet"} | ${r.gate.toFixed(2)} | ${Math.max(...Object.values(r.fits)).toFixed(2)} |`);
}
for (const r of needless) {
  push(`| ${r.text.slice(0, 60)} | none | ${r.ranked[0]?.name} (${r.ranked[0]?.probability.toFixed(2)}) | ${r.winner} | ${r.gate.toFixed(2)} | ${Math.max(...Object.values(r.fits)).toFixed(2)} |`);
}

writeFileSync(OUT, JSON.stringify({ skills: skills.length, config, raws, reruns }, null, 2));
console.error(`raw results -> ${OUT}`);
console.log(lines.join("\n"));
