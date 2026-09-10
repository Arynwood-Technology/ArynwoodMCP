#!/usr/bin/env node
// Fails CI only if lint problems exceed the tracked baseline — not on the baseline
// itself, and not silently (see CLAUDE.md's frontend-overhaul note: ~108
// pre-existing problems is a known, deliberately-not-yet-fixed baseline, not
// something CI should either block on or quietly ignore forever). Bump
// BASELINE_FILE's number deliberately when you've actually reduced it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const baselineFile = path.join(frontendRoot, ".eslint-baseline");
const baseline = parseInt(readFileSync(baselineFile, "utf8").trim(), 10);

const eslintBin = path.join(frontendRoot, "node_modules", ".bin", "eslint");
let output;
try {
  output = execFileSync(eslintBin, [".", "--format", "json"], {
    cwd: frontendRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });
} catch (e) {
  // eslint exits non-zero when it finds any problems at all — that's expected
  // here, the actual output (on stdout) is what we need, not the exit code.
  output = e.stdout;
}

const results = JSON.parse(output);
const total = results.reduce((sum, f) => sum + f.errorCount + f.warningCount, 0);

if (total > baseline) {
  console.error(`lint: ${total} problems, baseline is ${baseline} — ${total - baseline} new problem(s) introduced.`);
  console.error(`Run "npm run lint" to see them. If they're real, fix them. If the baseline itself dropped, update frontend/.eslint-baseline deliberately.`);
  process.exit(1);
}

if (total < baseline) {
  console.log(`lint: ${total} problems — improved from the tracked baseline of ${baseline}! Update frontend/.eslint-baseline to ${total} to lock in the improvement.`);
} else {
  console.log(`lint: ${total} problems, matches tracked baseline (${baseline}). Not blocking, not silently ignored.`);
}
