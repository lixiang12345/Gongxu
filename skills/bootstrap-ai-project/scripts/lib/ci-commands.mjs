function parseRunLine(line) {
  const match = line.match(/^(\s*)(-\s+)?run:\s*(.*?)\s*$/);
  if (!match) return null;
  return {
    keyIndent: match[1].length + (match[2]?.length || 0),
    value: match[3],
  };
}

function blockScalarKind(value) {
  const normalized = value.replace(/\s+#.*$/, "").trim();
  if (!normalized.startsWith("|") && !normalized.startsWith(">")) return null;
  return /^[|>](?:(?:[1-9][+-]?)|(?:[+-][1-9]?))?$/.test(normalized) ? "supported" : "unsupported";
}

export function extractCiRunCommands(path, content) {
  const candidates = [];
  const warnings = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const run = parseRunLine(lines[index]);
    if (!run || !run.value) continue;
    const runLine = index + 1;
    const scalarKind = blockScalarKind(run.value);
    if (scalarKind === null) {
      candidates.push({
        command: run.value.replace(/^['"]|['"]$/g, ""),
        status: "observed",
        source: { path, pointer: `line:${index + 1}`, note: "CI run command" },
      });
      continue;
    }

    const commands = [];
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const indentation = line.match(/^ */)?.[0].length || 0;
      if (indentation <= run.keyIndent) break;
      if (trimmed.startsWith("#")) continue;
      commands.push({ command: trimmed, line: cursor + 1 });
    }
    index = cursor - 1;

    if (scalarKind === "unsupported") {
      warnings.push(`Unsupported CI run block header at ${path}:line:${runLine}; inspect the source manually.`);
    } else if (commands.length === 1) {
      candidates.push({
        command: commands[0].command,
        status: "observed",
        source: { path, pointer: `line:${commands[0].line}`, note: "Single-command CI run block" },
      });
    } else {
      warnings.push(`CI run block at ${path}:line:${runLine} is not one exact command; inspect the source manually.`);
    }
  }

  return { candidates, warnings };
}
