import sys
sys.path.insert(0, '.')
from telegram_handler import get_tasks_for_assignee

tasks = get_tasks_for_assignee('Константин', include_closed=False)
print(f'Found {len(tasks)} tasks for Константин')
for t in tasks[:5]:
    print(f"  ID={t['ID']}, Статус={t['Статус']}, Срок={t['Срок']}, Описание={t['Описание'][:40]}")
