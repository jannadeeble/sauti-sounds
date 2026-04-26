from __future__ import annotations

from dataclasses import dataclass
import json
import time
from typing import Any

import requests
from fastapi import HTTPException, status

from .schemas import LLMChatRequest

STRUCTURED_TASKS = {"recommendations", "track-tags", "taste-profile", "adjudication"}


@dataclass
class LLMExecutionResult:
    text: str
    finish_reason: str | None
    raw_data: object
    data: object | None = None


def _provider_error_message(response: requests.Response) -> str:
    text = response.text.strip()
    try:
        payload = response.json()
    except ValueError:
        return text or response.reason

    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            message = error.get("message") or error.get("detail") or error.get("type")
            if message:
                return str(message)
        if isinstance(error, str):
            return error
        detail = payload.get("detail") or payload.get("message")
        if detail:
            return str(detail)

    return text or response.reason


def _raise_provider_error(label: str, response: requests.Response) -> None:
    message = _provider_error_message(response)
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"{label} API error: {response.status_code} {message}",
    )


def merge_system_prompt(messages: list[dict], system_blocks: list[dict] | None) -> list[dict]:
    if not system_blocks:
        return messages

    injected = "\n\n".join(
        str(block.get("text", "")).strip()
        for block in system_blocks
        if str(block.get("text", "")).strip()
    )
    if not injected:
        return messages

    existing_system = next(
        (
            str(message.get("content", "")).strip()
            for message in messages
            if message.get("role") == "system"
        ),
        "",
    )
    merged_system = f"{injected}\n\n{existing_system}" if existing_system else injected
    without_system = [message for message in messages if message.get("role") != "system"]
    return [{"role": "system", "content": merged_system}, *without_system]


def _openrouter_supports_reasoning(model_id: str) -> bool:
    model = model_id.lower()
    return (
        "claude-sonnet-4" in model
        or "claude-opus-4" in model
        or "claude-haiku-4" in model
        or model.startswith("openai/o1")
        or model.startswith("openai/o3")
        or model.startswith("openai/o4")
        or "deepseek-r1" in model
        or "gpt-5" in model
        or "gemini-2.5" in model
    )


def _coerce_text_content(content: object) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                text = block.get("text") or block.get("content")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(part.strip() for part in parts if part.strip())
    if isinstance(content, dict):
        text = content.get("text") or content.get("content")
        return text.strip() if isinstance(text, str) else ""
    return ""


def _chat_completion_text(data: object) -> str:
    if not isinstance(data, dict):
        return ""
    output_text = data.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    choices = data.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        message = choices[0].get("message")
        if isinstance(message, dict):
            return _coerce_text_content(message.get("content"))
        return _coerce_text_content(choices[0].get("text"))

    content = data.get("content")
    if isinstance(content, list):
        text = "\n".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict)
            and block.get("type") == "text"
            and isinstance(block.get("text"), str)
        )
        return text.strip()

    candidates = data.get("candidates")
    if isinstance(candidates, list) and candidates:
        try:
            parts = candidates[0]["content"]["parts"]
        except Exception:
            return ""
        texts = [
            part.get("text", "")
            for part in parts
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        ]
        return "\n".join(part.strip() for part in texts if part.strip())

    return ""


def _extract_finish_reason(data: object) -> str | None:
    if not isinstance(data, dict):
        return None
    choices = data.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        finish_reason = choices[0].get("finish_reason")
        return str(finish_reason) if finish_reason else None
    candidates = data.get("candidates")
    if isinstance(candidates, list) and candidates and isinstance(candidates[0], dict):
        finish_reason = candidates[0].get("finishReason") or candidates[0].get("finish_reason")
        return str(finish_reason) if finish_reason else None
    stop_reason = data.get("stop_reason")
    return str(stop_reason) if isinstance(stop_reason, str) and stop_reason else None


def _empty_response_detail(label: str, data: object) -> str:
    finish_reason = _extract_finish_reason(data)
    suffix = f" Finish reason: {finish_reason}." if finish_reason else ""
    return f"{label} API returned an empty message.{suffix}"


def _default_thinking_budget(payload: LLMChatRequest) -> int | None:
    if payload.task_type in STRUCTURED_TASKS:
        return 0
    return payload.thinking_budget


def _default_temperature(payload: LLMChatRequest) -> float | None:
    if payload.temperature is not None:
        return payload.temperature
    if payload.task_type in STRUCTURED_TASKS:
        return 0
    return None


