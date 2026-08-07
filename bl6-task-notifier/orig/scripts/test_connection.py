import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from task_manager import get_gsheets_client, get_worksheet

client = get_gsheets_client()
worksheet = get_worksheet(client)
print('OK: Podkluchenie k Google Sheets uspeshno!')
print('List: ' + worksheet.title)

# Proveryaem, est li zagolovki
values = worksheet.get_all_values()
print('V tablitse ' + str(len(values)) + ' strok')

headers = ['ID', 'Data sozdaniya', 'Avtor/Istochnik', 'Proekt', 'Opisanie', 'Otvetstvenniy', 'Srok', 'Status', 'Data zakrytiya', 'Kommentariy']

if len(values) == 0 or (len(values) == 1 and len(values[0]) == 0):
    print('Tablitsa pusta, dobavlyayu zagolovki...')
    worksheet.update(range_name='A1:J1', values=[headers])
    worksheet.format('A1:J1', {
        'textFormat': {'bold': True},
        'backgroundColor': {'red': 0.9, 'green': 0.9, 'blue': 0.9}
    })
    print('Zagolovki dobavleny!')
else:
    print('Zagolovki uzhe est: ' + str(values[0] if values else 'pusto'))
