import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  bootstrapScript,
  cleanupFixture,
  createFixture,
  readFixtureFile,
  runNode,
} from "./helpers.mjs";

test("bootstrap CLI creates and verifies a project from observed CI commands", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));

  const result = runNode(bootstrapScript, ["--root", fixture.root, "--yes"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Bootstrap complete\./);
  assert.ok(existsSync(join(fixture.root, ".ai/blueprint.json")));
  assert.ok(existsSync(join(fixture.root, ".ai/verification/run.mjs")));
  assert.match(readFixtureFile(fixture, "AGENTS.md"), /# Fixture Team Notes/);
  assert.ok(existsSync(join(fixture.root, ".claude/skills/gongxu-change-project/SKILL.md")));

  const blueprint = JSON.parse(readFileSync(join(fixture.root, ".ai/blueprint.json"), "utf8"));
  assert.equal(blueprint.project.name, "fixture-workspace");
  assert.deepEqual(blueprint.verification.map((check) => check.command), [
    "npm test",
    "npm run lint",
    "npm run typecheck",
  ]);
});

test("bootstrap CLI is interactive and does not write during dry-run", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));

  const result = runNode(bootstrapScript, ["--root", fixture.root, "--dry-run"], {
    input: "Fixture workspace for operators.\nFixture maintainers\n",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Blueprint preview/);
  assert.equal(existsSync(join(fixture.root, ".ai")), false);
  assert.match(result.stdout, /fixture-workspace/);
});
