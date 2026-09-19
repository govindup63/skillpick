// OpenCode plugin installed by `skillpick install --opencode`.
// Runs skillpick on every user message and appends its suggestion as a
// synthetic text part, so the model sees it and the transcript does not.
import { execFileSync } from "node:child_process";
import type { Plugin } from "@opencode-ai/plugin";

const BUN = "__SKILLPICK_BUN__";
const CLI = "__SKILLPICK_CLI__";

export const SkillPick: Plugin = async () => ({
  "chat.message": async (_input, output) => {
    const prompt = output.parts
      .filter((part) => part.type === "text")
      .map((part) => (part as { text: string }).text)
      .join("\n")
      .trim();
    if (!prompt) return;
    let block = "";
    try {
      block = execFileSync(BUN, ["run", CLI, "hook", "--agent", "plain"], {
        input: JSON.stringify({ prompt, cwd: process.cwd() }),
        encoding: "utf8",
        timeout: 15_000,
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
    } catch {
      return;
    }
    if (!block) return;
    output.parts.push({
      id: `prt_skillpick_${Date.now()}`,
      sessionID: output.message.sessionID,
      messageID: output.message.id,
      type: "text",
      text: block,
      synthetic: true,
    });
  },
});
