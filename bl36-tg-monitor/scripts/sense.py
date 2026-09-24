#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BL-36 sense-making (фаза 2, заглушка).

План (SPEC-BL-36 §6.3): каждые 30 мин батч необработанных сообщений
(bl36_messages, processed_at IS NULL, is_noise=false) → kimi-k2.6
(thinking вкл, max_tokens=8000, timeout=120) → JSON сигналов
{type, summary, assignee?, due?, rationale, quote_msg_ids[], confidence}
→ bl36_signals + bl36_proposals (confidence >= 0.5) → карточки РП.

Сигнал без источника (пустой quote_msg_ids) отбрасывается.
Rate limit: последовательные вызовы, backoff при 429 (аккаунт общий
с BL-6/BL-1). Учёт токенов — outputs/_usage.jsonl (паттерн BL-28).
"""

import config


def run_batch():
    raise NotImplementedError('sense-making — фаза 2 (SPEC-BL-36 §12)')


if __name__ == '__main__':
    print('sense.py — заглушка фазы 2, см. SPEC-BL-36 §6.3', flush=True)
