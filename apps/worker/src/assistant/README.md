# assistant/

The AI assistant runtime: the OpenAI adapter, the whitelisted tool registry (read tools +
`draft_*` write tools, Zod-validated), prompts (`system.capture.md`, `system.query.md`), and the
`assistant_interactions` logging used for accuracy tracking (Doc 05). Write tools only ever
return proposed payloads — commits happen through the same `core/` services as every other
channel, after human confirmation (INV-4). First populated by KOK-039+.
