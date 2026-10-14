# REA 彩色流体三模型试跑

Status: RUNNING. Date: 2026-10-13 Europe/London.

Single target, one independent run per model; exploratory demo, not a general model ranking. Requested models: k3, grok-4.7, gpt-6.1-sol. Same local Python tool-loop harness through existing Quotio localhost proxy; returned model names and actual usage logged. Provider-injected prompts/routing may differ; not an equal-internal-compute experiment. reasoning_effort=high requested uniformly; provider enforcement not assumed. No direct-pay account creation, upgrade or purchase.

Frozen shipped artifact downloaded from official GitHub Pages, not repository source checkout. Source SHA256 in evidence/source-manifest.json. Real REA 6.4.0 analysis is cached once identically for all models. Each model can query the cached REA observations and original artifact line ranges; no arbitrary filesystem/network access. This tests JavaScript artifact analysis and reconstruction, not binary decompilation, and does not isolate REA's causal benefit. Familiarity with public source is an unavoidable contamination risk.

PROMPT.txt is identical. Tools: rea_evidence, artifact_read, write_engine, test_engine. Limits per run: 18 model turns, 32000 completion tokens (including reported reasoning), 900s wall time. No human repairs to model outputs. Harness fixes, if required, documented and applied equally. Runs execute concurrently but browser test calls serialized to reduce contention; wall time not a hardware-controlled speed ranking.

Reference core solver is unchanged. Adapter removes ads, GUI invocation, random initial splats, autonomous loop and listeners; uses deterministic external commands. Bloom/sunrays disabled, dye resolution512, sim128, shading on. Original license retained. No claim to full original visual fidelity with postprocessing disabled.

Evaluate same deterministic event sequence, fixed dt=1/60, 640x400, same browser/device. Canonical event lists and config variants generated before reading submissions. Main sequence: circular splats, zigzag, opposing colored flows then decay. Additional held-out sequence changes CURL/dissipation/radius and motion. Report runtime failures, pixel-distance snapshots, qualitative visual differences; don't claim timing alignment alone proves solver equivalence. Pixel differences are descriptive, no arbitrary weighted leaderboard. Run original twice as determinism control; blank-output and reset checks. Record raw outputs/hashes, usage/time and check results. Default initial deliverable is four-panel interactive comparator plus captured visual and report.
