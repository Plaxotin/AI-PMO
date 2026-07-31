"""Клиент Kimi (Moonshot AI) — OpenAI-совместимый API, только stdlib.

Настройка через переменные окружения:
  KIMI_API_KEY  — ключ API (обязателен для генерации)
  KIMI_BASE_URL — по умолчанию https://api.moonshot.cn/v1
  KIMI_MODEL    — по умолчанию moonshot-v1-8k
"""
import json
import os
import urllib.request
import urllib.error

BASE_URL = os.getenv("KIMI_BASE_URL", "https://api.moonshot.cn/v1")
API_KEY = os.getenv("KIMI_API_KEY", "")
MODEL = os.getenv("KIMI_MODEL", "moonshot-v1-8k")


class KimiError(Exception):
    """Ошибка вызова Kimi API или отсутствия ключа."""


def chat(messages: list[dict], temperature: float = 0.3,
         json_mode: bool = True, timeout: int = 180) -> str:
    """Один вызов chat/completions. Возвращает content ответа."""
    if not API_KEY:
        raise KimiError("KIMI_API_KEY не задан в окружении")
    payload = {
        "model": MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": 6000,  # RACI 18x11 с notes не влезает в дефолт — ответ обрывался
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:500]
        raise KimiError(f"Kimi API HTTP {e.code}: {body}") from e
    except Exception as e:
        raise KimiError(f"Kimi API недоступен: {e}") from e
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise KimiError(f"Неожиданный формат ответа Kimi: {data!r}") from e


def chat_json(messages: list[dict], temperature: float = 0.3) -> dict:
    """Вызов с гарантией JSON-объекта на выходе."""
    raw = chat(messages, temperature=temperature, json_mode=True)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    # Запасной путь: вырезаем JSON от первой { до последней } (обёртки/пролог модели)
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(raw[start:end + 1])
        except json.JSONDecodeError:
            pass
    raise KimiError(f"Kimi вернул не-JSON: {raw[:300]}")
