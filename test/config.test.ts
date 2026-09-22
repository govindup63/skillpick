import { describe, expect, test } from "bun:test";
import { splitSkillDirs } from "../src/config.ts";

describe("splitSkillDirs", () => {
  test("posix splits on colons", () => {
    expect(splitSkillDirs("/one/skills:/two/skills", "linux")).toEqual(["/one/skills", "/two/skills"]);
  });

  test("posix drops empty segments", () => {
    expect(splitSkillDirs("", "darwin")).toEqual([]);
    expect(splitSkillDirs("::/one::", "darwin")).toEqual(["/one"]);
  });

  test("windows keeps drive letters whole", () => {
    expect(splitSkillDirs("D:\\skills", "win32")).toEqual(["D:\\skills"]);
    expect(splitSkillDirs("D:\\one;C:\\two", "win32")).toEqual(["D:\\one", "C:\\two"]);
  });

  test("windows accepts colons between drive-lettered paths", () => {
    expect(splitSkillDirs("D:\\one:C:\\two", "win32")).toEqual(["D:\\one", "C:\\two"]);
    expect(splitSkillDirs("D:/one:C:/two", "win32")).toEqual(["D:/one", "C:/two"]);
  });

  test("windows still splits colons that cannot be a drive", () => {
    expect(splitSkillDirs("skills:more", "win32")).toEqual(["skills", "more"]);
    expect(splitSkillDirs("D:\\one;skills:more", "win32")).toEqual(["D:\\one", "skills", "more"]);
  });
});
