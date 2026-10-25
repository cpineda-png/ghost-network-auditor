# Sponsor tech

- **Zetaris** — federated SQL over JDBC on the host (port 10000), not in Compose. The gateway loads the driver at runtime from `/drivers`.
- **Meterless** — H-MEM and World Model are vendored under `services/agents/vendor/`. Adapter mapping: [meterless-adapters.md](meterless-adapters.md). Nightshift is the OpenAI-compatible proxy in front of NVIDIA Nemotron. Agents call Nightshift at `NIGHTSHIFT_BASE_URL` (default `http://127.0.0.1:8088/v1`) with header `meterless-app: ghost-network-auditor`. They do not call `integrate.api.nvidia.com`.
- **NVIDIA Nemotron** — planner and worker models (`NEMOTRON_PLANNER_MODEL`, `NEMOTRON_WORKER_MODEL`) are the IDs Nightshift lists. Ultra is the planner, arbiter, and critic. Lightning is the worker and the fallback when Ultra fails.
