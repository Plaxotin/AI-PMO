from pathlib import Path
import argparse, hashlib, json, re, sys

ROOT = Path('/mnt/agents/output')
APP = ROOT / 'app'
parser = argparse.ArgumentParser()
parser.add_argument('--part', choices=['landing','workspace','all'], default='all')
args = parser.parse_args()
checks = []
def check(name, ok):
    checks.append({'name':name,'ok':bool(ok)})
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

landing = (APP/'landing.html').read_text()
workspace = (APP/'index.html').read_text()
if args.part in ('landing','all'):
    check('two main landing actions', len(re.findall(r'data-main-action=', landing)) == 2)
    check('no separate risk confirmation', 'data-act="confirm"' not in landing and 'Подтвердите фиксацию' not in landing)
    check('automatic attribution', 'Пиэмка · автоматически' in landing)
    check('on-behalf attribution', 'Пиэмка от имени Плахотина К.' in landing)
    check('decision and assignment chain', all(x in landing for x in ['R-207','D-207','P-D-207']))
    check('canonical levels in text', 'L0 надзор → L1 реестр рисков → L2 дайджест → L3 реестр решений → L4 реестр поручений' in landing)
    check('integration honesty', 'подключение каналов не выполняется' in landing)
    check('legacy PNG preserved', sha(APP/'matreshka-full-cycle.png') == '6e63c5ee94179fdb4b49172c0dbeb25416b0a43585420b15469dc359c3a2cdf4')
if args.part in ('workspace','all'):
    check('central RP guard', 'function requireRP()' in workspace and "if(!requireRP()) return;" in workspace)
    check('decision creates linked task', "decisionId:id" in workspace and "id:'P-'+id" in workspace)
    check('task links back to decision', 'решение ${x.decisionId}' in workspace)
    check('demo state persists', "localStorage.setItem(DEMO_STORAGE_KEY" in workspace and 'restoreDemoState();buildTicker()' in workspace)
    check('local-only disclosure', 'не синхронизируются между устройствами' in workspace)
    check('member decisions rerender', "else if(t.kind==='decisions') renderDecisionsView(t);" in workspace)
    check('integrations do not fake connection', 'CHANNELS[name]=!CHANNELS[name]' not in workspace and 'внешняя интеграция не выполняется' in workspace)
    check('audit-oriented start', 'Project Audit · проверка и аудит' in workspace and 'Скажите «принять»' not in workspace)
    check('soon collapsed', '<div id="secSoon" class="csec-body">' in workspace)
    check('mobile registry cards', '@media (max-width:640px)' in workspace and 'td::before{content:attr(data-label)' in workspace and 'function labelRegistryTables()' in workspace)
    check('proposal provenance preserved', "type:p.type||'auto'" in workspace)
if args.part == 'all':
    manifest_path = ROOT/'rollback/step2/states.json'
    check('rollback manifest exists', manifest_path.exists())
    if manifest_path.exists():
        states = json.loads(manifest_path.read_text())
        check('four rollback states', all(k in states for k in ['A','B','C','D']))
        for key in ['A','B','C','D']:
            if key in states:
                check(key+' has version and hashes', bool(states[key].get('version')) and len(states[key].get('landing_sha256','')) == 64 and len(states[key].get('workspace_sha256','')) == 64)
        if all(k in states for k in ['A','B','C','D']):
            check('A and B keep original workspace', states['A']['workspace_sha256'] == states['B']['workspace_sha256'])
            check('C and D share new workspace', states['C']['workspace_sha256'] == states['D']['workspace_sha256'])
            check('A and C share original landing', states['A']['landing_sha256'] == states['C']['landing_sha256'])
            check('B and D share new landing', states['B']['landing_sha256'] == states['D']['landing_sha256'])

result = {'part':args.part,'passed':all(c['ok'] for c in checks),'checks':checks}
out = APP/'verifier/v15'/('static-'+args.part+'-results.json')
out.write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False,indent=2))
sys.exit(0 if result['passed'] else 1)
