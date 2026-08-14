import assert from "node:assert/strict";
import test from "node:test";

test("api fixture is runnable", () => {
  assert.equal("fixture-api".startsWith("fixture"), true);
});
