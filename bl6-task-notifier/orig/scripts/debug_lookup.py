import json
import sys
sys.path.insert(0, '.')
from telegram_handler import get_assignee_by_telegram, get_tasks_for_assignee, get_all_tasks

print('=== USER MAPPING ===')
with open('../.credentials/user_mapping.json', encoding='utf-8') as f:
    print(json.load(f))

print('\n=== ALL TASKS ===')
tasks = get_all_tasks()
print(f'Total tasks: {len(tasks)}')
for t in tasks[:10]:
    print(f"ID={t.get('ID')}, Ответственный='{t.get('Ответственный')}', Статус='{t.get('Статус')}'")

print('\n=== LOOKUP TESTS ===')
for uname in ['plaxotin', 'Plaxotin', '@plaxotin']:
    result = get_assignee_by_telegram(uname)
    print(f"get_assignee_by_telegram('{uname}') = {result}")

print('\n=== FILTER TEST ===')
assignee = get_assignee_by_telegram('plaxotin')
if assignee:
    tasks = get_tasks_for_assignee(assignee, include_closed=False)
    print(f'Found {len(tasks)} tasks for assignee={assignee}')
    for t in tasks:
        print(f"  ID={t.get('ID')}, Статус={t.get('Статус')}")
