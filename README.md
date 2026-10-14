# REA Benchmarks

Independent, reproducible visual reconstruction experiments with [REA](https://github.com/morluto/rea) and coding models. **Not an official REA benchmark or a general model leaderboard.**

[中文说明](README.zh-CN.md) · [Interactive comparison](https://adkid-zephyr.github.io/rea-benchmarks/benchmarks/001-webgl-fluid/web/) · [Add a result](CONTRIBUTING.md)

## Cases

| Case | Target | Status | What it tests |
|---|---|---|---|
| [001 · WebGL Fluid](benchmarks/001-webgl-fluid/) | Pavel Dobryakov's WebGL Fluid Simulation | Completed pilot; one run/model | Readable JavaScript artifact analysis and reconstruction |

![Same input at 4 seconds: original, Kimi K3, Grok 4.7, GPT 6.1 Sol](benchmarks/001-webgl-fluid/web/comparison-main-240.png)

[Watch the synchronized video](https://adkid-zephyr.github.io/rea-benchmarks/benchmarks/001-webgl-fluid/web/comparison.mp4)

**Pilot finding:** Kimi K3 and Grok 4.7 matched the reference RGB pixels at all ten sampled frames. GPT 6.1 Sol completed sooner but diverged visually. All three ran successfully. This is a narrow observation on this machine and these inputs, not proof of general equivalence or superiority.

**Important limitation:** this first case allowed reading the shipped JavaScript and short shader equations. Its instructions supplied the functional scope and key settings. It is a low-discrimination reconstruction pilot, not a source-hidden binary reverse-engineering test. No REA-off control was run, so it does not establish REA's incremental benefit. Future cases may use different protocols; results should not be pooled indiscriminately.

## View locally — no API key needed

```sh
git clone https://github.com/Adkid-Zephyr/rea-benchmarks.git
cd rea-benchmarks
python3 -m http.server 8080
```

Open `http://localhost:8080/benchmarks/001-webgl-fluid/web/`. Includes synchronized playback, interactive stirring, two scenarios and original snapshots. Model engines execute in your browser; no model API calls are made by this viewer.

## Check the published result

```sh
python3 -m venv .venv
# macOS/Linux; Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r requirements.txt
python scripts/verify.py
```

This verifies hashes, computes errors from the committed PNGs, and checks the published audit. It does **not** rerun inference or establish provenance beyond the published records.

To execute the submitted engines again in a browser:

```sh
npm ci
npx playwright install chromium
node benchmarks/001-webgl-fluid/scripts/evaluate.cjs reference reference-repeat k3 grok-4.7 gpt-6.1-sol
```

Linux may need `npx playwright install --with-deps chromium`. Set `BROWSER_EXECUTABLE` to use an installed Chrome. Rendered pixels may differ across browser/GPU/platform versions. Fresh renders go to ignored `evidence/evaluation/`; committed snapshots are not replaced.

For new model runs, see the [case instructions](benchmarks/001-webgl-fluid/README.md). API usage is opt-in and may consume your provider allowance.

## Experiment ownership

The coordinating model sets up the environment and performs the final evaluation. Contestants may inspect artifacts and self-test within the frozen budget. The coordinator must not write their solutions, return hidden evaluation results, or suggest repairs. Preserve failures and all attempts. A screenshot illustrates a result; hidden behavioral tests establish whether the reconstruction generalizes.

One case per `benchmarks/<number>-<target>/` folder. Keep its prompt, protocol, inputs, model identity, outputs, audits and limitations together. [Contribution rules](CONTRIBUTING.md).

## Licensing and disclosure

Harness/documentation: MIT. The fluid reference and adapted shader equations retain Pavel Dobryakov's MIT license and notices; see [third-party notices](THIRD_PARTY_NOTICES.md). Individual files retain applicable notices. No affiliation or endorsement by REA or model providers is implied.

Private credentials, local account configuration, model internal reasoning and full private transcripts are excluded. Public audits retain tool calls, test feedback, revisions, model identifiers and usage metadata. The REA evidence summary is explicitly non-canonical; regenerate analysis for new runs. See the [case report](benchmarks/001-webgl-fluid/REPORT.md) for known recording limitations.
