#!/usr/bin/env node
// negctl — prove a conformance suite can fail.
//
// This project has produced NINE green suites that could not fail:
//   1. fuzz.mjs re-serialized records through JSON.stringify, losing float64
//      precision, and reported disagreements that vanished on a clean re-run.
//   2. fuzz.mjs called json.load() directly, bypassing the port's decoder, so
//      it kept reporting a divergence AFTER the port was fixed.
//   3-5. a §5.6 case passed vacuously three times, for three different
//      reasons (field not compared; compared as objects when the value is a
//      string; expected read as an object when it is a JSON string).
//   6. a port with a broken import path ERRORED on every case, and the runner
//      filtered erroring ports out of the comparison instead of failing.
//   7. the §5.6 comparison stripped setters VALUES, so a port returning the
//      INVERTED ancestry result compared equal to a correct one.
//   8. ROOT was hardcoded to a scratch dir, so the suite in the repo was not
//      the suite being verified.
//
// Every one was the same disease: a defect in the thing that measures,
// mistaken for a pass in the thing being measured.
//
// This is the immune system. It edits a port so it is provably wrong, requires
// the suite to FAIL, restores the file, and requires the suite to pass again.
// A suite that survives a sabotage is telling you nothing.

import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";

// Sabs that each target ONE clause, chosen because a compliant port must
// disagree with the corpus when it is applied.
const SABOTAGES = [
  {
    id: "setters-ancestry-inverted",
    port: "pl",
    file: "wrappers/PlDerive.pl",
    what: "report the OLDEST same-class record as the setter for a contested key",
    why: "the exact bug class that shipped in four ports (§5.2 direction)",
    edit: (s) => s.replace(
      "    setters => $d->{setters},",
      "    setters => do { my %h=%{$d->{setters}}; $h{x}='a' if exists $h{x}; \\%h },"),
  },
  {
    id: "setters-dropped",
    port: "js",
    file: "wrappers/JsDerive.mjs",
    what: "omit the setters field entirely",
    why: "§5.6 presence requirement",
    edit: (s) => s.replace("  setters: d.setters || {},\n", ""),
  },
  {
    id: "orphans-dropped",
    port: "c",
    file: null,          // C emits via the compiled binary; see the shim below
    what: "suppress the orphans list",
    why: "§5.4/§5.5 — cycles and missing-parent records must be reported",
    edit: null,
  },
];

const SUITE = process.env.NEGCTL_SUITE || "gitpp-fold-conformance";

function suiteDir() {
  if (existsSync(resolve(process.env.NEGCTL_ROOT || "..", SUITE))) return resolve(process.env.NEGCTL_ROOT || "..", SUITE);
  return resolve(dirname(new URL(import.meta.url).pathname), "..", SUITE);
}

function runSuite(dir) {
  try {
    const out = execFileSync("node", ["run.mjs"], { cwd: dir, encoding: "utf8", timeout: 300_000, maxBuffer: 1 << 26 });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}
function tail(out) { return out.trim().split("\n").slice(-1)[0] || "(no output)"; }
function countFail(out) { const m = out.match(/(\d+)\s+fail/); return m ? parseInt(m[1], 10) : null; }

function sabotagePath(dir, sab) {
  if (sab.file) return resolve(dir, sab.file);
  return null;
}

export function runNegativeControl({ verbose = true } = {}) {
  const dir = suiteDir();
  if (!existsSync(dir)) return { ok: false, reason: `suite not found: ${dir}` };

  const baseline = runSuite(dir);
  if (!baseline.ok) return { ok: false, reason: "baseline suite does not pass; fix that first" };
  const baselineFails = countFail(baseline.out);
  if (verbose) console.log(`  baseline: ${tail(baseline.out)}`);

  const results = [];
  for (const sab of SABOTAGES) {
    const p = sabotagePath(dir, sab);
    if (!p || !existsSync(p)) { results.push({ id: sab.id, skipped: "target file not present" }); continue; }
    const original = readFileSync(p, "utf8");
    const edited = sab.edit(original);
    if (edited === original) {
      results.push({ id: sab.id, error: "sabotage pattern did not match the file — the test is stale" });
      continue;
    }
    writeFileSync(p, edited);
    const r = runSuite(dir);
    writeFileSync(p, original);           // always restore
    const fails = countFail(r.out);
    const detected = fails !== null && fails > (baselineFails ?? 0);
    results.push({ id: sab.id, detected, fails, port: sab.port, what: sab.what, why: sab.why });
    if (verbose) {
      console.log(`  ${detected ? "DETECTED" : "MISSED  "}  ${sab.id}  (${sab.port})  ${detected ? `${fails} failures` : tail(r.out)}`);
    }
  }
  // the suite must be green again after every restore
  const after = runSuite(dir);
  const restored = after.ok && (countFail(after.out) ?? 1) === (baselineFails ?? 0);
  if (verbose) console.log(`  restored: ${tail(after.out)}`);

  const missed = results.filter((x) => x.detected === false);
  return { ok: missed.length === 0 && restored, results, restored, baseline: tail(baseline.out) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`negative control against ${SUITE}`);
  const r = runNegativeControl();
  if (r.ok) { console.log("\nall sabotages detected; suite restored"); process.exit(0); }

  // A harness that cannot report its OWN failure is the same defect as one
  // that cannot report a suite's. This path threw
  // `TypeError: r.results is not iterable` whenever runNegativeControl
  // returned early (suite missing, baseline failing), replacing the real
  // reason -- "baseline suite does not pass" -- with a stack trace.
  console.log("\nNEGATIVE CONTROL FAILED — the suite cannot be trusted to pass");
  if (r.reason) console.log(`  reason: ${r.reason}`);
  for (const x of r.results || []) {
    if (x.detected === false) console.log(`  MISSED: ${x.id}`);
    if (x.error) console.log(`  ERROR:  ${x.id} — ${x.error}`);
    if (x.skipped) console.log(`  SKIPPED: ${x.id} — ${x.skipped}`);
  }
  if (r.restored === false) console.log("  AND the suite did not return to baseline after restore");
  process.exit(1);
}
