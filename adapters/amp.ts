// Amp plugin installed by `skillpick install --amp`.
// Runs skillpick when the user submits a prompt and appends its suggestion
// to the user message without displaying it.
import { execFileSync } from "node:child_process";
import type { PluginAPI } from "@ampcode/plugin";

const BUN = "__SKILLPICK_BUN__";
const CLI = "__SKILLPICK_CLI__";

export default function (amp: PluginAPI) {
  amp.on("agent.start", async (event) => {
    const prompt = (event.message ?? "").trim();
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
    return { message: { content: block, display: false } };
  });
}
