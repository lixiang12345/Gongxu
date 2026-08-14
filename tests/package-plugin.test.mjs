import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { packagePluginScript, parseJsonOutput, repositoryRoot, runNode } from "./helpers.mjs";

test("plugin packager creates a valid deterministic copy of the canonical skill", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "gongxu-plugin-test-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const output = join(temporary, "gongxu");

  const first = runNode(packagePluginScript, ["--output", output]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(parseJsonOutput(first).changed, true);

  const manifest = JSON.parse(readFileSync(join(output, ".codex-plugin/plugin.json"), "utf8"));
  const projectPackage = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, "gongxu");
  assert.equal(manifest.version, projectPackage.version);
  assert.equal(manifest.skills, "./skills/");
  assert.equal(
    readFileSync(join(output, "skills/bootstrap-ai-project/SKILL.md"), "utf8"),
    readFileSync(join(repositoryRoot, "skills/bootstrap-ai-project/SKILL.md"), "utf8")
  );

  const skillValidation = runNode(join(repositoryRoot, "scripts/validate-skill.mjs"), [
    join(output, "skills/bootstrap-ai-project"),
  ]);
  assert.equal(skillValidation.status, 0, skillValidation.stderr || skillValidation.stdout);

  const second = runNode(packagePluginScript, ["--output", output]);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(parseJsonOutput(second).changed, false);
});

test("plugin packager protects drift and requires explicit force", (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "gongxu-plugin-test-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const output = join(temporary, "gongxu");
  const packagedSkill = join(output, "skills/bootstrap-ai-project/SKILL.md");

  assert.equal(runNode(packagePluginScript, ["--output", output]).status, 0);
  writeFileSync(packagedSkill, "user drift\n");

  const rejected = runNode(packagePluginScript, ["--output", output]);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /differs from the canonical package/);
  assert.equal(readFileSync(packagedSkill, "utf8"), "user drift\n");

  const forced = runNode(packagePluginScript, ["--output", output, "--force"]);
  assert.equal(forced.status, 0, forced.stderr || forced.stdout);
  assert.equal(parseJsonOutput(forced).changed, true);
  assert.notEqual(readFileSync(packagedSkill, "utf8"), "user drift\n");
  assert.equal(existsSync(join(output, ".codex-plugin/plugin.json")), true);
});

test("plugin packager requires the normalized plugin directory name", () => {
  const result = runNode(packagePluginScript, ["--output", "/tmp/not-gongxu"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be named gongxu/);
});