def _strip_code_fences(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[1] if "\n" in stripped else stripped[3:]
    if stripped.endswith("```"):
        stripped = stripped[:-3]
    return stripped.strip()


def _extract_json_substring(text: str) -> str:
    stripped = _strip_code_fences(text)
    starts = [index for index in (stripped.find("{"), stripped.find("[")) if index != -1]
    if not starts:
        return stripped
    start = min(starts)
    stack: list[str] = []
    in_string = False
    escape = False
    pairs = {"{": "}", "[": "]"}
    for index in range(start, len(stripped)):
        char = stripped[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
            continue
        if char in pairs:
            stack.append(pairs[char])
            continue
        if stack and char == stack[-1]:
            stack.pop()
            if not stack:
                return stripped[start : index + 1]
    return stripped[start:]


def _schema_hint(task_type: str, response_schema: dict[str, Any] | None) -> str:
    if response_schema:
        return json.dumps(response_schema)
    if task_type == "recommendations":
        return '{"recommendations":[{"artist":"string","title":"string","reason":"string"}]}'
    if task_type == "track-tags":
        return '{"tags":[{"energy":0.5,"mood":"string","genres":["genre"],"bpmEstimate":120,"vibeDescriptors":["string"],"culturalContext":"string"}]}'
    if task_type == "taste-profile":
        return '{"coreIdentity":"string","primaryGenres":["genre"],"energyPreference":{"min":0.0,"max":1.0,"sweet_spot":0.5},"culturalMarkers":["string"],"antiPreferences":["string"],"favoriteArtists":["string"],"moodPreferences":["string"]}'
    if task_type == "adjudication":
        return '{"pickIndex":0}'
    return "{}"


def _validate_recommendations(value: object) -> dict[str, Any]:
    items = value.get("recommendations") if isinstance(value, dict) else value
    if not isinstance(items, list):
        raise ValueError("Recommendation response was not a list")
    recommendations: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        artist = item.get("artist")
        title = item.get("title")
        reason = item.get("reason")
        if all(isinstance(field, str) and field.strip() for field in (artist, title, reason)):
            recommendations.append(
                {
                    "artist": artist.strip(),
                    "title": title.strip(),
                    "reason": reason.strip(),
                }
            )
    if items and not recommendations:
        raise ValueError("Recommendation response did not include usable artist/title pairs")
    return {"recommendations": recommendations}


def _validate_track_tags(value: object) -> dict[str, Any]:
    items = value.get("tags") if isinstance(value, dict) else value
    if not isinstance(items, list):
        raise ValueError("Track tag response was not a list")
    tags: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        energy = item.get("energy")
        mood = item.get("mood")
        genres = item.get("genres")
        bpm_estimate = item.get("bpmEstimate")
        vibe_descriptors = item.get("vibeDescriptors")
        cultural_context = item.get("culturalContext")
        tags.append(
            {
                "energy": float(energy) if isinstance(energy, (int, float)) else 0.5,
                "mood": mood.strip() if isinstance(mood, str) and mood.strip() else "neutral",
                "genres": [str(genre) for genre in genres] if isinstance(genres, list) else [],
                "bpmEstimate": int(bpm_estimate) if isinstance(bpm_estimate, (int, float)) else None,
                "vibeDescriptors": [str(item) for item in vibe_descriptors] if isinstance(vibe_descriptors, list) else [],
                "culturalContext": cultural_context.strip() if isinstance(cultural_context, str) and cultural_context.strip() else None,
            }
        )
    return {"tags": tags}


def _validate_taste_profile(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Taste profile response was not an object")
    energy = value.get("energyPreference")
    if not isinstance(energy, dict):
        energy = {}
    return {
        "coreIdentity": str(value.get("coreIdentity") or "Music enthusiast"),
        "primaryGenres": [str(item) for item in value.get("primaryGenres", [])] if isinstance(value.get("primaryGenres"), list) else [],
        "energyPreference": {
            "min": float(energy.get("min")) if isinstance(energy.get("min"), (int, float)) else 0.2,
            "max": float(energy.get("max")) if isinstance(energy.get("max"), (int, float)) else 0.8,
            "sweet_spot": float(energy.get("sweet_spot")) if isinstance(energy.get("sweet_spot"), (int, float)) else 0.5,
        },
        "culturalMarkers": [str(item) for item in value.get("culturalMarkers", [])] if isinstance(value.get("culturalMarkers"), list) else [],
        "antiPreferences": [str(item) for item in value.get("antiPreferences", [])] if isinstance(value.get("antiPreferences"), list) else [],
        "favoriteArtists": [str(item) for item in value.get("favoriteArtists", [])] if isinstance(value.get("favoriteArtists"), list) else [],
        "moodPreferences": [str(item) for item in value.get("moodPreferences", [])] if isinstance(value.get("moodPreferences"), list) else [],
    }


def _validate_adjudication(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Adjudication response was not an object")
    pick_index = value.get("pickIndex")
    if pick_index is None:
        return {"pickIndex": None}
    if isinstance(pick_index, bool):
        raise ValueError("Invalid pickIndex")
    if isinstance(pick_index, (int, float)) and int(pick_index) == pick_index:
        return {"pickIndex": int(pick_index)}
    raise ValueError("Invalid pickIndex")


def validate_structured_output(task_type: str, value: object) -> object:
    if task_type == "recommendations":
        return _validate_recommendations(value)
    if task_type == "track-tags":
        return _validate_track_tags(value)
    if task_type == "taste-profile":
        return _validate_taste_profile(value)
    if task_type == "adjudication":
        return _validate_adjudication(value)
    return value


def parse_structured_output(task_type: str, text: str) -> object:
    candidate = _extract_json_substring(text)
    parsed = json.loads(candidate)
    return validate_structured_output(task_type, parsed)


def _repair_messages(task_type: str, raw_text: str, response_schema: dict[str, Any] | None) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": "You repair malformed model outputs. Return valid JSON only. Do not add explanation or markdown.",
        },
        {
            "role": "user",
            "content": (
                f"Repair this output into valid JSON for task '{task_type}'.\n"
                f"Expected schema:\n{_schema_hint(task_type, response_schema)}\n\n"
                f"Original output:\n{raw_text}"
            ),
        },
    ]


def _log_ai_event(**payload: object) -> None:
    try:
        print(json.dumps({"event": "ai_run", **payload}, sort_keys=True))
    except Exception:
        pass


def _call_claude_llm(payload: LLMChatRequest) -> LLMExecutionResult:
    system_from_messages = next(
        (
            str(message.get("content", ""))
            for message in payload.messages
            if message.get("role") == "system"
        ),
        "",
    )
    user_messages = [
        {"role": message.get("role"), "content": message.get("content", "")}
        for message in payload.messages
        if message.get("role") != "system"
    ]
    max_tokens = payload.max_tokens
    body: dict[str, Any] = {
        "model": payload.model or "claude-sonnet-4-6",
        "max_tokens": max_tokens,
        "system": payload.system_blocks or system_from_messages,
        "messages": user_messages,
    }
    thinking_budget = _default_thinking_budget(payload)
    if thinking_budget and thinking_budget > 0:
        bounded = min(thinking_budget, max(max_tokens - 1024, 0))
        if bounded > 0:
            body["thinking"] = {"type": "enabled", "budget_tokens": bounded}
    temperature = _default_temperature(payload)
    if temperature is not None:
        body["temperature"] = temperature

    response = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "Content-Type": "application/json",
            "x-api-key": payload.api_key,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "prompt-caching-2024-07-31",
        },
        json=body,
        timeout=90,
    )
    if not response.ok:
        _raise_provider_error("Claude", response)

    data = response.json()
    text = _chat_completion_text(data)
    if not text:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_empty_response_detail("Claude", data),
        )
    return LLMExecutionResult(text=text, finish_reason=_extract_finish_reason(data), raw_data=data)


