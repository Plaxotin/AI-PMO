from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(os.environ.get('PMO_CONTRACT_ROOT', '/mnt/agents/output/app')).resolve()
OUT = ROOT / 'verifier/v17'
BASE_UPDATE = 978100001
DECISION_ID = 'R-01'
CHAT_ID = -100900
MIGRATED_CHAT_ID = -100903
RP_ID = 101
MEMBER_ID = 202
SECRET = 'contract-webhook-secret'
TOKEN = 'contract-bot-token'
BASE = 'http://127.0.0.1:3000'
state = {'ai_fail': False, 'ai_chat_calls': 0, 'next_message_id': 7000, 'telegram': [], 'ai': []}


def analysis_for(text):
    if 'Обычное обсуждение' in text:
        return {
            'isRisk': False, 'confidence': 0.96, 'riskTitle': '', 'impact': '',
            'probability': 'низкая', 'proposalTitle': '', 'rationale': '',
            'effect': '', 'measure': '', 'owner': '', 'due': ''
        }
    return {
        'isRisk': True,
        'confidence': 0.94,
        'riskTitle': 'Перенос поставки лицензий блокирует тестирование интеграции',
        'impact': 'Тестирование 25.09 не сможет начаться без лицензий, поставка подтверждена только на 30.09.',
        'probability': 'активный',
        'proposalTitle': 'Перенести тестирование после поставки и запросить у поставщика ускорение',
        'rationale': 'Дата поставки позже запланированного начала тестирования; требуется решение РП о новой контрольной точке.',
        'effect': 'Снижение риска каскадного сдвига приёмки; точный эффект требует оценки РП.',
        'measure': 'Обновить контрольную точку тестирования после подтверждения поставки.',
        'owner': 'Бессонов К.',
        'due': '30.09'
    }


class MockHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def json_response(self, status, body):
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == '/ai/models':
            self.json_response(200, {'data': [{'id': 'contract-model', 'display_name': 'Contract model'}], 'default_model_id': 'contract-model'})
            return
        self.json_response(404, {'ok': False})

    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        payload = json.loads(self.rfile.read(length) or b'{}')
        if self.path == '/ai/chat/completions':
            state['ai_chat_calls'] += 1
            state['ai'].append(payload)
            if state['ai_fail']:
                self.json_response(403, {'error': {'type': 'access_terminated_error', 'message': 'contract quota exhausted'}})
                return
            user_text = '\n'.join(str(m.get('content', '')) for m in payload.get('messages', []) if m.get('role') == 'user')
            content = json.dumps(analysis_for(user_text), ensure_ascii=False)
            self.json_response(200, {
                'id': 'chatcmpl-contract', 'object': 'chat.completion', 'created': 1,
                'model': payload.get('model', 'contract-model'),
                'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': content}, 'finish_reason': 'stop'}],
                'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}
            })
            return
        prefix = f'/telegram/bot{TOKEN}/'
        if self.path.startswith(prefix):
            method = self.path[len(prefix):]
            state['telegram'].append({'method': method, 'payload': payload})
            if method == 'sendMessage':
                state['next_message_id'] += 1
                result = {'message_id': state['next_message_id']}
            elif method == 'getMe':
                result = {'id': 9001, 'username': 'contract_pmo_bot'}
            elif method == 'getWebhookInfo':
                result = {'url': 'https://contract.example/api/telegram/webhook', 'pending_update_count': 0}
            else:
                result = True
            state['telegram'][-1]['result'] = result
            self.json_response(200, {'ok': True, 'result': result})
            return
        self.json_response(404, {'ok': False, 'description': 'unknown mock route'})


def request(method, url, payload=None, secret=None):
    headers = {'Accept': 'application/json'}
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode()
        headers['Content-Type'] = 'application/json'
    if secret is not None:
        headers['x-telegram-bot-api-secret-token'] = secret
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            return response.status, json.loads(response.read() or b'{}')
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b'{}')


def message(update_id, message_id, text, user_id=MEMBER_ID, chat_id=CHAT_ID, reply_to=None):
    body = {
        'update_id': update_id,
        'message': {
            'message_id': message_id,
            'from': {'id': user_id, 'first_name': 'Участник' if user_id == MEMBER_ID else 'РП'},
            'chat': {'id': chat_id}, 'text': text
        }
    }
    if reply_to is not None:
        body['message']['reply_to_message'] = {'message_id': reply_to}
    return body


