---
title: AI (optional)
---

# AI (optional)

Argus works fully without AI. An admin can add a model in
**Settings › AI** to turn on three features. Each one can use a different
provider and model, and each is off until you switch it on.

| Feature | Where | What it does |
|---|---|---|
| **Brief digest** | Top of the Brief | Five to eight sentences on the last 24 hours. Every sentence must cite the events it rests on, shown as links; Argus deletes any sentence without a valid citation. Shared by everyone and rewritten at most hourly, when an admin or analyst opens the Brief (or presses **Refresh**). |
| **Event summaries** | An event's panel, **Summarise the sources** | One neutral paragraph from the event's source records and matched headlines, translating non-English text and noting where sources disagree. |
| **Ask Argus** | **Ask** in the map toolbar | Questions about what Argus holds: "What happened near home today?", "Any military aircraft over the Black Sea?". The model answers with read-only tools over Argus's own data (events, the tension index, headlines, places, aircraft and ships in view), cites events you can click, and may offer a **Show on map** button. |

## Providers

| Provider | Key | Model |
|---|---|---|
| **Anthropic (Claude)** | An API key from the Anthropic Console | `claude-opus-5-5` by default; `claude-sonnet-5-5` is cheaper, `claude-haiku-5-5` fastest |
| **OpenAI** | An OpenAI API key | Any chat model your key can use |
| **Local / OpenAI-compatible** | Only if your server needs one | Your server's model name, for example `llama3.1:8b` |

For a local model, set the **Base URL** to your server's OpenAI-compatible
endpoint, for example Ollama at `http://<host>:11434/v1`, LM Studio at
`http://<host>:1234/v1`, or vLLM. The Argus API container makes the
request, so use an address it can reach (not `localhost`, which is the
container itself). With a local model nothing leaves your hardware. Ask
Argus needs a model that supports tool calling.

Save, then press **Test**: Argus sends a one-word prompt and shows the
reply and how long it took.

## Costs and limits

- **Monthly token cap** (default 2,000,000): once a month's input plus
  output tokens reach it, AI features stop until the next month or until
  you raise it. **This month** shows calls and tokens per provider.
- Ask Argus allows 40 questions an hour per person.
- Only admins and analysts can run AI features (they spend the
  provider's tokens); viewers can read the digest. Wall screens never
  use AI.

## Safety

- Keys are encrypted with `ARGUS_SECRET_KEY`, never sent to browsers, and
  shown to admins only as their last four characters.
- News and collector text is untrusted. It's passed to the model as
  quoted data, with instructions to ignore anything in it that reads like
  a command. AI can't change anything in Argus: Ask Argus's tools only
  read, and its map suggestion is a button you choose to press.
- AI text carries an **AI** badge and the model's name. Check the cited
  events before relying on it.
- Nothing is sent to a cloud provider unless you set one up.
