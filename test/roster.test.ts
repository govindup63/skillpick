import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, scanRoster } from "../src/roster.ts";

describe("parseFrontmatter", () => {
  test("plain key values and quoted strings", () => {
    const { fields, body } = parseFrontmatter(`---\nname: foo\ndescription: "Does a thing"\n---\n\n# Foo\nbody`);
    expect(fields.name).toBe("foo");
    expect(fields.description).toBe("Does a thing");
    expect(body).toBe("# Foo\nbody");
  });

  test("folded block scalar joins lines with spaces", () => {
    const text = `---\nname: typesafe-ai\nlicense: MIT\ndescription: >\n  Build AI-powered software.\n  Use when a feature needs judgment.\n---\n# Body`;
    const { fields } = parseFrontmatter(text);
    expect(fields.description).toBe("Build AI-powered software. Use when a feature needs judgment.");
    expect(fields.license).toBe("MIT");
  });

  test("plain scalar continuation lines are joined", () => {
    const { fields } = parseFrontmatter(`---\nname: benchmark\ndescription: Performance regression detection. Establishes\n  baselines and compares.\nlicense: MIT\n---\n`);
    expect(fields.description).toBe("Performance regression detection. Establishes baselines and compares.");
    expect(fields.license).toBe("MIT");
  });

  test("no frontmatter returns whole text as body", () => {
    const { fields, body } = parseFrontmatter("# just markdown");
    expect(fields).toEqual({});
    expect(body).toBe("# just markdown");
  });
});

describe("scanRoster", () => {
  test("dedupes symlinked skills and skips ones without a description", () => {
    const root = mkdtempSync(join(tmpdir(), "skillpick-"));
    const agents = join(root, ".agents", "skills");
    const claude = join(root, ".claude", "skills");
    mkdirSync(join(agents, "alpha"), { recursive: true });
    mkdirSync(join(agents, "nodesc"), { recursive: true });
    mkdirSync(claude, { recursive: true });
    writeFileSync(join(agents, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: First skill\n---\nbody text");
    writeFileSync(join(agents, "nodesc", "SKILL.md"), "---\nname: nodesc\n---\nbody");
    symlinkSync(join("..", "..", ".agents", "skills", "alpha"), join(claude, "alpha"));
    mkdirSync(join(claude, "beta"));
    writeFileSync(join(claude, "beta", "SKILL.md"), "---\nname: beta\ndescription: Second skill\n---\n");

    const skills = scanRoster([claude, agents]);
    expect(skills.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(skills[0]!.body).toBe("body text");
  });
});
