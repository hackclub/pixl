import { describe, expect, test } from "bun:test";
import { aggregateFileTime, isMarkdown, relativeEntity } from "./hackatimeFiles";

const P = ["my-proj"];
const hb = (time: number, entity: string, project = "my-proj") => ({ time, entity, project });

describe("relativeEntity", () => {
  test("strips everything up to the project folder", () => {
    expect(relativeEntity("/Users/someone/code/my-proj/src/a.ts", P)).toEqual({ path: "src/a.ts", inProject: true });
  });
  test("works with Windows separators", () => {
    expect(relativeEntity("C:\\Users\\me\\my-proj\\src\\a.ts", P)).toEqual({ path: "src/a.ts", inProject: true });
  });
  test("a file outside the folder keeps only its last two parts, never the user name", () => {
    expect(relativeEntity("/Users/someone/.config/app/config.toml", P)).toEqual({
      path: "app/config.toml",
      inProject: false,
    });
  });
  test("non-file entities such as a terminal command stay as they are", () => {
    expect(relativeEntity("npm run", P)).toEqual({ path: "npm run", inProject: false });
    expect(relativeEntity("", P).path).toBe("(unknown)");
  });
});

describe("isMarkdown", () => {
  test("md, mdx and markdown, any case", () => {
    expect(isMarkdown("TODO.md")).toBe(true);
    expect(isMarkdown("docs/a.MDX")).toBe(true);
    expect(isMarkdown("src/a.ts")).toBe(false);
  });
});

describe("aggregateFileTime", () => {
  test("a heartbeat lasts until the next one, capped at 2 minutes, the last one counts 2 minutes", () => {
    const r = aggregateFileTime(
      [hb(1000, "/h/my-proj/a.ts"), hb(1030, "/h/my-proj/b.ts"), hb(5000, "/h/my-proj/a.ts")],
      P,
    );
    const a = r.files.find((f) => f.path === "a.ts")!;
    const b = r.files.find((f) => f.path === "b.ts")!;
    expect(b.seconds).toBe(120);
    expect(a.seconds).toBe(30 + 120);
    expect(r.totalSeconds).toBe(270);
  });

  test("only the linked project's heartbeats are used", () => {
    const r = aggregateFileTime([hb(1, "/h/other/x.ts", "other"), hb(2, "/h/my-proj/a.ts")], P);
    expect(r.files.map((f) => f.path)).toEqual(["a.ts"]);
  });

  test("splits project files, outside time and markdown", () => {
    const r = aggregateFileTime(
      [hb(0, "/h/my-proj/src/a.ts"), hb(60, "/h/my-proj/TODO.md"), hb(120, "npm run"), hb(180, "/h/my-proj/docs/x.md")],
      P,
    );
    expect(r.totalSeconds).toBe(60 + 60 + 60 + 120);
    expect(r.outsideSeconds).toBe(60);
    expect(r.inProjectSeconds).toBe(r.totalSeconds - 60);
    expect(r.markdownSeconds).toBe(60 + 120);
  });

  test("sorted by time spent, biggest first", () => {
    const r = aggregateFileTime([hb(0, "/h/my-proj/a.ts"), hb(10, "/h/my-proj/b.ts"), hb(500, "/h/my-proj/b.ts")], P);
    expect(r.files[0]!.path).toBe("b.ts");
  });

  test("no heartbeats gives an empty report and keeps missingDays", () => {
    expect(aggregateFileTime([], P, 3)).toEqual({
      totalSeconds: 0,
      inProjectSeconds: 0,
      outsideSeconds: 0,
      markdownSeconds: 0,
      files: [],
      otherSeconds: 0,
      missingDays: 3,
    });
  });

  test("files beyond the cap are summed into otherSeconds", () => {
    const beats = Array.from({ length: 70 }, (_, i) => hb(i * 1000, `/h/my-proj/f${i}.ts`));
    const r = aggregateFileTime(beats, P);
    expect(r.files).toHaveLength(60);
    expect(r.otherSeconds).toBe(10 * 120);
    expect(r.files.reduce((s, f) => s + f.seconds, 0) + r.otherSeconds).toBe(r.totalSeconds);
  });
});
