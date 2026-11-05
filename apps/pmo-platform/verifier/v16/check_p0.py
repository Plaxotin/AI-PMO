from pathlib import Path
import hashlib
import json

ROOT = Path('/mnt/agents/output/app')
BEFORE = Path('/mnt/agents/output/rollback/step3/app-before')
checks = {}

def same_file(current, previous):
    return hashlib.sha256(current.read_bytes()).hexdigest() == hashlib.sha256(previous.read_bytes()).hexdigest()

workspace = (ROOT / 'public/workspace.html').read_text()
api = (ROOT / 'api/queries/pmo.ts').read_text()
router = (ROOT / 'api/pmo-router.ts').read_text()
schema = (ROOT / 'db/schema.ts').read_text()
landing = (ROOT / 'public/landing.html').read_text()

checks['landing_byte_identical'] = same_file(ROOT / 'public/landing.html', BEFORE / 'landing.html')
checks['matreshka_png_byte_identical'] = same_file(ROOT / 'public/matreshka-full-cycle.png', BEFORE / 'matreshka-full-cycle.png')
checks['demo_local_state_removed'] = 'aiPmoDemoState.v1' not in workspace and 'restoreDemoState()' not in workspace
checks['server_state_used'] = "pmoApi('state')" in workspace and 'applyServerState' in workspace
checks['server_decision_mutation_used'] = "pmoApi('decide'" in workspace
checks['client_role_switch_removed'] = "setRole('member')" not in workspace and "onclick=\"setRole" not in workspace
checks['admin_mutation_server_side'] = 'decide: adminQuery' in router
checks['read_state_authenticated'] = 'state: authedQuery' in router
checks['zod_input_validation'] = '.input(z.object({' in router
checks['atomic_transaction'] = 'getDb().transaction(async (tx)' in api
checks['decision_task_link'] = 'decisionId: decision.id' in api and 'uniqueIndex("tasks_decision_unique")' in schema
checks['audit_decision_and_task'] = 'decision.accepted' in api and 'task.created' in api
checks['audit_ui'] = 'Серверный журнал событий' in workspace
checks['external_channels_not_faked'] = 'не подключён: это демо целевого сценария' in workspace and 'без подключения внешних каналов' in landing
checks['dynamic_entry'] = (ROOT / 'Dockerfile').is_file() and (ROOT / 'dist/boot.js').is_file()
checks['built_workspace'] = (ROOT / 'dist/public/workspace.html').is_file()
checks['built_landing'] = (ROOT / 'dist/public/landing.html').is_file()
checks['browser_results'] = json.loads((ROOT / 'verifier/v16/browser-results.json').read_text())['js_errors'] == []
checks['production_results'] = json.loads((ROOT / 'verifier/v16/production-results.json').read_text())['persistent_after_cold_start']

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(('PASS' if ok else 'FAIL'), name)
print(f'\n{len(checks) - len(failed)}/{len(checks)} checks passed')
if failed:
    raise SystemExit('Failed: ' + ', '.join(failed))
