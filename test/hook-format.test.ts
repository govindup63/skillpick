import { describe, expect, test } from "bun:test";
import { formatHookOutput } from "../src/hook-format.ts";
import { suggestionBlock } from "../src/pick.ts";

const block = suggestionBlock("frontend-design");

describe("formatHookOutput", () => {
  test("claude, codex and droid use UserPromptSubmit", () => {
    for (const agent of ["claude", "codex", "droid"] as const) {
      const out = JSON.parse(formatHookOutput(agent, block, {}));
      expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
      expect(out.hookSpecificOutput.additionalContext).toContain("frontend-design");
    }
  });

  test("gemini uses BeforeAgent", () => {
    const out = JSON.parse(formatHookOutput("gemini", block, {}));
    expect(out.hookSpecificOutput.hookEventName).toBe("BeforeAgent");
  });

  test("copilot appends to the transformed prompt", () => {
    const out = JSON.parse(formatHookOutput("copilot", block, { transformedPrompt: "original" }));
    expect(out.modifiedTransformedPrompt.startsWith("original\n\n<skill_relevance>")).toBe(true);
  });

  test("plain returns the block itself", () => {
    expect(formatHookOutput("plain", block, {})).toBe(block);
  });

  test("no skill yields the quiet block", () => {
    expect(suggestionBlock(null)).toContain("No installed skill appears relevant");
  });
});
