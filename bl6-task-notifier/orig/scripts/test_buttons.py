import json, urllib.request

with open('../.credentials/telegram.json') as f:
    cfg = json.load(f)

url = f"https://api.telegram.org/bot{cfg['bot_token']}/sendMessage"
data = json.dumps({
    'chat_id': cfg['chat_id'],
    'text': '🤖 <b>Бот обновлён!</b>\n\nТеперь доступны кнопки для быстрого управления поручениями:',
    'parse_mode': 'HTML',
    'reply_markup': {
        'inline_keyboard': [
            [{'text': '📋 Мои поручения', 'callback_data': 'list_my'}, {'text': '📋 Все поручения', 'callback_data': 'list_all'}],
            [{'text': '✅ Закрыть поручение', 'callback_data': 'close_task'}, {'text': '📅 Изменить срок', 'callback_data': 'change_deadline'}]
        ]
    }
}).encode()

req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
resp = urllib.request.urlopen(req, timeout=30)
print(resp.read().decode()[:200])
