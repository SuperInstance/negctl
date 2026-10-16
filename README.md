# negctl

> Negative control for the git.pp conformance suites. Sabotage a port, require the suite to notice, restore. A suite that cannot fail is not evidence.

## Why this exists

Nine green suites in this project could not fail. All the same disease: a
defect in the thing that measures, mistaken for a pass in the thing being
measured.

| # | What the suite was blind to | How it was found |
|---|---|---|
| 1 | `fuzz.mjs` re-serialized records through `JSON.stringify`, losing float64 precision; reported divergences that vanished on a clean re-run | re-running it |
| 2 | `fuzz.mjs` called `json.load()` directly, bypassing the port's decoder, so it kept reporting a divergence **after the port was fixed** | fixing the port and seeing it still fail |
| 3 | a §5.6 case passed vacuously — the field was never in the comparison | reading the runner |
| 4 | the same case, second draft: compared as objects when the value is a JSON **string** | negative control |
| 5 | the same case, third draft: `expected` read as an object when it is a string | negative control |
| 6 | a port with a broken import path **errored on every case**, and the runner filtered erroring ports out of the comparison | noticing the port count |
| 7 | the §5.6 comparison stripped `setters` **values**, so a port returning the inverted-ancestry result compared equal to a correct one | the scout, reading line 148 |
| 8 | `ROOT` hardcoded to a scratch dir, so the suite in the repo was not the suite under test | the scout, following the failure |
| 9 | a gate with no signal routed to `act` — an unreachable model authorised every nudge | writing `route({})` |

Number 9 was not a *conformance* suite, but it is the same failure and it
was caught the same way: ask the thing what it does when it knows nothing.

## How it works

For each sabotage: edit a port so it is provably wrong, run the suite,
require **more failures than baseline**, restore the file, and require the
suite to be green again. A suite that survives a sabotage is telling you
nothing.

```
negative control against gitpp-fold-conformance
  baseline: 26 pass, 0 fail, 0 skip (of 26)
  DETECTED  setters-ancestry-inverted  (pl)  1 failures
  DETECTED  setters-dropped  (js)  1 failures
  restored: 26 pass, 0 fail, 0 skip (of 26)

all sabotages detected; suite restored
```

Note which sabotage caught what:

- **`setters-ancestry-inverted`** breaks §5.2's *direction* — it reports the
  oldest same-class record as the setter. This is the bug class that shipped
  in four ports.
- **`setters-dropped`** breaks §5.6's *presence* requirement — the field is
  omitted entirely.

Those are different clauses and they were caught by different mechanisms.
That is the point: a suite needs a sabotage per clause, not one per suite.

## Adding a sabotage

A sabotage must target **one clause**, chosen so a compliant port must
disagree with the corpus when it is applied. Record why it matters, or a
stale pattern will silently stop testing anything — the runner already
fails loudly when an `edit()` no longer matches its file, because a sabotage
that quietly became a no-op is the same disease again.

```js
{
  id: "orphans-dropped",
  port: "c",
  what: "suppress the orphans list",
  why: "§5.4/§5.5 — cycles and missing-parent records must be reported",
  edit: (s) => ...,
}
```

## Run

```bash
git clone .../gitpp-fold-conformance ../gitpp-fold-conformance
(cd ../gitpp-fold-conformance && dotnet build wrappers/CsDerive)
NEGCTL_ROOT=.. node negctl.mjs
```

Exit 0 means every sabotage was detected and the suite returned to
baseline. Exit 1 means the suite is not trustworthy to pass — fix that
before trusting any result it produces, including this one.

## Limits

- It shells out to the suite; it does not reimplement it. A suite that
  changes its output format makes the control fail closed rather than
  silently pass.
- The baseline must be green. If it is not, there is nothing to compare
  against and the control refuses to run.
- One clause per sabotage. A sabotage that breaks three things tells you
  only that something broke.
