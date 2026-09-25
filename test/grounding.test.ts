import assert from "node:assert/strict";
import test from "node:test";
import { containsTerm, isQuoted, normalizeForQuote } from "../src/grounding.js";

test("quotes survive typography, whitespace, markup, and case changes", () => {
  const source = "Applications are accepted on a “rolling” basis — apply   anytime.\n**Deadline:** Oct 1";
  assert.ok(isQuoted('applications are accepted on a "rolling" basis - apply anytime.', source));
  assert.ok(isQuoted("Deadline: Oct 1", source));
  assert.equal(normalizeForQuote("It’s  C#\n"), "it's c#");
});

test("fabricated, trivial, and partial-word-only quotes are rejected", () => {
  const source = "Built TypeScript services for 40 clinics.";
  assert.equal(isQuoted("Built TypeScript services for 400 clinics.", source), false);
  assert.equal(isQuoted("Led a team of engineers", source), false);
  assert.equal(isQuoted("  ", source), false);
  assert.equal(isQuoted("--", source), false);
  assert.equal(isQuoted("40", source), false);
});

test("terms match whole words only", () => {
  assert.ok(containsTerm("Senior Java Engineer", "java"));
  assert.equal(containsTerm("JavaScript Developer", "java"), false);
  assert.ok(containsTerm("C# and .NET", "c#"));
  assert.equal(containsTerm("anything", ""), false);
});
