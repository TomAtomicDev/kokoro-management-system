# telegram/

The Telegram bot, built with grammY and mounted on the Hono app: webhook handling, capture
conversations (voice/text/photo → draft → confirmation card), confirmation-card renderers
(`cards.ts`), and command mini-forms. Validates `X-Telegram-Bot-Api-Secret-Token` and the
`OWNER_TELEGRAM_CHAT_ID` allowlist (Doc 02 §6). First populated by KOK-038+.