def _call_openai_llm(payload: LLMChatRequest) -> LLMExecutionResult:
    body: dict[str, Any] = {
        "model": payload.model or "gpt-4o",
        "max_tokens": payload.max_tokens,
        "messages": merge_system_prompt(payload.messages, payload.system_blocks),
    }
    temperature = _default_temperature(payload)
    if temperature is not None:
        body["temperature"] = temperature
    if payload.response_mode == "json_object":
        body["response_format"] = {"type": "json_object"}

    response = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {payload.api_key}",
        },
        json=body,
        timeout=90,
    )
    if not response.ok:
        _raise_provider_error("OpenAI", response)

    data = response.json()
    text = _chat_completion_text(data)
    if not text:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_empty_response_detail("OpenAI", data),
        )
    return LLMExecutionResult(text=text, finish_reason=_extract_finish_reason(data), raw_data=data)


def _post_openrouter_llm(payload: LLMChatRequest, base_url: str, body: dict[str, Any]) -> dict:
    response = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {payload.api_key}",
            "HTTP-Referer": base_url.rstrip("/"),
            "X-Title": "Sauti Sounds",
        },
        json=body,
        timeout=90,
    )
    if not response.ok:
        _raise_provider_error("OpenRouter", response)
    return response.json()


def _call_openrouter_llm(payload: LLMChatRequest, base_url: str) -> LLMExecutionResult:
    model = payload.model or "anthropic/claude-sonnet-4.6"
    body: dict[str, Any] = {
        "model": model,
        "max_tokens": payload.max_tokens,
        "messages": merge_system_prompt(payload.messages, payload.system_blocks),
    }
    temperature = _default_temperature(payload)
    if temperature is not None:
        body["temperature"] = temperature
    if payload.response_mode == "json_object":
        body["response_format"] = {"type": "json_object"}

    use_reasoning = (
        payload.use_route_enhancements
        and payload.task_type not in STRUCTURED_TASKS
        and _openrouter_supports_reasoning(model)
    )
    if use_reasoning:
        body["reasoning"] = {"effort": "high"}

    data = _post_openrouter_llm(payload, base_url, body)
    text = _chat_completion_text(data)
    if text:
        return LLMExecutionResult(text=text, finish_reason=_extract_finish_reason(data), raw_data=data)

    if use_reasoning:
        body.pop("reasoning", None)
        data = _post_openrouter_llm(payload, base_url, body)
        text = _chat_completion_text(data)
        if text:
            return LLMExecutionResult(text=text, finish_reason=_extract_finish_reason(data), raw_data=data)

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=_empty_response_detail("OpenRouter", data),
    )


