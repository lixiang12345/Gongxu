import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { repositoryRoot, runNode, skillRoot } from "./helpers.mjs";

test("bootstrap skill package has valid metadata and resolvable references", () => {
  const result = runNode(join(repositoryRoot, "scripts/validate-skill.mjs"), [skillRoot]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Skill is valid/);

  const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
  const references = [...skill.matchAll(/`(references\/[^`]+\.md)`/g)].map((match) => match[1]);
  assert.ok(references.length >= 5);
  for (const relativePath of references) {
    assert.equal(existsSync(join(skillRoot, relativePath)), true, `${relativePath} must exist`);
  }
  assert.match(skill, /--force-path <relative-path>/);
  assert.doesNotMatch(skill, /add\s+`--force`/);
});
