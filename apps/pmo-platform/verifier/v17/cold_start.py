from pathlib import Path
import json
import os
import shutil
import socket
import subprocess
import time
import urllib.request

ROOT = Path('/mnt/agents/output/app')
OUT = ROOT / 'verifier/v17'
COLD = Path('/tmp/pmo-telegram-cold-dist')
auth = json.loads(Path('/tmp/p0-test-auth.json').read_text())
app = None
result = {}
if COLD.exists():
    shutil.rmtree(COLD)
COLD.mkdir()
shutil.copytree(ROOT / 'dist', COLD / 'dist')
assert not (COLD / 'node_modules').exists() and not Path('/tmp/node_modules').exists()
try:
    env = os.environ.copy(); env['NODE_ENV'] = 'production'
    for raw in (ROOT / '.env').read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        env[key.strip()] = value
    log = open(OUT / 'cold-start-server.log', 'w')
    app = subprocess.Popen(['node', 'dist/boot.js'], cwd=COLD, env=env, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(80):
        if app.poll() is not None:
            raise RuntimeError('cold production process exited')
        try:
            with socket.create_connection(('127.0.0.1', 3000), timeout=0.3):
                break
        except OSError:
            time.sleep(0.25)
    else:
        raise RuntimeError('cold production process did not start')
    with urllib.request.urlopen('http://127.0.0.1:3000/landing.html', timeout=20) as response:
        result['landing_without_node_modules'] = response.status == 200
    req = urllib.request.Request('http://127.0.0.1:3000/api/trpc/pmo.state', headers={'Cookie': 'kimi_sid=' + auth['rp']['token']})
    with urllib.request.urlopen(req, timeout=30) as response:
        body = json.loads(response.read())
        state = body['result']['data']['json']
        task = next(x for x in state['tasks'] if x['id'] == 'P-D-TG-978100001')
        result['database_read_without_node_modules'] = task['st'] == 'done' and bool(task['result'])
        result['audit_read_without_node_modules'] = any(x['eventType'] == 'result.recorded' for x in state['events'])
    log.close()
    result['all_checks_passed'] = all(result.values())
    (OUT / 'cold-start-results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))
finally:
    if app is not None and app.poll() is None:
        app.terminate()
        try:
            app.wait(timeout=15)
        except subprocess.TimeoutExpired:
            app.kill(); app.wait(timeout=5)
    shutil.rmtree(COLD)
