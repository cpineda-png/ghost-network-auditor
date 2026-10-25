# Ghost Network Auditor: rules for coding agents

## Stack
TypeScript (Node 20) in services/agents and apps/web; Java 17 + Spring Boot 3 in services/gateway;
Postgres 16; Zetaris over JDBC. Product models are NVIDIA Nemotron (Ultra and Lightning).

## Lanes (stay in yours)
- services/gateway: Person A
- services/agents: Person B
- apps/web: Person B
- data, eval: Person A
Ask before editing files outside your lane.

## Contracts
contracts/ is the source of truth for receipts, World Model events, agent messages and the gateway API.
Never change a contract without updating both sides in the same pull request.

## Rules
- Agents query data only through gateway templates. Never write free-form SQL from an agent.
- Every claim carries receipt IDs. No receipt, no claim.
- Validate every model response against its zod schema; retry once, then escalate.
- Never read data/sample/labels.csv outside eval/.
- Secrets live only in .env. Never commit keys, passwords or real personal data.
- Respect the limits in docs/architecture.md (timeouts, retries, revision rounds).
- Write tests for new logic; run them before opening a pull request.
- Keep pull requests small: one task each.

## Commits
One line: a plain sentence with the first letter capitalized, no prefix such as feat: or fix:, no body.
Example: Return 404 for receipts that do not exist
