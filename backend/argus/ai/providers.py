"""One interface over the model providers Argus supports:

- "anthropic": Claude through the official anthropic SDK (Messages API).
- "openai": OpenAI's Chat Completions API.
- "local": any OpenAI-compatible server (Ollama, LM Studio, vLLM,
  llama.cpp server, LocalAI) at the admin's base URL.

run() drives a conversation with read-only tools: it calls the model,
runs the tools it asks for through `execute`, feeds the results back,
and stops when the model answers or max_steps is reached. Tool results
are data the model reads, never instructions Argus follows.
"""

import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import anthropic
import httpx

log = logging.getLogger("argus.ai")

DEFAULT_MODELS = {
    "anthropic": "claude-opus-5-5",
    "openai": "",
    "local": "",
}
OPENAI_BASE = "https://api.openai.com/v1"


class AiError(Exception):
    """Something to tell the person asking (no key, provider error)."""


@dataclass
class Tool:
    name: str
    description: str
    schema: dict  # JSON Schema for the input object


@dataclass
class Result:
    text: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    calls: list[dict] = field(default_factory=list)  # tools used


@dataclass
class ProviderConfig:
    kind: str  # anthropic | openai | local
    model: str
    api_key: str | None = None
    base_url: str | None = None


Execute = Callable[[str, dict], Awaitable[str]]


async def run(
    cfg: ProviderConfig,
    system: str,
    prompt: str,
    *,
    tools: list[Tool] | None = None,
    execute: Execute | None = None,
    max_tokens: int = 4000,
    max_steps: int = 6,
) -> Result:
    if not cfg.model:
        raise AiError("No model is set for this provider.")
    if cfg.kind == "anthropic":
        return await _anthropic(
            cfg, system, prompt, tools or [], execute, max_tokens, max_steps
        )
    if cfg.kind in ("openai", "local"):
        return await _openai(
            cfg, system, prompt, tools or [], execute, max_tokens, max_steps
        )
    raise AiError("Unknown provider.")


async def _tool_result(execute: Execute | None, name: str, args) -> str:
    if execute is None:
        return "Error: no tools are available."
    try:
        return await execute(name, args if isinstance(args, dict) else {})
    except Exception as exc:  # noqa: BLE001 - reported to the model
        log.warning("AI tool {0} failed: {1}".format(name, exc))
        return "Error: {0}".format(str(exc)[:200])


async def _anthropic(cfg, system, prompt, tools, execute, max_tokens, steps):
    if not cfg.api_key:
        raise AiError("Add an Anthropic API key in Settings > AI.")
    client = anthropic.AsyncAnthropic(
        api_key=cfg.api_key, timeout=120.0, max_retries=2
    )
    out = Result(text="", model=cfg.model)
    messages: list[dict] = [{"role": "user", "content": prompt}]
    defs = [
        {
            "name": t.name,
            "description": t.description,
            "input_schema": t.schema,
        }
        for t in tools
    ]
    try:
        for _ in range(steps):
            kwargs = {
                "model": cfg.model,
                "max_tokens": max_tokens,
                # The system prompt and tools are stable: cache them.
                "system": [
                    {
                        "type": "text",
                        "text": system,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                "messages": messages,
            }
            if defs:
                kwargs["tools"] = defs
            resp = await client.messages.create(**kwargs)
            out.input_tokens += (resp.usage.input_tokens or 0) + (
                getattr(resp.usage, "cache_read_input_tokens", 0) or 0
            )
            out.output_tokens += resp.usage.output_tokens or 0
            out.model = resp.model or cfg.model
            if resp.stop_reason == "refusal":
                raise AiError("The model declined to answer that.")
            uses = [b for b in resp.content if b.type == "tool_use"]
            if resp.stop_reason == "pause_turn":
                messages.append({"role": "assistant", "content": resp.content})
                continue
            if resp.stop_reason != "tool_use" or not uses:
                out.text = "\n".join(
                    b.text for b in resp.content if b.type == "text"
                ).strip()
                return out
            messages.append({"role": "assistant", "content": resp.content})
            results = []
            for b in uses:
                out.calls.append({"tool": b.name, "input": b.input})
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": b.id,
                        "content": await _tool_result(
                            execute, b.name, b.input
                        ),
                    }
                )
            messages.append({"role": "user", "content": results})
        raise AiError(
            "The model used too many steps; try a narrower question."
        )
    except anthropic.AuthenticationError as exc:
        raise AiError("Anthropic rejected the API key.") from exc
    except anthropic.NotFoundError as exc:
        raise AiError("Anthropic doesn't know that model.") from exc
    except anthropic.RateLimitError as exc:
        raise AiError(
            "Anthropic is rate limiting this key; try later."
        ) from exc
    except anthropic.APIConnectionError as exc:
        raise AiError("Couldn't reach Anthropic.") from exc
    except anthropic.APIStatusError as exc:
        raise AiError(
            "Anthropic error {0}: {1}".format(exc.status_code, exc.message)[
                :300
            ]
        ) from exc
    finally:
        await client.close()


async def _openai(cfg, system, prompt, tools, execute, max_tokens, steps):
    base = (cfg.base_url or OPENAI_BASE).rstrip("/")
    if cfg.kind == "openai" and not cfg.api_key:
        raise AiError("Add an OpenAI API key in Settings > AI.")
    headers = {"Content-Type": "application/json"}
    if cfg.api_key:
        headers["Authorization"] = "Bearer {0}".format(cfg.api_key)
    defs = [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.schema,
            },
        }
        for t in tools
    ]
    messages: list[dict] = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]
    out = Result(text="", model=cfg.model)
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(180.0, connect=10.0), headers=headers
    ) as client:
        for _ in range(steps):
            body = {
                "model": cfg.model,
                "messages": messages,
                "max_tokens": max_tokens,
            }
            if defs:
                body["tools"] = defs
            try:
                r = await client.post(
                    "{0}/chat/completions".format(base), json=body
                )
            except httpx.HTTPError as exc:
                raise AiError("Couldn't reach {0}.".format(base)) from exc
            if r.status_code == 401:
                raise AiError("The provider rejected the API key.")
            if r.status_code >= 400:
                raise AiError(
                    "Provider error {0}: {1}".format(
                        r.status_code, r.text[:200]
                    )
                )
            data = r.json()
            usage = data.get("usage") or {}
            out.input_tokens += int(usage.get("prompt_tokens") or 0)
            out.output_tokens += int(usage.get("completion_tokens") or 0)
            out.model = data.get("model") or cfg.model
            msg = ((data.get("choices") or [{}])[0]).get("message") or {}
            calls = msg.get("tool_calls") or []
            if not calls:
                out.text = (msg.get("content") or "").strip()
                return out
            messages.append(
                {
                    "role": "assistant",
                    "content": msg.get("content") or "",
                    "tool_calls": calls,
                }
            )
            for c in calls:
                fn = c.get("function") or {}
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except ValueError:
                    args = {}
                out.calls.append({"tool": fn.get("name"), "input": args})
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": c.get("id"),
                        "content": await _tool_result(
                            execute, fn.get("name") or "", args
                        ),
                    }
                )
    raise AiError("The model used too many steps; try a narrower question.")
