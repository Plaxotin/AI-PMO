import sys
sys.path.insert(0, '.')
from telegram_handler import get_worksheet

worksheet = get_worksheet()
values = worksheet.get_all_values()

print(f'Total rows: {len(values)}')
print(f'Headers: {values[0]}')
print('\nFirst data row:')
if len(values) > 1:
    print(values[1])

print('\nRow with assignee Константин:')
for i, row in enumerate(values[1:], 1):
    row_str = str(row)
    if 'онстантин' in row_str or 'onstantin' in row_str.lower():
        print(f'Row {i}: {row}')
