import { expect, test } from "bun:test";
import { sanitizeClientFrame } from "./frame";

test("non-object frames are rejected", () => {
  for (const bad of [null, 5, "x", true, [1, 2], undefined]) expect(sanitizeClientFrame(bad)).toBeNull();
});

test("primitive fields survive untouched", () => {
  const frame = sanitizeClientFrame({ type: "move", posX: 1.5, posY: -2, flag: true, nothing: null, name: "a" })!;
  expect({ ...frame }).toEqual({ type: "move", posX: 1.5, posY: -2, flag: true, nothing: null, name: "a" });
});

test("object and array values that could throw in Number() or String() are dropped", () => {
  const frame = sanitizeClientFrame(
    JSON.parse('{"type":"move","posX":{"toString":0},"posY":{"valueOf":1,"toString":2},"scene":[{"toString":0}],"text":{}}'),
  )!;
  expect(frame.type).toBe("move");
  for (const key of ["posX", "posY", "scene", "text"]) {
    expect(frame[key]).toBeUndefined();
    expect(() => Number(frame[key])).not.toThrow();
    expect(() => String(frame[key] ?? "")).not.toThrow();
  }
});

test("a __proto__ key stays an inert own property", () => {
  const frame = sanitizeClientFrame(JSON.parse('{"type":"x","__proto__":"polluted"}'))!;
  expect(Object.getPrototypeOf(frame)).toBeNull();
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

test("npcs keep only primitive fields per entry and tolerate junk entries", () => {
  const frame = sanitizeClientFrame(
    JSON.parse('{"type":"save_npcs","scene":"s","npcs":[{"id":"a","posX":1,"posY":2},null,5,[1],{"id":{"toString":0},"posX":{"valueOf":1}}]}'),
  )!;
  const npcs = frame.npcs as Record<string, unknown>[];
  expect(npcs.length).toBe(5);
  expect({ ...npcs[0] }).toEqual({ id: "a", posX: 1, posY: 2 });
  for (const n of npcs.slice(1)) {
    expect(() => String(n.id ?? "")).not.toThrow();
    expect(() => Number(n.posX)).not.toThrow();
  }
});

test("a non-array npcs value is dropped", () => {
  expect(sanitizeClientFrame({ type: "save_npcs", npcs: { length: 3 } })!.npcs).toBeUndefined();
});
