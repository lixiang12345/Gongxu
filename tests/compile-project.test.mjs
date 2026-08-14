import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  cleanupFixture,
  compileFixture,
  createFixture,
  loadBlueprint,
  parseJsonOutput,
  readFixtureFile,
  runNode,
  validateScript,
  writeBlueprint,
  writeFixtureFile,
} from "./helpers.mjs";

function initialize(t) {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));
  const blueprintPath = writeBlueprint(fixture, loadBlueprint());
  const result = compileFixture(fixture, blueprintPath);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { fixture, blueprintPath, summary: parseJsonOutput(result) };
}

test("compiler previews, initializes, validates, and exposes thin adapters", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));
  const blueprintPath = writeBlueprint(fixture, loadBlueprint());

  const preview = compileFixture(fixture, blueprintPath, ["--dry-run"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(existsSync(join(fixture.root, ".ai")), false);
  assert.ok(parseJsonOutput(preview).counts.create > 0);

  const compile = compileFixture(fixture, blueprintPath);
  assert.equal(compile.status, 0, compile.stderr || compile.stdout);
  const summary = parseJsonOutput(compile);
  assert.equal(summary.ok, true);
  assert.ok(summary.actions.some((action) => action.path === ".ai/project/profile.md"));

  const agents = readFixtureFile(fixture, "AGENTS.md");
  assert.match(agents, /# Fixture Team Notes/);
  assert.equal((agents.match(/<!-- gongxu:begin -->/g) || []).length, 1);
  assert.equal((agents.match(/<!-- gongxu:end -->/g) || []).length, 1);

  const claude = readFixtureFile(fixture, "CLAUDE.md");
  assert.match(claude, /# Fixture Claude Notes/);
  assert.match(claude, /@AGENTS\.md/);
  assert.ok(existsSync(join(fixture.root, ".agents/skills/gongxu-change-workspace-feature/SKILL.md")));
  assert.ok(existsSync(join(fixture.root, ".claude/skills/gongxu-change-workspace-feature/SKILL.md")));

  const manifest = JSON.parse(readFixtureFile(fixture, ".ai/manifest.json"));
  assert.equal(manifest.managedFiles.some((entry) => entry.path === ".ai/blueprint.json"), false);
  assert.ok(manifest.managedFiles.some((entry) => entry.path === "AGENTS.md" && entry.ownership === "region"));

  const validation = runNode(validateScript, [fixture.root]);
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  assert.equal(parseJsonOutput(validation).ok, true);

  const runner = runNode(join(fixture.root, ".ai/verification/run.mjs"), ["--check", "project-test"], { cwd: fixture.root });
  assert.equal(runner.status, 0, runner.stderr || runner.stdout);
  assert.match(runner.stdout, /\[gongxu\] project-test: PASS/);

  const missingCheckId = runNode(join(fixture.root, ".ai/verification/run.mjs"), ["--check"], { cwd: fixture.root });
  assert.equal(missingCheckId.status, 2);
  assert.match(missingCheckId.stderr, /requires a check id/);
});

test("recompilation is idempotent and preserves user-owned instruction content", (t) => {
  const { fixture, blueprintPath } = initialize(t);
  const manifestBefore = readFixtureFile(fixture, ".ai/manifest.json");
  const userAppend = "\n## Local Override\n\nKeep this exact user-authored suffix.\n";
  appendFileSync(join(fixture.root, "AGENTS.md"), userAppend);

  const second = compileFixture(fixture, blueprintPath);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const summary = parseJsonOutput(second);
  assert.deepEqual(summary.actions, []);
  assert.equal(readFixtureFile(fixture, ".ai/manifest.json"), manifestBefore);
  assert.ok(readFixtureFile(fixture, "AGENTS.md").endsWith(userAppend));
  assert.match(readFixtureFile(fixture, "CLAUDE.md"), /@AGENTS\.md/);

  const third = compileFixture(fixture, blueprintPath);
  assert.equal(third.status, 0, third.stderr || third.stdout);
  assert.deepEqual(parseJsonOutput(third).actions, []);
  assert.match(readFixtureFile(fixture, "CLAUDE.md"), /@AGENTS\.md/);
});

test("managed drift requires an exact force path", (t) => {
  const { fixture, blueprintPath } = initialize(t);
  const profilePath = ".ai/project/profile.md";
  const original = readFixtureFile(fixture, profilePath);
  writeFixtureFile(fixture, profilePath, original.replace("Fixture Workspace", "Drifted Workspace"));

  const rejected = compileFixture(fixture, blueprintPath);
  assert.equal(rejected.status, 1);
  assert.deepEqual(parseJsonOutput(rejected).conflicts.map((item) => item.path), [profilePath]);
  assert.match(readFixtureFile(fixture, profilePath), /Drifted Workspace/);

  const wrongPath = compileFixture(fixture, blueprintPath, ["--force-path", ".ai/project/repo-map.md"]);
  assert.equal(wrongPath.status, 1);
  assert.deepEqual(parseJsonOutput(wrongPath).conflicts.map((item) => item.path), [profilePath]);

  const forced = compileFixture(fixture, blueprintPath, ["--force-path", profilePath]);
  assert.equal(forced.status, 0, forced.stderr || forced.stdout);
  assert.ok(parseJsonOutput(forced).actions.some((action) => action.path === profilePath && action.forced));
  assert.equal(readFixtureFile(fixture, profilePath), original);
});

test("compiler rolls back earlier writes when a later managed write fails", (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    t.skip("permission failure injection requires a non-root POSIX process");
    return;
  }
  const { fixture } = initialize(t);
  const agentsPath = join(fixture.root, "AGENTS.md");
  chmodSync(agentsPath, 0o764);
  const preservedPaths = [
    ".ai/blueprint.json",
    ".ai/project/profile.md",
    ".ai/manifest.json",
    "AGENTS.md",
    ".ai/skills/change-workspace-feature/SKILL.md",
    ".agents/skills/gongxu-change-workspace-feature/SKILL.md",
    ".claude/skills/gongxu-change-workspace-feature/SKILL.md",
  ];
  const before = new Map(preservedPaths.map((path) => [path, readFixtureFile(fixture, path)]));
  const updated = loadBlueprint();
  updated.project.summary = "A summary that would update an early generated view.";
  updated.skills[0].id = "change-workspace-feature-v2";
  const updatedPath = writeBlueprint(fixture, updated, "rollback-blueprint.json");
  const blockedDirectory = join(fixture.root, ".claude/skills");
  const originalMode = statSync(blockedDirectory).mode & 0o7777;

  chmodSync(blockedDirectory, 0o555);
  let result;
  try {
    result = compileFixture(fixture, updatedPath);
  } finally {
    chmodSync(blockedDirectory, originalMode);
  }

  assert.equal(result.status, 1);
  assert.match(result.stderr, /All attempted file changes were rolled back/);
  for (const path of preservedPaths) assert.equal(readFixtureFile(fixture, path), before.get(path), path);
  assert.equal(statSync(agentsPath).mode & 0o7777, 0o764);
  for (const path of [
    ".ai/skills/change-workspace-feature-v2",
    ".agents/skills/gongxu-change-workspace-feature-v2",
    ".claude/skills/gongxu-change-workspace-feature-v2",
  ]) {
    assert.equal(existsSync(join(fixture.root, path)), false, path);
  }
  assert.equal(readdirSync(blockedDirectory).some((name) => name.endsWith(".tmp")), false);

  const validation = runNode(validateScript, [fixture.root]);
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
});

test("compiler removes obsolete generated artifacts while retaining Claude user content", (t) => {
  const { fixture } = initialize(t);
  const canonicalSkill = ".ai/skills/change-workspace-feature/SKILL.md";
  appendFileSync(join(fixture.root, canonicalSkill), "\nUser-managed drift.\n");
  const updated = loadBlueprint();
  updated.skills = [];
  updated.examples = [];
  updated.adapters = ["codex"];
  const updatedPath = writeBlueprint(fixture, updated, "updated-blueprint.json");

  const rejected = compileFixture(fixture, updatedPath);
  assert.equal(rejected.status, 1);
  assert.ok(parseJsonOutput(rejected).conflicts.some((item) => item.path === canonicalSkill));
  assert.ok(existsSync(join(fixture.root, canonicalSkill)));

  const result = compileFixture(fixture, updatedPath, ["--force-path", canonicalSkill]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = parseJsonOutput(result);
  assert.ok(summary.actions.some((action) => action.type === "delete" && action.path === ".ai/skills/change-workspace-feature/SKILL.md"));
  assert.equal(existsSync(join(fixture.root, ".ai/examples/catalog.json")), false);
  assert.equal(existsSync(join(fixture.root, ".agents/skills/gongxu-change-workspace-feature/SKILL.md")), false);
  assert.equal(existsSync(join(fixture.root, ".claude/skills/gongxu-change-workspace-feature/SKILL.md")), false);

  const claude = readFixtureFile(fixture, "CLAUDE.md");
  assert.match(claude, /# Fixture Claude Notes/);
  assert.equal(claude.includes("gongxu:begin"), false);

  const validation = runNode(validateScript, [fixture.root]);
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
});

test("region drift is reported, optionally tolerated for migration, and never overwritten implicitly", (t) => {
  const { fixture, blueprintPath } = initialize(t);
  const original = readFixtureFile(fixture, "AGENTS.md");
  const drifted = original.replace("Inspect the existing implementation", "Skip inspection of the existing implementation");
  writeFixtureFile(fixture, "AGENTS.md", drifted);

  const strict = runNode(validateScript, [fixture.root]);
  assert.equal(strict.status, 1);
  assert.ok(parseJsonOutput(strict).drift.some((item) => item.path === "AGENTS.md"));

  const migration = runNode(validateScript, [fixture.root, "--allow-drift"]);
  assert.equal(migration.status, 0, migration.stderr || migration.stdout);
  assert.equal(parseJsonOutput(migration).ok, true);

  const rejected = compileFixture(fixture, blueprintPath);
  assert.equal(rejected.status, 1);
  assert.ok(parseJsonOutput(rejected).conflicts.some((item) => item.path === "AGENTS.md"));
  assert.equal(readFixtureFile(fixture, "AGENTS.md"), drifted);

  const forced = compileFixture(fixture, blueprintPath, ["--force-path", "AGENTS.md"]);
  assert.equal(forced.status, 0, forced.stderr || forced.stdout);
  assert.equal(readFixtureFile(fixture, "AGENTS.md"), original);
});

test("validator reports managed symlinks without an uncaught stack", (t) => {
  const { fixture } = initialize(t);
  const profilePath = join(fixture.root, ".ai/project/profile.md");
  const outsidePath = join(fixture.temporary, "outside-profile.md");
  writeFileSync(outsidePath, "outside content\n");
  rmSync(profilePath);
  symlinkSync(outsidePath, profilePath);

  const result = runNode(validateScript, [fixture.root]);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
  const report = parseJsonOutput(result);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes("symbolic link")));
  assert.equal(readFileSync(outsidePath, "utf8"), "outside content\n");
});

test("validator enforces the complete manifest contract", (t) => {
  const { fixture } = initialize(t);
  const manifestPath = join(fixture.root, ".ai/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.sourceRevision = "unexpected-revision";
  manifest.humanOwnedPaths = [".ai/blueprint.json"];
  manifest.unexpected = true;
  manifest.managedFiles[0].unexpected = true;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = runNode(validateScript, [fixture.root]);
  assert.equal(result.status, 1);
  const report = parseJsonOutput(result);
  assert.ok(report.errors.includes("Manifest sourceRevision does not match the blueprint."));
  assert.ok(report.errors.includes("Manifest humanOwnedPaths do not match the Gongxu ownership contract."));
  assert.ok(report.errors.includes("manifest.unexpected is not supported."));
  assert.ok(report.errors.some((error) => error.includes("managedFiles[0].unexpected is not supported")));
});

test("compiler and validator reject manifest claims on user-owned files", (t) => {
  const { fixture, blueprintPath } = initialize(t);
  const userFilePath = join(fixture.root, "package.json");
  const userFile = readFileSync(userFilePath, "utf8");
  const manifestPath = join(fixture.root, ".ai/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.managedFiles.push({
    path: "package.json",
    ownership: "file",
    sha256: createHash("sha256").update(userFile).digest("hex"),
  });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const validation = runNode(validateScript, [fixture.root]);
  assert.equal(validation.status, 1);
  assert.ok(parseJsonOutput(validation).errors.some((error) =>
    error.includes("not a supported Gongxu managed artifact: package.json")
  ));

  const compile = compileFixture(fixture, blueprintPath);
  assert.equal(compile.status, 1);
  assert.match(compile.stderr, /claims an unsupported managed artifact: package\.json/);
  assert.equal(readFileSync(userFilePath, "utf8"), userFile);
});

test("verification runner refuses a cwd redirected outside the repository", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));
  const blueprint = loadBlueprint();
  blueprint.verification[0].cwd = "apps/web";
  blueprint.verification[0].command = "node -e \"require('node:fs').writeFileSync('executed.txt','yes')\"";
  blueprint.evidence.answers.push({
    id: "answer-containment-test-command",
    question: "What exact test command exercises working-directory containment?",
    answer: blueprint.verification[0].command,
  });
  blueprint.verification[0].source = {
    kind: "interview",
    path: "answer-containment-test-command",
    note: "The test fixture explicitly confirms this exact containment probe.",
  };
  const blueprintPath = writeBlueprint(fixture, blueprint);
  const compile = compileFixture(fixture, blueprintPath);
  assert.equal(compile.status, 0, compile.stderr || compile.stdout);

  const outside = join(fixture.temporary, "outside-check-directory");
  mkdirSync(outside);
  rmSync(join(fixture.root, "apps/web"), { recursive: true });
  symlinkSync(outside, join(fixture.root, "apps/web"));

  const runner = runNode(join(fixture.root, ".ai/verification/run.mjs"), ["--check", "project-test"], { cwd: fixture.root });
  assert.equal(runner.status, 1);
  assert.match(runner.stderr, /working directory resolves outside the repository/);
  assert.equal(existsSync(join(outside, "executed.txt")), false);
});