def _call_gemini_llm(payload: LLMChatRequest) -> LLMExecutionResult:
    model = payload.model or "gemini-2.0-flash"
    messages = merge_system_prompt(payload.messages, payload.system_blocks)
    contents = [
        {
            "role": "model" if message.get("role") == "assistant" else "user",
            "parts": [{"text": str(message.get("content", ""))}],
        }
        for message in messages
        if message.get("role") != "system"
    ]
    system_message = next((message for message in messages if message.get("role") == "system"), None)
    generation_config: dict[str, Any] = {"maxOutputTokens": payload.max_tokens}
    temperature = _default_temperature(payload)
    if temperature is not None:
        generation_config["temperature"] = temperature
    if payload.response_mode == "json_object":
        generation_config["responseMimeType"] = "application/json"
    body: dict[str, Any] = {
        "contents": contents,
        "generationConfig": generation_config,
    }
    if system_message:
        body["systemInstruction"] = {"parts": [{"text": str(system_message.get("content", ""))}]}

    response = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        params={"key": payload.api_key},
        headers={"Content-Type": "application/json"},
        json=body,
        timeout=90,
    )
    if not response.ok:
        _raise_provider_error("Gemini", response)

    data = response.json()
    text = _chat_completion_text(data)
    if not text:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_empty_response_detail("Gemini", data),
        )
    return LLMExecutionResult(text=text, finish_reason=_extract_finish_reason(data), raw_data=data)


def _execute_provider(payload: LLMChatRequest, base_url: str) -> LLMExecutionResult:
    provider = payload.provider.lower()
    if provider == "claude":
        return _call_claude_llm(payload)
    if provider == "openai":
        return _call_openai_llm(payload)
    if provider == "openrouter":
        return _call_openrouter_llm(payload, base_url)
    if provider == "gemini":
        return _call_gemini_llm(payload)
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Unknown provider: {payload.provider}",
    )


def run_llm_task(payload: LLMChatRequest, base_url: str) -> LLMExecutionResult:
    started_at = time.time()
    try:
        result = _execute_provider(payload, base_url)
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"{payload.provider} API network error: {exc}",
        ) from exc

    parsed_data: object | None = None
    error_code = None
    if payload.response_mode == "json_object" or payload.task_type in STRUCTURED_TASKS:
        try:
            parsed_data = parse_structured_output(payload.task_type, result.text)
        except Exception:
            repair_payload = payload.model_copy(
                update={
                    "messages": _repair_messages(payload.task_type, result.text, payload.response_schema),
                    "system_blocks": None,
                    "thinking_budget": 0,
                    "response_mode": "json_object",
                    "temperature": 0,
                    "use_route_enhancements": False,
                    "task_type": payload.task_type,
                }
            )
            error_code = "schema_invalid"
            try:
                repaired = _execute_provider(repair_payload, base_url)
                parsed_data = parse_structured_output(payload.task_type, repaired.text)
                result = repaired
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"{payload.provider} repair failed: {exc}",
                ) from exc

    _log_ai_event(
        provider=payload.provider,
        model=payload.model,
        task_type=payload.task_type,
        response_mode=payload.response_mode,
        max_tokens=payload.max_tokens,
        finish_reason=result.finish_reason,
        raw_text_length=len(result.text),
        validated_item_count=(
            len(parsed_data.get("recommendations", []))
            if isinstance(parsed_data, dict) and "recommendations" in parsed_data
            else len(parsed_data.get("tags", []))
            if isinstance(parsed_data, dict) and "tags" in parsed_data
            else None
        ),
        elapsed_ms=round((time.time() - started_at) * 1000),
        error_code=error_code,
    )
    result.data = parsed_data
    return result