def migration_to(update_id, message_id):
    body = message(update_id, message_id, '', chat_id=CHAT_ID)
    body['message']['migrate_to_chat_id'] = MIGRATED_CHAT_ID
    return body


def migration_from(update_id, message_id):
    body = message(update_id, message_id, '', chat_id=MIGRATED_CHAT_ID)
    body['message']['migrate_from_chat_id'] = CHAT_ID
    return body


def callback(update_id, user_id, data, message_id, chat_id=RP_ID):
    return {
        'update_id': update_id,
        'callback_query': {
            'id': f'cb-{update_id}',
            'from': {'id': user_id, 'first_name': 'РП' if user_id == RP_ID else 'Участник'},
            'data': data,
            'message': {'message_id': message_id, 'chat': {'id': chat_id}}
        }
    }


def webhook(update, secret=SECRET, expected=200):
    status, body = request('POST', BASE + '/api/telegram/webhook', update, secret)
    assert status == expected, (status, body, update)
    return body


def db_read(label, mode='read'):
    result = subprocess.run([os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/s', '/c', 'npx', 'tsx', '-r', 'dotenv/config', 'verifier/v17/db_evidence.ts', mode], cwd=ROOT, check=True, capture_output=True, text=True, encoding='utf-8', timeout=120)
    data = json.loads(result.stdout)
    (OUT / f'db-{label}.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    return data


def run_completion_scheduler(label, at):
    expression = f"import {{ runDueCompletionChecks }} from './api/telegram/completion-scheduler'; console.log(JSON.stringify(await runDueCompletionChecks(new Date('{at}')))); process.exit(0);"
    result = subprocess.run([
        os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/s', '/c', 'npx', 'tsx', '-r', 'dotenv/config', '-e', expression
    ], cwd=ROOT, env=env, check=True, capture_output=True, text=True, encoding='utf-8', timeout=120)
    data = json.loads(result.stdout)
    (OUT / f'scheduler-{label}.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    return data


def telegram_calls(method):
    return [x for x in state['telegram'] if x['method'] == method]


mock = ThreadingHTTPServer(('127.0.0.1', 0), MockHandler)
thread = threading.Thread(target=mock.serve_forever, daemon=True)
thread.start()
port = mock.server_address[1]
app_log = open(OUT / 'production-contract-server.log', 'w')
env = os.environ.copy()
env.update({
    'NODE_ENV': 'production',
    'TELEGRAM_BOT_TOKEN': TOKEN,
    'TELEGRAM_WEBHOOK_SECRET': SECRET,
    'TELEGRAM_PROJECT_CHAT_IDS': f'{CHAT_ID},-100902',
    'TELEGRAM_RP_USER_IDS': str(RP_ID),
    'TELEGRAM_MEMBER_USER_IDS': str(MEMBER_ID),
    'TELEGRAM_API_BASE_URL': f'http://127.0.0.1:{port}/telegram',
    'TELEGRAM_GATEWAY_SECRET': '',
    'KIMI_AGENTGW_API_KEY': 'contract-ai-key',
    'KIMI_AGENTGW_BASE_URL': f'http://127.0.0.1:{port}/ai',
})
app = None
results = {'mode': 'contract test with mock Telegram Bot API and mock AI gateway; not a real Telegram connection', 'checks': {}}
try:
    try:
        with socket.create_connection(('127.0.0.1', 3000), timeout=0.3):
            raise RuntimeError('port 3000 is already occupied; refusing to test another process')
    except OSError:
        pass
    app = subprocess.Popen([os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/s', '/c', 'node', 'dist/boot.js'], cwd=ROOT, env=env, stdout=app_log, stderr=subprocess.STDOUT)
    for _ in range(90):
        if app.poll() is not None:
            raise RuntimeError('production server exited; see production-contract-server.log')
        try:
            with socket.create_connection(('127.0.0.1', 3000), timeout=0.3):
                break
        except OSError:
            time.sleep(0.25)
    else:
        raise RuntimeError('production server did not start')

    body = webhook(message(BASE_UPDATE + 10, 910, 'Чужой чат', chat_id=-100901), expected=200)
    assert body.get('ignored') == 'chat'
    results['checks']['foreign_chat_ignored'] = True

    body = webhook(message(BASE_UPDATE + 11, 911, '/status', user_id=RP_ID, chat_id=-100902))
    assert body.get('status') == 'processed'
    assert any(str(x['payload'].get('chat_id')) == str(RP_ID) and 'только для наблюдения' in x['payload'].get('text', '') for x in telegram_calls('sendMessage'))
    assert not any(str(x['payload'].get('chat_id')) == '-100902' for x in telegram_calls('sendMessage'))
    results['checks']['second_project_chat_allowed'] = True

    webhook(message(BASE_UPDATE, 900, 'Поставщик перенёс лицензии с 20.09 на 30.09, тестирование назначено на 25.09.'), secret='wrong', expected=401)
    results['checks']['wrong_secret_401'] = True

    body = webhook(message(BASE_UPDATE + 2, 902, 'Сигнал от неизвестного пользователя', user_id=999))
    assert body.get('status') == 'ignored'
    results['checks']['unknown_user_ignored'] = True

    status, _ = request('GET', BASE + '/api/trpc/telegram.status')
    assert status == 401
    status, _ = request('POST', BASE + '/api/trpc/telegram.configure', {'json': {'webhookUrl': 'https://example.com/api/telegram/webhook'}})
    assert status == 401
    results['checks']['status_and_configure_require_auth'] = True

    before_ai = state['ai_chat_calls']
    body = webhook(message(BASE_UPDATE, 900, 'Поставщик перенёс лицензии с 20.09 на 30.09, тестирование назначено на 25.09.'))
    assert body.get('status') == 'processed'
    assert state['ai_chat_calls'] == before_ai + 1
    proposals = [x for x in telegram_calls('sendMessage') if f'accept:{DECISION_ID}' in json.dumps(x['payload'].get('reply_markup', {}))]
    assert len(proposals) == 1
    assert str(proposals[0]['payload'].get('chat_id')) == str(RP_ID)
    assert 'reply_to_message_id' not in proposals[0]['payload']
    proposal_message_id = proposals[0]['result']['message_id']
    keyboard = proposals[0]['payload']['reply_markup']['inline_keyboard']
    callback_data = [b['callback_data'] for row in keyboard for b in row]
    button_texts = [b['text'] for row in keyboard for b in row]
    assert f'open:R-TG-{BASE_UPDATE}' in callback_data and f'accept:{DECISION_ID}' in callback_data
    assert '✅ Принять' in button_texts and '✅ Принять предложение' not in button_texts
    results['checks']['signal_ai_risk_proposal_message'] = True

    body = webhook(message(BASE_UPDATE, 900, 'Поставщик перенёс лицензии с 20.09 на 30.09, тестирование назначено на 25.09.'))
    assert body.get('duplicate') is True
    proposals_after = [x for x in telegram_calls('sendMessage') if f'accept:{DECISION_ID}' in json.dumps(x['payload'].get('reply_markup', {}))]
    assert len(proposals_after) == 1 and state['ai_chat_calls'] == before_ai + 1
    results['checks']['update_deduplicated_without_second_ai_or_message'] = True

    body = webhook(message(BASE_UPDATE + 3, 903, 'Обычное обсуждение без последствий для проекта'))
    assert body.get('status') == 'ignored'
    results['checks']['non_risk_ignored'] = True

    body = webhook(callback(BASE_UPDATE + 20, MEMBER_ID, f'accept:{DECISION_ID}', proposal_message_id, chat_id=CHAT_ID))
    assert body.get('status') == 'ignored'
    denied = db_read('after-member-denied')
    assert denied['decisions'][0]['status'] == 'wait' and not denied['tasks']
    results['checks']['member_cannot_approve'] = True

    body = webhook(callback(BASE_UPDATE + 21, RP_ID, f'open:R-TG-{BASE_UPDATE}', proposal_message_id))
    assert body.get('status') == 'processed'
    assert any(str(x['payload'].get('chat_id')) == str(RP_ID) and 'Обоснование:' in x['payload'].get('text', '') for x in telegram_calls('sendMessage'))
    results['checks']['rp_can_open_risk_with_source'] = True

    body = webhook(callback(BASE_UPDATE + 22, RP_ID, f'accept:{DECISION_ID}', proposal_message_id))
    assert body.get('status') == 'processed'
    accepted = db_read('after-accept')
    assert accepted['decisions'][0]['status'] == 'ok'
    assert len(accepted['tasks']) == 1 and accepted['tasks'][0]['decisionId'] == DECISION_ID
    assert any(x['eventType'] == 'decision.accepted' for x in accepted['events'])
    assert any(x['eventType'] == 'task.created' for x in accepted['events'])
    assert accepted['risks'][0]['confidence'] == 94
    assert len(accepted['proposalVersions']) == 1 and accepted['proposalVersions'][0]['version'] == 1
    created_event = next(x for x in accepted['events'] if x['eventType'] == 'proposal.created')
    assert created_event['channel'] == 'telegram' and created_event['version'] == 1
    assert created_event['sourceLinks'][0]['status'] == 'available'
    assert any(str(x['payload'].get('chat_id')) == str(RP_ID) for x in telegram_calls('editMessageText'))
    results['checks']['decision_and_task_atomically_linked'] = True

    body = webhook(callback(BASE_UPDATE + 22, RP_ID, f'accept:{DECISION_ID}', proposal_message_id))
    assert body.get('duplicate') is True
    body = webhook(callback(BASE_UPDATE + 23, RP_ID, f'accept:{DECISION_ID}', proposal_message_id))
    assert body.get('status') == 'processed'
    repeated = db_read('after-repeat-decision')
    assert len(repeated['tasks']) == 1
    assert sum(x['eventType'] == 'decision.accepted' for x in repeated['events']) == 1
    results['checks']['repeat_decision_returns_state_without_duplicate_task'] = True

    accepted_cards = [x for x in telegram_calls('editMessageText') if f'Решение {DECISION_ID}' in x['payload'].get('text', '')]
    assert accepted_cards and all('result:' not in json.dumps(x['payload']) for x in accepted_cards)
    body = webhook(callback(BASE_UPDATE + 24, RP_ID, f"result:{accepted['tasks'][0]['id']}", proposal_message_id))
    assert body.get('status') == 'ignored'
    assert not any(x['payload'].get('reply_markup', {}).get('force_reply') for x in telegram_calls('sendMessage'))

    db_read('due-set', 'set-due')
    early = run_completion_scheduler('before-nine', '2026-11-07T05:59:00.000Z')
    assert early['claimed'] == 0 and early['sent'] == 0
    first_run = run_completion_scheduler('at-nine', '2026-11-07T06:00:00.000Z')
    assert first_run['claimed'] == 1 and first_run['sent'] == 1 and first_run['failed'] == 0
    second_run = run_completion_scheduler('at-nine-repeat', '2026-11-07T06:00:30.000Z')
    assert second_run['claimed'] == 0 and second_run['sent'] == 0 and second_run['duplicates'] == 1
    prompt_db = db_read('after-completion-prompt')
    assert len(prompt_db['completionChecks']) == 1
    check = prompt_db['completionChecks'][0]
    assert check['status'] == 'pending' and check['dueVersion'] == '2026-11-07'
    check_id = check['id']
    prompts = [x for x in telegram_calls('sendMessage') if f'cd:{check_id}' in json.dumps(x['payload'].get('reply_markup', {}))]
    assert len(prompts) == 1 and str(prompts[0]['payload'].get('chat_id')) == str(RP_ID)
    prompt_text = prompts[0]['payload'].get('text', '')
    assert 'Поручение выполнено?' in prompt_text
    assert 'Автор исходного сигнала: Участник' in prompt_text and 'Ответственный: Бессонов К.' in prompt_text
    assert 'Дата создания:' in prompt_text and 'Срок: 07.11.2026' in prompt_text
    assert 'Источник: https://t.me/c/900/900' in prompt_text
    prompt_message_id = prompts[0]['result']['message_id']

    body = webhook(callback(BASE_UPDATE + 25, RP_ID, f'cn:{check_id}', prompt_message_id))
    assert body.get('status') == 'processed'
    not_done = db_read('after-not-done')
    assert not_done['tasks'][0]['status'] == 'new' and not_done['completionChecks'][0]['status'] == 'not_done'
    assert not any(x['eventType'] == 'result.recorded' for x in not_done['events'])
    not_done_cards = [x for x in telegram_calls('editMessageText') if 'Ответ сохранён: поручение не выполнено и остаётся открытым.' in x['payload'].get('text', '')]
    assert len(not_done_cards) == 1
    keyboard = not_done_cards[0]['payload'].get('reply_markup', {}).get('inline_keyboard', [])
    assert f'cd:{check_id}' in json.dumps(keyboard) and f'cn:{check_id}' in json.dumps(keyboard)
    body = webhook(callback(BASE_UPDATE + 26, RP_ID, f'cn:{check_id}', prompt_message_id))
    assert body.get('status') == 'processed'
    not_done_repeat = db_read('after-not-done-repeat')
    assert sum(x['eventType'] == 'task.completion_not_done' for x in not_done_repeat['events']) == 1

    body = webhook(callback(BASE_UPDATE + 27, RP_ID, f'cd:{check_id}', prompt_message_id))
    assert body.get('status') == 'processed'
    completed = db_read('after-completion-done')
    assert completed['tasks'][0]['status'] == 'done' and completed['completionChecks'][0]['status'] == 'done'
    assert completed['completionChecks'][0]['effectStatus'] == 'sent'
    assert sum(x['eventType'] == 'result.recorded' for x in completed['events']) == 1
    assert sum(x['eventType'] == 'effect.reported' for x in completed['events']) == 1
    effect_messages = [x for x in telegram_calls('sendMessage') if 'Ожидаемый эффект:' in x['payload'].get('text', '')]
    assert len(effect_messages) == 1 and 'не подтверждён фактическими данными' in effect_messages[0]['payload']['text']
    body = webhook(callback(BASE_UPDATE + 28, RP_ID, f'cd:{check_id}', prompt_message_id))
    assert body.get('status') == 'processed'
    completed_repeat = db_read('after-completion-done-repeat')
    assert sum(x['eventType'] == 'result.recorded' for x in completed_repeat['events']) == 1
    assert sum(x['eventType'] == 'effect.reported' for x in completed_repeat['events']) == 1
    assert len([x for x in telegram_calls('sendMessage') if 'Ожидаемый эффект:' in x['payload'].get('text', '')]) == 1
    results['checks']['completion_check_and_effect_flow'] = True

    state['ai_fail'] = True
    before_failed_ai = state['ai_chat_calls']
    body = webhook(message(BASE_UPDATE + 1, 901, 'Новый риск при недоступном AI'))
    assert body.get('status') == 'error'
    assert state['ai_chat_calls'] == before_failed_ai + 1
    assert any(str(x['payload'].get('chat_id')) == str(RP_ID) and 'AI-анализ сейчас недоступен' in x['payload'].get('text', '') for x in telegram_calls('sendMessage'))
    state['ai_fail'] = False
    results['checks']['ai_failure_degrades_without_risk_or_retry'] = True

    configure_env = env.copy()
    configured = subprocess.run([
        os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/s', '/c', 'npx', 'tsx', '-r', 'dotenv/config', '-e',
        "import { configureTelegramWebhook } from './api/telegram/client'; console.log(JSON.stringify(await configureTelegramWebhook('https://contract.example/api/telegram/webhook')));"
    ], cwd=ROOT, env=configure_env, check=True, capture_output=True, text=True, timeout=120)
    configure_result = json.loads(configured.stdout)
    assert configure_result['bot']['username'] == 'contract_pmo_bot'
    set_webhook = telegram_calls('setWebhook')[-1]['payload']
    assert set_webhook['url'].endswith('/api/telegram/webhook') and set_webhook['secret_token'] == SECRET
    results['checks']['set_webhook_contract'] = True

    final = db_read('final')
    assert len(final['signals']) == 3
    signal_by_id = {x['id']: x for x in final['signals']}
    assert signal_by_id[f'S-TG-{BASE_UPDATE}']['status'] == 'risk_created'
    assert signal_by_id[f'S-TG-{BASE_UPDATE + 1}']['status'] == 'error'
    assert signal_by_id[f'S-TG-{BASE_UPDATE + 3}']['status'] == 'ignored'
    assert f'S-TG-{BASE_UPDATE + 2}' not in signal_by_id
    assert len(final['risks']) == 1 and len(final['decisions']) == 1 and len(final['tasks']) == 1
    task = final['tasks'][0]
    assert task['status'] == 'done' and 'Выполнение подтверждено РП' in task['result'] and task['completedByName'] == 'РП'
    assert task['completedAt'] and not final['pendingResults']
    assert len(final['completionChecks']) == 1 and final['completionChecks'][0]['status'] == 'done'
    assert final['completionChecks'][0]['effectStatus'] == 'sent'
    expected_events = {'signal.received', 'risk.recorded', 'proposal.created', 'decision.accepted', 'task.created', 'task.completion_asked', 'task.completion_not_done', 'result.recorded', 'effect.reported'}
    main_entities = {f'S-TG-{BASE_UPDATE}', f'R-TG-{BASE_UPDATE}', DECISION_ID, task['id']}
    main_events = [x for x in final['events'] if x['entityId'] in main_entities]
    actual_events = [x['eventType'] for x in main_events]
    assert expected_events.issubset(set(actual_events)), actual_events
    assert all(actual_events.count(name) == 1 for name in expected_events), actual_events
    assert not any(x['updateId'] == BASE_UPDATE + 10 for x in final['updates'])
    results['checks']['full_chain_audit_and_web_registry_records'] = True
    results['checks']['database_final_readback'] = True

    body = webhook(migration_to(BASE_UPDATE + 30, 930))
    assert body.get('status') == 'processed'
    body = webhook(migration_from(BASE_UPDATE + 31, 931))
    assert body.get('status') == 'processed'
    body = webhook(migration_from(BASE_UPDATE + 31, 931))
    assert body.get('duplicate') is True
    body = webhook(message(BASE_UPDATE + 32, 932, '/status', user_id=RP_ID, chat_id=MIGRATED_CHAT_ID))
    assert body.get('status') == 'processed'
    body = webhook(message(BASE_UPDATE + 33, 933, 'Обычное обсуждение после миграции', chat_id=MIGRATED_CHAT_ID))
    assert body.get('status') == 'ignored'
    migrated = db_read('after-chat-migration')
    aliases = {x['externalId']: x for x in migrated['channelExternalIds']}
    old_alias = aliases[str(CHAT_ID)]
    new_alias = aliases[str(MIGRATED_CHAT_ID)]
    assert old_alias['channelId'] == new_alias['channelId']
    assert old_alias['status'] == 'migrated' and new_alias['status'] == 'active'
    migration_events = [x for x in migrated['events'] if x['eventType'] == 'channel.migrated']
    assert len(migration_events) == 1
    migrated_signals = {x['id']: x for x in migrated['signals']}
    old_signal = migrated_signals[f'S-TG-{BASE_UPDATE}']
    new_signal = migrated_signals[f'S-TG-{BASE_UPDATE + 33}']
    assert old_signal['channelId'] == new_signal['channelId'] == old_alias['channelId']
    assert old_signal['chatId'] == str(CHAT_ID) and new_signal['chatId'] == str(MIGRATED_CHAT_ID)
    old_source_event = next(x for x in migrated['events'] if x['entityId'] == old_signal['id'] and x['eventType'] == 'signal.received')
    assert old_source_event['sourceLinks'][0]['url'].endswith(f'/{900}')
    monitored_chat_ids = {str(CHAT_ID), '-100902', str(MIGRATED_CHAT_ID)}
    monitored_writes = [
        {'method': method, 'payload': x['payload']}
        for method in ('sendMessage', 'editMessageText')
        for x in telegram_calls(method)
        if str(x['payload'].get('chat_id')) in monitored_chat_ids
    ]
    assert not monitored_writes, monitored_writes
    results['checks']['chat_migration_preserves_channel_and_source_history'] = True

    results['telegram_methods'] = [x['method'] for x in state['telegram']]
    results['ai_chat_calls'] = state['ai_chat_calls']
    results['ai_structured_output_request'] = bool(state['ai'] and state['ai'][0].get('response_format'))
    results['final_entities'] = final['ids']
    results['result_task'] = task
    results['all_checks_passed'] = all(results['checks'].values())
    (OUT / 'contract-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(results, ensure_ascii=False, indent=2))

    # Separate restart/replay acceptance: preserve the original 18-check artifact.
    before_restart = db_read('before-restart')
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(app.pid), '/T', '/F'], check=True, capture_output=True, timeout=15)
    else:
        app.terminate()
    app.wait(timeout=15)
    app = None
    app_log.close()
    app_log = open(OUT / 'restart-replay-server.log', 'w')
    app = subprocess.Popen([os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/s', '/c', 'node', 'dist/boot.js'], cwd=ROOT, env=env, stdout=app_log, stderr=subprocess.STDOUT)
    for _ in range(90):
        if app.poll() is not None:
            raise RuntimeError('restarted production server exited; see restart-replay-server.log')
        try:
            with socket.create_connection(('127.0.0.1', 3000), timeout=0.3):
                break
        except OSError:
            time.sleep(0.25)
    else:
        raise RuntimeError('restarted production server did not start')

    after_restart = db_read('after-restart')
    assert after_restart == before_restart
    restart_checks = {'restart_preserves_registry_and_audit': True}

    before_ai_calls = state['ai_chat_calls']
    before_telegram_calls = len(state['telegram'])
    restart_scheduler = run_completion_scheduler('after-restart', '2026-11-07T06:01:00.000Z')
    assert restart_scheduler['claimed'] == 0 and restart_scheduler['sent'] == 0 and restart_scheduler['effectsSent'] == 0
    restart_checks['restart_scheduler_does_not_repeat_question_or_effect'] = True
    for replay in [
        message(BASE_UPDATE, 900, 'Поставщик перенёс лицензии с 20.09 на 30.09, тестирование назначено на 25.09.'),
        callback(BASE_UPDATE + 23, RP_ID, f'accept:{DECISION_ID}', proposal_message_id),
        callback(BASE_UPDATE + 25, RP_ID, f'cn:{check_id}', prompt_message_id),
        callback(BASE_UPDATE + 26, RP_ID, f'cn:{check_id}', prompt_message_id),
        callback(BASE_UPDATE + 27, RP_ID, f'cd:{check_id}', prompt_message_id),
        callback(BASE_UPDATE + 28, RP_ID, f'cd:{check_id}', prompt_message_id),
        migration_from(BASE_UPDATE + 31, 931),
    ]:
        assert webhook(replay).get('duplicate') is True
    assert state['ai_chat_calls'] == before_ai_calls
    assert len(state['telegram']) == before_telegram_calls
    after_replay = db_read('after-restart-replay')
    assert after_replay == after_restart
    restart_checks['replay_message_callback_result_migration_no_duplicates'] = True
    restart_checks['replay_does_not_repeat_ai_or_telegram'] = True

    replay_task = after_replay['tasks'][0]
    replay_decision = next(x for x in after_replay['decisions'] if x['id'] == replay_task['decisionId'])
    replay_risk = next(x for x in after_replay['risks'] if x['id'] == replay_decision['riskId'])
    replay_signal = next(x for x in after_replay['signals'] if x['id'] == replay_risk['id'].replace('R-TG-', 'S-TG-', 1))
    replay_source = next(x for x in after_replay['events'] if x['entityId'] == replay_signal['id'] and x['eventType'] == 'signal.received')
    assert replay_task['riskId'] == replay_risk['id'] and replay_decision['riskId'] == replay_risk['id']
    assert replay_signal['riskId'] == replay_risk['id']
    assert replay_source['sourceLinks'][0]['status'] == 'available'
    assert replay_source['sourceLinks'][0]['url'].endswith(f"/{replay_signal['messageId']}")
    restart_checks['task_decision_risk_signal_source_chain'] = True

    replay_aliases = {x['externalId']: x for x in after_replay['channelExternalIds']}
    assert replay_aliases[str(CHAT_ID)]['channelId'] == replay_aliases[str(MIGRATED_CHAT_ID)]['channelId']
    assert replay_aliases[str(CHAT_ID)]['status'] == 'migrated'
    assert replay_aliases[str(MIGRATED_CHAT_ID)]['status'] == 'active'
    assert old_signal['channelId'] == new_signal['channelId'] == replay_aliases[str(CHAT_ID)]['channelId']
    restart_checks['migration_alias_and_history_survive_restart'] = True

    restart_results = {
        'mode': 'restart/replay on the same isolated MySQL database with mock Telegram Bot API and mock AI; not a real Telegram connection',
        'checks': restart_checks,
        'all_checks_passed': all(restart_checks.values()),
    }
    (OUT / 'restart-replay-results.json').write_text(json.dumps(restart_results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(restart_results, ensure_ascii=False, indent=2))
finally:
    if app is not None and app.poll() is None:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(app.pid), '/T', '/F'], capture_output=True, timeout=15)
        else:
            app.terminate()
        try:
            app.wait(timeout=15)
        except subprocess.TimeoutExpired:
            app.kill(); app.wait(timeout=5)
    app_log.close()
    mock.shutdown(); mock.server_close(); thread.join(timeout=5)