test("compiler refuses unowned AI content, wrapper collisions, and symlink traversal", async (t) => {
  await t.test("unowned .ai content", (t) => {
    const fixture = createFixture("node-monorepo");
    t.after(() => cleanupFixture(fixture));
    const blueprintPath = writeBlueprint(fixture, loadBlueprint());
    mkdirSync(join(fixture.root, ".ai"));
    writeFileSync(join(fixture.root, ".ai/user-notes.md"), "user owned\n");

    const result = compileFixture(fixture, blueprintPath);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /user-owned content/);
  });

  await t.test("unowned adapter collision", (t) => {
    const fixture = createFixture("node-monorepo");
    t.after(() => cleanupFixture(fixture));
    const blueprintPath = writeBlueprint(fixture, loadBlueprint());
    const collision = join(fixture.root, ".agents/skills/gongxu-change-workspace-feature");
    mkdirSync(collision, { recursive: true });
    writeFileSync(join(collision, "SKILL.md"), "user owned\n");

    const result = compileFixture(fixture, blueprintPath);
    assert.equal(result.status, 1);
    assert.ok(parseJsonOutput(result).conflicts.some((item) => item.path.includes("gongxu-change-workspace-feature")));
  });

  await t.test("managed path symlink", (t) => {
    const fixture = createFixture("node-monorepo");
    t.after(() => cleanupFixture(fixture));
    const blueprintPath = writeBlueprint(fixture, loadBlueprint());
    const outside = join(fixture.temporary, "outside-ai");
    mkdirSync(outside);
    symlinkSync(outside, join(fixture.root, ".ai"));

    const result = compileFixture(fixture, blueprintPath);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /symbolic link/);
    assert.equal(existsSync(join(outside, "manifest.json")), false);
  });
});

