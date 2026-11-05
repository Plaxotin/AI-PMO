from pathlib import Path
import hashlib
import json

ROOT = Path('/mnt/agents/output/app')
BACKUP = Path('/mnt/agents/output/rollback/step4/app-p0/public')
OUT = ROOT / 'verifier/v17'
checks = {}

def text(path):
    return path.read_text()

def same(a, b):
    return hashlib.sha256(a.read_bytes()).hexdigest() == hashlib.sha256(b.read_bytes()).hexdigest()

route = text(ROOT / 'api/routes/telegram.ts')
queries = text(ROOT / 'api/queries/telegram.ts')
pmo = text(ROOT / 'api/queries/pmo.ts')
schema = text(ROOT / 'db/schema.ts')
config = text(ROOT / 'api/telegram/config.ts')
client = text(ROOT / 'api/telegram/client.ts')
router = text(ROOT / 'api/telegram-router.ts')
ai = text(ROOT / 'api/ai/risk.ts')
workspace = text(ROOT / 'public/workspace.html')
boot = text(ROOT / 'api/boot.ts')
contract = json.loads(text(OUT / 'contract-results.json'))
browser = json.loads(text(OUT / 'browser-results.json'))
cold = json.loads(text(OUT / 'cold-start-results.json'))
real_ai = json.loads(text(OUT / 'ai-real-probe.json'))

checks['landing_byte_identical'] = same(ROOT / 'public/landing.html', BACKUP / 'landing.html')
checks['matreshka_png_byte_identical'] = same(ROOT / 'public/matreshka-full-cycle.png', BACKUP / 'matreshka-full-cycle.png')
checks['webhook_registered_before_api_catchall'] = boot.index('app.route("/api/telegram", telegramRoutes)') < boot.index('app.all("/api/*"')
checks['webhook_secret_constant_time'] = 'timingSafeEqual' in route and 'x-telegram-bot-api-secret-token' in route
checks['project_chat_allowlist'] = 'config.projectChatIds.has(String(chatId))' in route and 'TELEGRAM_PROJECT_CHAT_IDS' in config
checks['server_side_role_lists'] = 'TELEGRAM_RP_USER_IDS' in config and 'TELEGRAM_MEMBER_USER_IDS' in config
checks['unknown_users_ignored'] = 'if (!role) return "ignored"' in route
checks['only_rp_can_approve'] = 'if (role !== "rp")' in route
checks['update_deduplication'] = 'telegram_updates' in schema and 'claimTelegramUpdate' in route and 'isDuplicateEntry' in queries
checks['signal_deduplication'] = 'signals_chat_message_unique' in schema
checks['shared_web_telegram_decision_operation'] = 'decideProposalRecord' in route and 'getDb().transaction(async (tx)' in pmo
checks['one_task_per_decision'] = 'uniqueIndex("tasks_decision_unique")' in schema
checks['atomic_result_and_audit'] = 'completeTaskResult' in queries and 'result.recorded' in queries and 'for("update")' in queries
checks['full_chain_audit'] = all(name in queries or name in pmo for name in ['signal.received', 'risk.recorded', 'proposal.created', 'decision.accepted', 'task.created', 'result.recorded'])
checks['runtime_model_discovery'] = 'await listModels()' in ai and 'defaultModelId' in ai
checks['structured_ai_output'] = 'generateObject({' in ai and 'riskAnalysisSchema' in ai
checks['ai_error_classification'] = 'classifyAiError(error)' in ai
checks['ai_degradation_without_fake_risk'] = 'AI-анализ сейчас недоступен. Риск и предложение не созданы' in route
checks['telegram_status_admin_only'] = 'status: adminQuery' in router and 'configure: adminQuery' in router
checks['webhook_configuration_https'] = 'startsWith("https://")' in router and 'setWebhook' in client
checks['no_secrets_in_frontend'] = all(secret not in workspace for secret in ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'KIMI_AGENTGW_API_KEY', 'KIMI_AGENTGW_BASE_URL'])
checks['secrets_excluded_from_git'] = '.env' in text(ROOT / '.gitignore') and '.credentials/' in text(ROOT / '.gitignore')
checks['honest_ui_status'] = 'restoreTelegramStatus' in workspace and 'webhook подключён' in workspace and 'нужны серверные доступы' in workspace
checks['result_visible_in_tasks'] = 'Результат:' in workspace and 'completedByName' in workspace
checks['real_ai_probe'] = real_ai['generateObject_structured_result'] and real_ai['result']['isRisk']
checks['contract_all_passed'] = contract['all_checks_passed'] and len(contract['checks']) == 18
checks['browser_all_passed'] = browser['all_checks_passed'] and not browser['js_errors'] and not browser['local_404']
checks['cold_start_without_node_modules'] = cold['all_checks_passed']
checks['production_entries'] = (ROOT / 'Dockerfile').is_file() and (ROOT / 'dist/boot.js').is_file() and (ROOT / 'dist/public/workspace.html').is_file()

failed = [name for name, ok in checks.items() if not ok]
result = {'checks': checks, 'passed': len(checks) - len(failed), 'total': len(checks), 'failed': failed}
(OUT / 'static-results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
for name, ok in checks.items():
    print(('PASS' if ok else 'FAIL'), name)
print(f"\n{len(checks) - len(failed)}/{len(checks)} checks passed")
if failed:
    raise SystemExit('Failed: ' + ', '.join(failed))
