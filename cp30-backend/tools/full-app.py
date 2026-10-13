"""Independent fresh full-app source CLI. No old runtime or automatic activation.

Every real action is future explicitly configured execution; this delivery runs
only memory/syntax checks. prepare creates disabled new slots; initialize validates
reviewed inputs and creates only a new cluster; start/stop own six bounded apps.
"""
import argparse,copy,hashlib,importlib.util,json,os,stat,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
spec=importlib.util.spec_from_file_location('full_connection_setup',ROOT/'tools/connection-bootstrap.py');setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)
from c1.full_configuration import validate_application
ROLES=('quoteAuthority','issuerAuthority','operatorAuthority')
def prepare(run):
    value=setup.prepare(run);run=Path(run)
    for directory in ('security','binding','content','tls',*ROLES):(run/directory).mkdir(mode=0o700)
    for role in ROLES:
        fd=os.open(run/role/'authority.key',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.close(fd)
    template=json.loads((ROOT/'config/full-app.disabled.json').read_text());template['registrar']['keyHandle']=str(run/'registrar/registrar.key')
    template['application']['tls']={'certfile':str(run/'tls/server.crt'),'keyfile':str(run/'tls/server.key')}
    template['application']['custody']={role:{'directory':str(run/role),'keyHandle':{'name':'authority.key','device':None,'inode':None}} for role in ROLES}
    setup.write(run/'full-app.disabled.json',template)
    return {'status':'NOT_CONFIGURED','run':str(run),'required':'New reviewed origin/identity/chain/asset/RPC/custody/budgets and pinned runtime; no per-store registrationId input'}
def initialize(run,plan_path):
    run,m=setup.marker(run);plan=setup.private_json(plan_path)
    if plan.get('mode')!='CP30_FULL_APPLICATION' or plan.get('enabled') is not True:raise ValueError('APPROVED_FULL_APPLICATION_REQUIRED')
    registrar=setup.validate_plan(plan['registrar'],run);application=copy.deepcopy(plan['application'])
    if application.get('walletProof',{}).get('backendOriginHash') is None and type(application.get('origin')) is str:application['walletProof']['backendOriginHash']='0x'+hashlib.sha256(application['origin'].encode()).hexdigest()
    app=validate_application(application,registrar['profile'])
    if app['activation'].get('identity') is not True or app['activation'].get('ownerWalletBinding') is not True or app['activation'].get('storeDeployment') is not True:raise ValueError('EXPLICIT_FIRST_RUN_ACTIVATION_REQUIRED')
    for role in ROLES:
        custody=app['custody'][role];directory=setup.owned_directory(custody['directory'])
        if directory!=run/role or (directory/'business-authority-originals.jsonl').exists():raise ValueError('FRESH_AUTHORITY_DIRECTORY_REQUIRED')
        handle=custody['keyHandle'];path=directory/handle['name'];info=path.lstat()
        if handle['name']!='authority.key' or not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1 or not 66<=info.st_size<=67:raise ValueError('NEW_APPROVED_CUSTODY_REQUIRED')
        if handle['device']!=info.st_dev or handle['inode']!=info.st_ino:raise ValueError('APPROVED_HANDLE_METADATA_REQUIRED')
        grant=app['businessTemplate']['roles'][role]['grant']
        if type(grant['expiresAt']) is not int or not int(time.time())<grant['expiresAt']<=int(time.time())+86400:raise ValueError('BOUNDED_FRESH_GRANT_REQUIRED')
        for field in ('signatureUnits','gasUnits'):
            if type(grant[field]) is not str or not setup.re.fullmatch('[1-9][0-9]{0,77}',grant[field]) or int(grant[field])>=2**256:raise ValueError('CANONICAL_BUDGET_REQUIRED')
    # New approved TLS only; no fallback copying from an old app or secret store.
    for field in ('certfile','keyfile'):
        path=Path(app['tls'][field]);info=path.lstat()
        if path.parent!=run/'tls' or not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1:raise ValueError('NEW_PRIVATE_TLS_REQUIRED')
    from c1.tls_profile import validate_tls
    validate_tls(app['tls'],app['origin'])
    registrar={**registrar,'application':app};approved=run/'full-registrar-plan.json';setup.write(approved,registrar)
    return setup.initialize(run,approved)
def main():
    if os.environ:raise SystemExit('EMPTY_ENVIRONMENT_REQUIRED')
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['prepare','initialize','start','stop']);parser.add_argument('run');parser.add_argument('--plan');args=parser.parse_args()
    try:
        if args.action=='prepare':result=prepare(args.run)
        elif args.action=='initialize':result=initialize(args.run,args.plan)
        else:result=getattr(setup,args.action)(args.run)
    except Exception:raise SystemExit('FULL_APPLICATION_CLOSED') from None
    print(json.dumps(result))
if __name__=='__main__':main()