test("force-path rejects missing values and non-managed paths", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));
  const blueprintPath = writeBlueprint(fixture, loadBlueprint());

  const missing = compileFixture(fixture, blueprintPath, ["--force-path"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /requires a value/);

  const broad = compileFixture(fixture, blueprintPath, ["--force-path", ".ai"]);
  assert.equal(broad.status, 2);
  assert.match(broad.stderr, /does not match a managed file/);
});

test("compiler reports invalid blueprint JSON and structure without an uncaught stack", (t) => {
  const fixture = createFixture("node-monorepo");
  t.after(() => cleanupFixture(fixture));
  const invalidJsonPath = join(fixture.temporary, "invalid.json");
  writeFileSync(invalidJsonPath, "{ invalid json\n");

  const invalidJson = compileFixture(fixture, invalidJsonPath);
  assert.equal(invalidJson.status, 1);
  assert.match(invalidJson.stderr, /Cannot parse blueprint JSON/);
  assert.doesNotMatch(invalidJson.stderr, /\n\s+at /);

  const invalidBlueprint = loadBlueprint();
  invalidBlueprint.rules = [null];
  const invalidBlueprintPath = writeBlueprint(fixture, invalidBlueprint, "invalid-structure.json");
  const invalidStructure = compileFixture(fixture, invalidBlueprintPath);
  assert.equal(invalidStructure.status, 1);
  const report = JSON.parse(invalidStructure.stderr);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes("rules[0] must be an object")));

  const markerBlueprint = loadBlueprint();
  markerBlueprint.project.summary = "Unsafe <!-- gongxu:end --> marker";
  const markerPath = writeBlueprint(fixture, markerBlueprint, "reserved-marker.json");
  const reservedMarker = compileFixture(fixture, markerPath);
  assert.equal(reservedMarker.status, 1);
  assert.match(reservedMarker.stderr, /reserved Gongxu managed marker/);
  assert.equal(existsSync(join(fixture.root, ".ai")), false);
});
