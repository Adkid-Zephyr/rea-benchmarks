# 001 — WebGL Fluid reconstruction pilot

[Interactive result](web/index.html) · [Report](REPORT.md) · [Frozen prompt](PROMPT.txt) · [Frozen protocol](PROTOCOL.md)

One original run per model: `k3`, `grok-4.7` (returned `grok-4.7-build`), `gpt-6.1-sol`. Original collection: 2026-10-13. Same tools and prompt; 18 turns / 32,000 reported completion tokens / 900 seconds per run. Reasoning effort `high` was requested, not verified internally across providers.

## Files

- `reference/`: frozen deployed script and its MIT license. `dat.gui.min.js` is not distributed because the reference adapter does not invoke the GUI; its historical acquisition digest remains in the source manifest.
- `runs/<model>/`: unchanged final submission, summary, short test result, all code revisions, redacted `audit.jsonl`.
- `web/`: standalone comparison, deterministic event sequences, PNGs and video.
- `evidence/`: published measurements, source and protocol identities, non-canonical REA summary.
- `scripts/`: portable versions of the browser checks, evaluator and opt-in model harness.

`PROTOCOL.md` is the original frozen document and still says RUNNING; the completed historical state is in `STATUS.json` and `REPORT.md`. Historical `protocol-hashes.json` refers to the original local runner, not the portable public runner. Public `SHA256SUMS.json` authenticates the distributed files. It is an integrity manifest, not a digital signature.

The historical `artifact_read.sha256` was a newline-normalized text digest, not the raw download hash. Use `evidence/source-manifest.json` for source byte identity. This issue is disclosed in the report.

## Run your own model (explicit opt-in)

Install Python dependencies and Playwright as described in the root README. Generate fresh REA evidence using the **same REA version** (the full private evidence, containing local paths, is not published):

```sh
cd benchmarks/001-webgl-fluid
npx --yes rea-agents@6.4.0 analyze-javascript-application "$PWD/reference" --source-path script.js --format json > evidence/rea-analysis.json
```

The public reference inventory omits the unused GUI vendor file, so the newly generated inventory digest differs from the historical inventory. `script.js` remains byte-identical; record the new evidence identity rather than pretending it is historical.

Use your own OpenAI-compatible Chat Completions endpoint with tool calling. Each model must be available at that endpoint; do not silently substitute another model. Supply credentials through environment variables, never commits:

```sh
export BENCH_BASE_URL='https://YOUR-ENDPOINT/v1'
# Set BENCH_API_KEY through your secret manager or shell environment.
export BENCH_MODELS='YOUR-EXACT-MODEL-ID'
export BENCH_OUTPUT="$PWD/local-runs/my-trial"
python3 scripts/run_models.py
```

The default output is `local-runs/`; existing model directories are refused. Defaults preserve the historical requested three model names. Do not run without intending to consume your own provider allowance. Provider payload compatibility may vary; errors are retained, and no model substitutions are attempted. The portable API runner has only received syntax/local checks, **not a new paid model run**.

To inspect a fresh engine, run `node scripts/check.cjs local-runs/my-trial/YOUR-EXACT-MODEL-ID/index.html` (paths with spaces must be quoted). For full new-run evaluation, set `BENCH_SUBMISSIONS` to your absolute run directory and `BENCH_EVAL_OUTPUT` to a fresh absolute result directory, then run `node scripts/evaluate.cjs reference YOUR-EXACT-MODEL-ID`. The same frozen scenarios are used. Compare the resulting PNGs against the reference rendered in that same invocation; do not assume cross-machine pixel identity. Never overwrite historical submissions.

## What this case does not establish

No binary decompilation; no REA-off ablation; no general ability ranking. Model pretraining familiarity with the public source is unknown. Reading the deployed source and reusing shader equations were allowed. Hidden-input evaluation means the exact event list was not given to contestants, not that all tested operations were unknown to them. Host/GPU differences can change pixels. Reference startup GL error 1281 was isolated and recorded; simulation errors were zero in the historical run.
