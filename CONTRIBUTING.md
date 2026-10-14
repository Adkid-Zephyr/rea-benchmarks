# Contributing a reproduction or new case

Use an issue to share observations or a pull request to contribute reproducible artifacts. Do not upload credentials, private binaries, personal filesystem paths, model internal reasoning, or assets you cannot redistribute.

For a rerun, add `community-results/<case-id>/<run-id>/` rather than modifying the historical runs. Include exact requested/returned model IDs, date, provider/harness version, settings, budget, all attempts including failures, hardware/browser details, artifact hashes, tool audit without internal reasoning, outputs and evaluation script/measurements. State whether the coordinator supplied advice or edited a solution. Do not compare a best-of-many result to a single historical attempt without labeling it.

For a new reverse-engineering task, add one `benchmarks/<number>-<target>/` directory. Include README, license/target acquisition, frozen prompt and protocol, tool access policy, hidden evaluation setup, model outputs, a same-input comparison image, reproducible commands and limitations. Freeze evaluation before viewing submissions. Separate source-readable, source-hidden and binary tasks. Keep a reference plus contestants visible in comparison images. Do not claim full-engine replication from a narrow feature task.

To test REA's contribution, include matched same-model runs with and without REA; document what alternate tools each condition receives. Merely comparing three models using REA is not such an ablation.

Before submitting: `pip install -r requirements.txt` then `python3 scripts/verify.py`. The repository integrity manifest covers the original release only; changes to frozen case files require an explicit new version and rationale, not silent checksum updates.
