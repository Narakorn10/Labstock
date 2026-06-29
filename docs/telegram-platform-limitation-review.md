# Telegram Bot Platform Limitation Review

Last reviewed: 2026-06-29

## Scope

This review is for Feature 6.3 before implementing Telegram support in LabStock.
It is based on:

- Current repo capabilities in `src/app/api/logs/route.ts`, `src/lib/stock-transactions.ts`, and `src/app/api/line-webhook/route.ts`
- Official Telegram Bot API documentation and FAQ

## Current LabStock Context

- The project already uses Neon PostgreSQL via `@neondatabase/serverless`.
- Transaction logs already exist in the `logs` table and are exposed by `/api/logs`.
- Receive and dispense actions already write audit records through `runReceiveBatch()` and `runDispenseBatch()`.
- There is no Telegram bot code in the repo yet.
- LINE bot support already exists, so Telegram should be added as a separate integration layer instead of changing stock logic.

## Official Telegram Constraints Relevant To LabStock

### 1. Message length and formatting

- Bot text messages are limited to 1-4096 characters.
- Media captions are limited to 0-1024 characters.
- Supported formatting uses `MarkdownV2` or `HTML`.
- `MarkdownV2` is powerful but fragile because many characters must be escaped.
- `HTML` is simpler for system-generated text but supports only the tags allowed by Telegram.

Implication for LabStock:

- `/stock` and `/transactions` responses must be short summaries, not full table dumps.
- Long transaction results should be chunked into multiple messages or reduced to the latest 5-10 records.
- Prefer `HTML` for predictable bot-generated formatting unless inline escaping helpers are added.

### 2. Inline keyboard and callback data

- Inline keyboard buttons can carry `callback_data` of 1-64 bytes.
- Telegram requires callback queries to be answered, even when no visible message change is needed.
- The official docs do not publish a hard maximum button count per keyboard in the sections reviewed, so practical UI limits should be treated as client-side usability constraints rather than a documented API guarantee.

Implication for LabStock:

- Do not encode full dispense payloads, lot lists, or JSON state inside `callback_data`.
- Store short action tokens only, then load the real state from the database or a server-side cache.
- Multi-step actions like dispense approval should use a server-side conversation state record keyed by user/chat plus a short callback token.
- Keep keyboards small and mobile-friendly, ideally a few buttons per step.

### 3. File and image sending

- Telegram bots can send photos, documents, and other files.
- File sending is suitable for exports, screenshots, and generated reports, but it is not a replacement for interactive transactional UI.

Implication for LabStock:

- Telegram is feasible for sending CSV/PDF snapshots, low-stock summaries, or error evidence.
- Core stock operations should stay in the web UI, with Telegram acting as query/notification/control-lite rather than full data-entry UI.

### 4. Rate limits

- Telegram documents a limit of about 30 messages per second to different chats.
- Telegram documents a limit of about 20 messages per minute to the same group.
- Bursts may trigger `429 Too Many Requests` with retry timing.

Implication for LabStock:

- Low-stock alerts should be batched into digest messages instead of sending one message per item.
- System log pushes should be throttled and grouped by event type.
- A queue/retry layer is recommended before enabling production alert fan-out.

### 5. Group chat vs private bot

- In groups, bot privacy mode limits which messages the bot receives unless users explicitly address the bot or use supported command patterns.
- Private chats are simpler for user-specific flows and sensitive data.
- Group chats are better for broadcast-style alerts and shared operational visibility.

Implication for LabStock:

- Use private chat for user-specific commands, approvals, and anything tied to permissions.
- Use a group or channel for broadcast alerts such as low stock or error digests.
- Do not depend on free-text group conversations for reliable multi-step stock workflows.

### 6. Stateful conversation flows

- Telegram supports stateful bots, but the Bot API itself does not manage workflow state for us.
- Every multi-step flow must be implemented server-side.
- Messages can arrive out of order, be repeated, or be retried after network delay.

Implication for LabStock:

- Full `/dispense` and `/receive` transaction entry inside Telegram is high-risk compared with the current web UI.
- If Telegram flow is added later, it should be limited to guided, small-scope actions with explicit confirmation and timeout handling.
- The current LabStock FEFO lot selection and stock validation should remain in backend APIs, not be duplicated inside bot callback payloads.

## Feasibility Decision By Feature

### Feasible now

- `/stock` summary command
- `/transactions` latest activity summary
- Low-stock alert push
- Error/log digest push
- Link-out actions back to LabStock web pages

### Feasible with care

- Per-user approvals through private chat
- Short drill-down actions using inline keyboards
- Export file delivery for reports or snapshots

### Not recommended as first Telegram release

- Full multi-step dispense flow inside chat
- Full multi-step receive flow inside chat
- Large lot-by-lot editing flows
- Anything that depends on long callback payloads or complex chat state recovery

## Recommended Architecture For LabStock

1. Build Telegram as a thin integration layer on top of existing APIs and stock logic.
2. Reuse `/api/logs` and existing stock queries for read-only bot commands.
3. Add a small server-side conversation state store for any callback-driven workflow.
4. Keep Telegram write actions limited to confirm/reject style operations first.
5. Send users back to the web app for heavy transactional steps such as lot-aware dispense and receive.
6. Add throttling, batching, and retry handling before enabling production alerts.

## Recommended Feature Order

1. Feature 6.3: complete this review and lock scope.
2. Feature 6.1: implement Telegram alert/log push as digest-based notifications.
3. Feature 6.2: implement read-only commands first: `/stock` and `/transactions`.
4. Add private-chat approval flows only after read-only commands are stable.
5. Defer full dispense/receive chat workflows unless the business still needs them after testing.

## Repo-Specific Recommendation

For this repo, the best first Telegram milestone is:

- Broadcast low-stock and error digests to Telegram
- Support `/stock` and `/transactions` as read-only summaries
- Return deep links to the existing LabStock pages for actions that need full validation

This keeps the current backend stock logic untouched and avoids duplicating FEFO dispense behavior in a chat interface.

## Source Notes

- Telegram Bot API: message, caption, parse mode, callback query, and inline keyboard behavior
- Telegram Bot FAQ: rate limit guidance and operational limits

