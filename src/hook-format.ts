// How each agent wants the suggestion back. Claude Code, Codex, Droid and
// Gemini share the hookSpecificOutput shape and differ only in the event
// name. Copilot's userPromptTransformed hook can only rewrite the
// model-facing prompt, so the block is appended to it. "plain" prints the
// block itself, for the OpenCode and Amp plugins.
export const HOOK_FORMATS = ["claude", "codex", "gemini", "droid", "copilot", "plain"] as const;
export type HookFormat = (typeof HOOK_FORMATS)[number];

export function formatHookOutput(format: HookFormat, block: string, input: { transformedPrompt?: string }): string {
  switch (format) {
    case "plain":
      return block;
    case "gemini":
      return JSON.stringify({ hookSpecificOutput: { hookEventName: "BeforeAgent", additionalContext: block } });
    case "copilot":
      return JSON.stringify({ modifiedTransformedPrompt: `${input.transformedPrompt ?? ""}\n\n${block}` });
    default:
      return JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: block } });
  }
}
