import requests, json, sys

with open('../.credentials/telegram.json') as f:
    cfg = json.load(f)

url = f"https://api.telegram.org/bot{cfg['bot_token']}/getUpdates?limit=5"
r = requests.get(url, timeout=10)
print('Status:', r.status_code)
if r.status_code == 200:
    data = r.json()
    print('ok:', data.get('ok'))
    print('updates count:', len(data.get('result', [])))
    for u in data.get('result', []):
        msg = u.get('message', {})
        print(f"  update_id={u.get('update_id')} chat={msg.get('chat',{}).get('id')} text={msg.get('text','')[:50]}")
else:
    print(r.text)
