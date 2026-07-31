"""Офлайн-прогон: демо-данные -> валидация PMBOK -> Excel.

python demo.py  ->  demo_output/raci_demo.xlsx
"""
from __future__ import annotations

from pathlib import Path

import raci_engine
import xlsx_builder

out_dir = Path(__file__).parent / "demo_output"
out_dir.mkdir(exist_ok=True)
out_path = out_dir / "raci_demo.xlsx"

data = raci_engine.demo_data()
issues = raci_engine.validate(data)

print(f"Проект: {data['project_name']}")
print(f"Ролей: {len(data['roles'])} · Активностей: {len(data['activities'])}")
print(f"Нарушения валидации PMBOK: {issues if issues else 'нет'}")

xlsx_builder.build_xlsx(data, str(out_path))
print(f"Excel сохранён: {out_path}")
