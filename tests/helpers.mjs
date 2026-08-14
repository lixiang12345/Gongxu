import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const skillRoot = join(repositoryRoot, "skills/bootstrap-ai-project");
export const inspectScript = join(skillRoot, "scripts/inspect-project.mjs");
export const compileScript = join(skillRoot, "scripts/compile-project.mjs");
export const validateScript = join(skillRoot, "scripts/validate-project.mjs");

export function createFixture(name) {
  const temporary = mkdtempSync(join(tmpdir(), "gongxu-test-"));
  const root = join(temporary, "repository");
  cpSync(join(repositoryRoot, "tests/fixtures", name), root, { recursive: true });
  return { root, temporary };
}

export function cleanupFixture(fixture) {
  rmSync(fixture.temporary, { recursive: true, force: true });
}

export function loadBlueprint(name = "node-monorepo") {
  return JSON.parse(readFileSync(join(repositoryRoot, `tests/fixtures/blueprints/${name}.json`), "utf8"));
}

export function writeBlueprint(fixture, blueprint, name = "blueprint.json") {
  const path = join(fixture.temporary, name);
  writeFileSync(path, `${JSON.stringify(blueprint, null, 2)}\n`);
  return path;
}

export function runNode(script, args = [], options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd || repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout || 30_000,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error,
  };
}

export function parseJsonOutput(result) {
  if (result.error) throw result.error;
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`Expected JSON command output: ${error.message}\n${output}`);
  }
}

export function compileFixture(fixture, blueprintPath, extraArgs = []) {
  return runNode(compileScript, ["--root", fixture.root, "--blueprint", blueprintPath, ...extraArgs]);
}

export function readFixtureFile(fixture, relativePath) {
  return readFileSync(join(fixture.root, relativePath), "utf8");
}

export function writeFixtureFile(fixture, relativePath, content) {
  writeFileSync(join(fixture.root, relativePath), content);
}

export function fixtureDirectory(path) {
  return dirname(path);
}
