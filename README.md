# skillpick

Pick the right skill for every prompt, before your coding agent starts guessing.

If you have installed more than a handful of agent skills (`SKILL.md` folders for
Claude Code, Codex, Cursor, Gemini CLI and friends), you have probably noticed two
things. The agent loads the wrong skill when two of them sound alike, and it loads
a skill when none applies at all. Every skill description also sits in the system
prompt on every turn, so the roster itself costs tokens.

skillpick runs on every prompt you submit, asks [TypeSafe's Jev](https://docs.typesafe.ai)
which installed skill fits, and injects one line into the agent's context:

```
<skill_relevance>
Relevant to the current request: frontend-design. Load that skill and follow it
before starting. Ignore this if it does not fit what the user actually asked for.
</skill_relevance>
```

Jev is not an LLM. It is a decision model that returns probabilities over options
you supply, in about 100 to 300 ms per call, at $0.042 per million input tokens.
Two calls per prompt cost a fraction of a cent and add well under a second. Your
prompt and your skill descriptions are sent to TypeSafe's API; nothing else is.

## How it works

The design follows TypeSafe's [skill suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion),
which measured this shape on Nous Research's 182-skill Hermes roster. With a
suggestion in front of the turn, wrong skill loads fell from 16.8% to 7.3% and
needless loads from 9.8% to 4.0%.

1. **Scan the roster.** skillpick reads every `SKILL.md` it can find in the
   project and in your home directory (see [where skills are found](#where-skills-are-found)),
   parses the frontmatter, and keeps the name, description, and the first 1600
   characters of the body. Symlinked duplicates are collapsed.
2. **Call 1: skim everything.** One request with a Choice question over every
   skill name, using each description as the option text, plus three Noul
   questions about the prompt itself: does it ask for action on the user's
   system, would an expert follow a documented procedure, could a generalist
   answer in prose. The mean of those decides whether any skill is needed.
   Below 0.30 nothing is suggested.
3. **Call 2: read the top three properly.** A second Choice over the shortlist,
   this time with each skill's full description plus 700 characters of its
   body, and one Noul per candidate asking whether it does the specific thing
   requested. If the best of those is under 0.30, nothing is suggested.
4. **Inject one line.** The winner, or "no installed skill appears relevant",
   goes into the agent's context via its prompt-submit hook. The roster in the
   system prompt is untouched, so prefix caching still works.

Rosters over 200 skills are split into chunks, each chunk ranked on its own,
and the chunk winners ranked again together.

## Install

Requirements: [Bun](https://bun.sh) 1.x and a TypeSafe API key from
[console.typesafe.ai/keys](https://console.typesafe.ai/keys).

```bash
git clone https://github.com/govindup63/skillpick.git
cd skillpick
bun install
bun link                      # puts `skillpick` on your PATH
skillpick set-key ts_...      # stored in ~/.config/skillpick/config.json (mode 600)
skillpick doctor              # checks key, roster, hook wiring, and makes one live call
skillpick install --claude    # or --codex --gemini --droid --opencode --amp, or --all
```

Restart the agent afterwards. `skillpick roster` shows what it can see from the
current directory, and `skillpick suggest "your prompt" --verbose` shows both
calls with probabilities so you can see why it picked what it picked.

### Let an agent install it for you

Paste this into Claude Code, Codex, or whichever agent you use:

```text
Install skillpick, a tool that picks the right agent skill for each prompt using TypeSafe's Jev model, and wire its hook into this agent.

1. Check that `bun` is installed (`bun --version`). If not, install it from https://bun.sh and make sure it is on PATH.
2. Clone https://github.com/govindup63/skillpick into ~/.local/share/skillpick (or another permanent location, not a temp dir), then run `bun install` and `bun link` inside it.
3. Ask me for my TypeSafe API key if the TYPESAFE_API_KEY environment variable is not set. I can create one at https://console.typesafe.ai/keys. Save it with `skillpick set-key <key>`.
4. Run `skillpick doctor` and show me the output. It must report the key as found and the API check as ok.
5. Run `skillpick install` with the flag for this agent: `--claude` for Claude Code, `--codex` for Codex, `--gemini` for Gemini CLI, `--droid` for Factory Droid, `--opencode` for OpenCode, `--amp` for Amp. Pass several flags if I use several agents. Show me the hook entry or plugin file it added. If this agent is Cursor, Windsurf or Kimi, stop and tell me its prompt hook cannot inject context yet, and offer to install for the other agents instead.
6. Run `skillpick suggest "refactor this React component to use hooks" --verbose` and show me the result so I can see it working.
7. Tell me to restart the agent, and mention that `skillpick uninstall` removes the hook and `SKILLPICK_DISABLED=1` turns it off without uninstalling.

Do not modify any other hooks or settings. Read the skillpick README first if anything is unclear.
```

## Commands

| Command | What it does |
| --- | --- |
| `skillpick suggest "<prompt>" [--json] [--verbose]` | Rank installed skills for a prompt. `--verbose` prints both calls with probabilities to stderr. |
| `skillpick hook --agent <name>` | The prompt-submit adapter. Reads the agent's JSON on stdin, prints the context block in that agent's output shape (`--agent plain` prints the block itself). Silent no-op when there is no key, the prompt is a slash command, or the prompt is under 12 characters. Never blocks a prompt: errors go to stderr and exit 0. |
| `skillpick roster` | List the directories searched and every skill found. |
| `skillpick install --<agent> [...]` | Add the hook or plugin for one or more agents, or `--all`. Idempotent. |
| `skillpick uninstall --<agent> [...]` | Remove it. Other hooks in the same file are left alone. |
| `skillpick set-key <key>` | Store the TypeSafe key in `~/.config/skillpick/config.json`. |
| `skillpick doctor` | Check key, roster, hook wiring, and make one small live call. |

## Configuration

Environment variables win over `~/.config/skillpick/config.json`.

| Variable | Config key | Default | Meaning |
| --- | --- | --- | --- |
| `TYPESAFE_API_KEY` | `apiKey` | | API key |
| `SKILLPICK_DISABLED=1` | | | Hook becomes a no-op |
| `SKILLPICK_MODEL` | `model` | `jev-latest` | Pin a version such as `jev-1.13.0` once you have tuned thresholds |
| `SKILLPICK_GATE_THRESHOLD` | `gateThreshold` | `0.30` | Below this, the prompt is judged not to need a skill |
| `SKILLPICK_FITS_THRESHOLD` | `fitsThreshold` | `0.30` | Below this, no shortlisted skill fits well enough |
| `SKILLPICK_SHORTLIST` | `shortlist` | `3` | Candidates carried into the second call |
| `SKILLPICK_EXCERPT_CHARS` | `excerptChars` | `700` | Body characters each candidate brings to the second call |
| `SKILLPICK_SKILL_DIRS` | `extraDirs` | | Extra skill directories, colon separated (array in the config file) |
| `SKILLPICK_DEBUG=1` | | | Hook prints the verbose trace to stderr (visible in Claude Code's debug log) |

The thresholds come from the cookbook. They were tuned on Hermes skills and
Haiku 4.5, not on your roster. If skillpick suggests too eagerly, raise
`SKILLPICK_FITS_THRESHOLD`; if it stays quiet on prompts that clearly need a
skill, lower `SKILLPICK_GATE_THRESHOLD`.

## Where skills are found

skillpick looks in the project directory (the agent's `cwd`) first, then your
home directory, and dedupes by real path and by name, so a skill symlinked from
`.agents/skills` into `.claude/skills` counts once.

| Location | Read by |
| --- | --- |
| `.agents/skills`, `~/.agents/skills`, `~/.config/agents/skills` | The cross-agent standard from agentskills.io. Most agents read these. |
| `.claude/skills`, `~/.claude/skills` | Claude Code, and as a compatibility path by Cursor, OpenCode, Amp, Copilot, Kimi, Windsurf |
| `.codex/skills`, `~/.codex/skills` | Codex, Cursor, Kimi |
| `.cursor/skills`, `~/.cursor/skills` | Cursor |
| `.gemini/skills`, `~/.gemini/skills` | Gemini CLI |
| `.opencode/skills`, `~/.config/opencode/skills` | OpenCode |
| `~/.config/amp/skills` | Amp |
| `.factory/skills`, `~/.factory/skills` | Factory Droid |
| `.kimi/skills`, `~/.kimi/skills` | Kimi Code CLI |
| `.github/skills`, `~/.copilot/skills` | GitHub Copilot CLI |
| `.windsurf/skills`, `~/.codeium/windsurf/skills` | Windsurf |

Only the top level of each directory is scanned (one folder per skill). Agents
that also search nested subtrees, such as Droid and Cursor, will see skills
skillpick does not; list those directories in `SKILLPICK_SKILL_DIRS`.

Add more with `SKILLPICK_SKILL_DIRS` or `extraDirs`.

## Supported agents

| Agent | `install` flag | Status | How it plugs in |
| --- | --- | --- | --- |
| Claude Code | `--claude` | Supported | `UserPromptSubmit` command hook in `~/.claude/settings.json`, output via `hookSpecificOutput.additionalContext`. |
| Codex CLI | `--codex` | Supported | Same contract as Claude Code, in `~/.codex/hooks.json`. Codex asks you to review and trust the hook once. |
| Gemini CLI | `--gemini` | Supported | `BeforeAgent` hook in `~/.gemini/settings.json`, same output shape with a different event name. Gemini prompts once for project hooks; user hooks run directly. |
| Factory Droid | `--droid` | Supported | `UserPromptSubmit` in `~/.factory/hooks.json` (events at the top level, no `hooks` wrapper). |
| OpenCode | `--opencode` | Supported | A plugin at `~/.config/opencode/plugins/skillpick.ts` that handles `chat.message` and appends a synthetic text part. |
| Amp | `--amp` | Supported | A plugin at `~/.config/amp/plugins/skillpick.ts` that handles `agent.start` and returns a hidden context message. Run `plugins: reload` in Amp afterwards. |
| GitHub Copilot CLI | `--copilot` | Experimental | Command hooks on `userPromptSubmitted` have their output dropped by design. skillpick registers on `userPromptTransformed` and returns `modifiedTransformedPrompt` instead. The docs do not say whether command hooks are honoured there, only that SDK hooks are. Untested. |
| Cursor | none | Not possible today | `beforeSubmitPrompt` can only allow or block. There is no field for adding context on that event (only on `sessionStart` and `postToolUse`). Feature requests are open on the Cursor forum. |
| Windsurf / Cascade | none | Not possible today | `pre_user_prompt` can only block; stdout is never shown to the model. |
| Kimi Code CLI | none | Not possible today | The docs say `UserPromptSubmit` stdout is added to context, but the current source only acts on a block decision and never reads stdout. |

`--all` installs every supported target. Add an experimental one explicitly:
`skillpick install --all --copilot`. Install writes absolute paths to your `bun`
binary and to `src/cli.ts`, so keep the clone where it is or run `install` again
after moving it.

Support was verified against each agent's official docs on 2026-09-20. Hook
APIs move fast; if one of these stops working, `skillpick doctor` shows which
files are wired and `SKILLPICK_DEBUG=1` traces the hook.

## Known limits

- **Nearest neighbour wins when nothing fits.** If you ask for something the
  roster does not cover, the closest skill can still clear both thresholds.
  The cookbook saw this with a Mastodon request on a roster that only had an
  X skill.
- **A confident wrong suggestion is persuasive.** In the cookbook's run the
  suggestion fixed 37 turns and broke 7. The injected line says the agent may
  ignore it, and that wording matters.
- **Prompts leave your machine.** Each prompt and the skill descriptions go to
  api.typesafe.ai. TypeSafe states it does not train on requests. Set
  `SKILLPICK_DISABLED=1` in projects where that is not acceptable.
- **Jev is literal.** It scores the words in your skill descriptions, so vague
  descriptions rank badly. Descriptions that say when to use the skill and
  when not to rank best.

## Development

```bash
bun test          # roster parsing and scanning
bun run typecheck
bun run src/cli.ts suggest "..." --verbose
```

MIT licensed. Built on `@typesafe-ai/sdk`.
