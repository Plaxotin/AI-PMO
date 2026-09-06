#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Модель данных плана проекта (BL-1).

Единый внутренний формат, в который парсер приводит .xlsx/.csv/.mpp.
Все дальнейшие стадии (analytics, diff, llm) работают только с Plan/Task.
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional


@dataclass
class Task:
    uid: str                          # стабильный идентификатор (строка/ID из файла)
    name: str
    wbs: str = ""
    outline_level: int = 1
    is_summary: bool = False
    is_milestone: bool = False
    start: Optional[date] = None
    finish: Optional[date] = None
    duration_days: Optional[float] = None
    percent_complete: float = 0.0     # 0..100
    predecessors: list = field(default_factory=list)   # list[uid]
    successors: list = field(default_factory=list)     # list[uid]
    deadline: Optional[date] = None
    cost: Optional[float] = None                       # «Затраты» (по Инструкции сумма = 100)
    baseline_start: Optional[date] = None
    baseline_finish: Optional[date] = None
    responsible: str = ""
    row_ref: str = ""                 # evidence: номер строки / координата в файле


@dataclass
class Plan:
    name: str
    source_format: str                # xlsx | csv | mpp
    tasks: list = field(default_factory=list)          # list[Task]
    columns_found: list = field(default_factory=list)  # имена распознанных колонок
    parsed_at: datetime = field(default_factory=datetime.now)

    def by_uid(self) -> dict:
        return {t.uid: t for t in self.tasks}

    def leaves(self) -> list:
        return [t for t in self.tasks if not t.is_summary]

    def summaries(self) -> list:
        return [t for t in self.tasks if t.is_summary]

    def milestones(self) -> list:
        return [t for t in self.tasks if t.is_milestone]
