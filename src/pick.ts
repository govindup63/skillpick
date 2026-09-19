import { choice, noul, TypeSafeClient, type ChoiceResponse, type NoulResponse, type Questions } from "@typesafe-ai/sdk";
import type { Config } from "./config.ts";
import type { Skill } from "./roster.ts";

export interface Ranked {
  name: string;
  probability: number;
}

export interface WideResult {
  ranked: Ranked[];
  gate: number;
  gates: Record<string, number>;
  inputTokens: number;
  ms: number;
}

export interface RerankResult {
  winner: string;
  fits: Record<string, number>;
  inputTokens: number;
  ms: number;
}

export interface Suggestion {
  skill: string | null;
  reason: "gated" | "no-fit" | "picked" | "empty-roster";
  wide?: WideResult;
  rerank?: RerankResult;
}

const WIDE_INSTRUCTIONS =
  "Which of these skills, if any, is the right one to load to help with the user's latest request?";

// A yes on the first two points toward loading a skill; a yes on the third
// points away from it. Wording follows TypeSafe's skill suggestion cookbook.
const GATE_QUESTIONS: Record<string, { text: string; inverted: boolean }> = {
  acts_on_user_system: {
    text: "Is the assistant being asked to act on the user's files, code, accounts, devices, or online services, rather than only to explain or advise?",
    inverted: false,
  },
  would_follow_documented_procedure: {
    text: "Would a careful expert answering this consult a specific documented procedure, checklist, or set of commands, rather than answering from general understanding?",
    inverted: false,
  },
  prose_suffices: {
    text: "Could a knowledgeable generalist fully satisfy this request in prose, with no tools, no documentation, and no access to the user's files or accounts?",
    inverted: true,
  },
};

const RERANK_INSTRUCTIONS =
  "Exactly one of these skills is the right one to load for the user's latest request. Which one? Read what each actually does, not just its name.";

// One Choice question holds a few hundred options comfortably. Past that the
// roster is split, each chunk ranked on its own, and the chunk winners ranked
// again together.
const CHUNK_SIZE = 200;

function buildState(request: string) {
  return { request };
}

export class Picker {
  private client: TypeSafeClient;

  constructor(private config: Config) {
    this.client = new TypeSafeClient({
      apiKey: config.apiKey,
      defaultModel: config.model,
      timeout: 15_000,
    });
  }

  async rankWide(request: string, skills: Skill[], withGates: boolean): Promise<WideResult> {
    const started = performance.now();
    const criteria: Record<string, string> = {};
    for (const skill of skills) criteria[skill.name] = skill.description;
    const questions: Questions = { which: choice(WIDE_INSTRUCTIONS, criteria) };
    if (withGates) {
      for (const [key, gate] of Object.entries(GATE_QUESTIONS)) {
        questions[`gate::${key}`] = noul(gate.text);
      }
    }
    const response = await this.client.systemOne({ state: buildState(request), questions });
    const which = response.answers.which as ChoiceResponse | undefined;
    if (which?.type !== "choice") throw new Error("unexpected answer type for `which`");
    const ranked = Object.entries(which.probabilities)
      .map(([name, probability]) => ({ name, probability }))
      .sort((a, b) => b.probability - a.probability);

    const gates: Record<string, number> = {};
    const oriented: number[] = [];
    for (const [key, gate] of Object.entries(GATE_QUESTIONS)) {
      const answer = response.answers[`gate::${key}`] as NoulResponse | undefined;
      if (answer?.type !== "noul") continue;
      gates[key] = answer.noul;
      oriented.push(gate.inverted ? 1 - answer.noul : answer.noul);
    }
    const gate = oriented.length ? oriented.reduce((a, b) => a + b, 0) / oriented.length : 1;
    return {
      ranked,
      gate,
      gates,
      inputTokens: response.usage.input_tokens,
      ms: Math.round(performance.now() - started),
    };
  }

  async rerank(request: string, candidates: Skill[]): Promise<RerankResult> {
    const started = performance.now();
    const criteria: Record<string, string> = {};
    for (const skill of candidates) {
      criteria[skill.name] = `${skill.description} — ${skill.body.slice(0, this.config.excerptChars)}`;
    }
    const questions: Questions = { which: choice(RERANK_INSTRUCTIONS, criteria) };
    for (const skill of candidates) {
      questions[`fits::${skill.name}`] = noul(
        `Does the skill '${skill.name}' do the specific thing the user's request asks for? It is described as: ${skill.description}`,
      );
    }
    const response = await this.client.systemOne({ state: buildState(request), questions });
    const which = response.answers.which as ChoiceResponse | undefined;
    if (which?.type !== "choice") throw new Error("unexpected answer type for `which`");
    const fits: Record<string, number> = {};
    for (const skill of candidates) {
      const answer = response.answers[`fits::${skill.name}`] as NoulResponse | undefined;
      if (answer?.type === "noul") fits[skill.name] = answer.noul;
    }
    return {
      winner: which.choice,
      fits,
      inputTokens: response.usage.input_tokens,
      ms: Math.round(performance.now() - started),
    };
  }

  async suggest(request: string, skills: Skill[]): Promise<Suggestion> {
    if (skills.length === 0) return { skill: null, reason: "empty-roster" };
    const byName = new Map(skills.map((s) => [s.name, s]));

    let wide: WideResult;
    if (skills.length <= CHUNK_SIZE) {
      wide = await this.rankWide(request, skills, true);
    } else {
      const chunks: Skill[][] = [];
      for (let i = 0; i < skills.length; i += CHUNK_SIZE) chunks.push(skills.slice(i, i + CHUNK_SIZE));
      const results = await Promise.all(chunks.map((chunk, i) => this.rankWide(request, chunk, i === 0)));
      const finalists = results
        .flatMap((r) => r.ranked.slice(0, this.config.shortlist))
        .map((r) => byName.get(r.name)!)
        .filter(Boolean);
      const merged = await this.rankWide(request, finalists, false);
      const first = results[0]!;
      wide = {
        ranked: merged.ranked,
        gate: first.gate,
        gates: first.gates,
        inputTokens: results.reduce((n, r) => n + r.inputTokens, 0) + merged.inputTokens,
        ms: Math.max(...results.map((r) => r.ms)) + merged.ms,
      };
    }

    if (wide.gate < this.config.gateThreshold) return { skill: null, reason: "gated", wide };

    const shortlist = wide.ranked
      .slice(0, this.config.shortlist)
      .map((r) => byName.get(r.name)!)
      .filter(Boolean);
    const rerank = await this.rerank(request, shortlist);
    const best = Math.max(...Object.values(rerank.fits));
    if (best < this.config.fitsThreshold) return { skill: null, reason: "no-fit", wide, rerank };
    return { skill: rerank.winner, reason: "picked", wide, rerank };
  }
}

export function suggestionBlock(skill: string | null): string {
  const body = skill
    ? `Relevant to the current request: ${skill}. Load that skill and follow it before starting. Ignore this if it does not fit what the user actually asked for.`
    : "No installed skill appears relevant to this request.";
  return `<skill_relevance>\n${body}\n</skill_relevance>`;
}
