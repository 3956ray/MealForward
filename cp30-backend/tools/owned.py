"""Fail-closed ownership proof before secret read, reset, start or termination."""
import hashlib,json,os,shlex,stat,subprocess,time
from pathlib import Path
BASE=Path('/Users/mili/Library/Caches/mcpay-c1')
FREEZE='b402bcbc50c353dde6abd0917725e5fe7dd5a0c861e956ce0dd6f427eec25802'
BASELINE='3cb717ec6fca60b80106783631a1e22b8abaff18'
class OwnershipError(RuntimeError):pass

def directory(path,mode=None):
    p=Path(path);info=p.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.getuid() or (mode is not None and stat.S_IMODE(info.st_mode)!=mode):raise OwnershipError('DIRECTORY_OWNERSHIP')
    return p

def private_file(path):
    p=Path(path);info=p.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1:raise OwnershipError('PRIVATE_FILE_OWNERSHIP')
    return p

def scope(path,*,phases=(),legacy_stop=False):
    run=Path(path)
    if not run.is_absolute() or run.parent!=BASE or len(run.name)!=12 or any(c not in '0123456789abcdef' for c in run.name):raise OwnershipError('RUN_PATH')
    # Check each parent without following symlinks, before reading a marker/secret.
    for parent in list(reversed(run.parents)):
        if parent==Path('/'):continue
        info=parent.lstat()
        if not stat.S_ISDIR(info.st_mode):raise OwnershipError('SYMLINK_PARENT')
        if parent!=Path('/Users') and parent!=Path('/Users/mili/Library/Caches') and parent!=Path('/Users/mili/Library') and info.st_uid!=os.getuid() and parent!=Path('/Users/mili'):raise OwnershipError('PARENT_OWNER')
    directory(BASE,0o700);directory(run,0o700)
    m=json.loads(private_file(run/'OWNED.json').read_text())
    if m.get('run_id')!=run.name or m.get('owner')!=os.getuid() or m.get('baseline')!=BASELINE or m.get('freeze')!=FREEZE:raise OwnershipError('MARKER_BINDING')
    phase=m.get('phase')
    if phases and phase not in phases and not(legacy_stop and phase is None):raise OwnershipError('PHASE')
    if phase not in {None,'RUNTIME_READY','INITIALIZING','INITIALIZED','SEALED','STOPPED'}:raise OwnershipError('PHASE')
    return run,m

def write_marker(run,m):
    temporary=run/'marker-new.json';fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,'w') as f:json.dump(m,f);f.flush();os.fsync(f.fileno())
        os.replace(temporary,run/'OWNED.json');fd=os.open(run,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(fd)
        finally:os.close(fd)
    finally:temporary.unlink(missing_ok=True)

def pg_identity(run,registry=None):
    directory(run/'pg',0o700);directory(run/'s',0o700)
    lines=private_file(run/'pg/postmaster.pid').read_text().splitlines()
    pid=int(lines[0]);started=int(lines[2])
    if Path(lines[1])!=run/'pg' or lines[4]!=str(run/'s'):raise OwnershipError('PG_BINDING')
    if registry is not None and (registry.get('pid')!=pid or registry.get('data')!=str(run/'pg') or registry.get('socket',str(run/'s'))!=str(run/'s')):raise OwnershipError('PID_REGISTRY')
    result=subprocess.run(['/bin/ps','-p',str(pid),'-o','uid=,lstart=,command='],env={'LC_ALL':'C'},capture_output=True,text=True,check=True)
    fields=result.stdout.strip().split(maxsplit=6)
    if len(fields)!=7 or int(fields[0])!=os.getuid():raise OwnershipError('PID_OWNER')
    actual_start=int(time.mktime(time.strptime(' '.join(fields[1:6]),'%a %b %d %H:%M:%S %Y')))
    argv=shlex.split(fields[6])
    if abs(actual_start-started)>2 or not argv or Path(argv[0]).resolve()!=Path('/opt/homebrew/bin/postgres').resolve() or argv[1:]!=['-D',str(run/'pg')]:raise OwnershipError('PID_START_EXECUTABLE_PATH')
    if registry and registry.get('start_epoch',started)!=started:raise OwnershipError('PID_START_REGISTRY')
    return dict(pid=pid,data=str(run/'pg'),socket=str(run/'s'),start_epoch=started)

def initialization_connections(run,psycopg):
    run,m=scope(run,phases=('INITIALIZING','INITIALIZED'))
    r=json.loads(private_file(run/'owned-pids.json').read_text());identity=pg_identity(run,r['pg'])
    if r.get('apps'):raise OwnershipError('APPLICATIONS_REGISTERED')
    if (run/'FIXTURE_STARTED').exists() or (run/'security.journal').exists():raise OwnershipError('SEALED_OR_JOURNALED')
    password=private_file(run/'bootstrap-password').read_text().strip()
    kw=dict(host=str(run/'s'),port=5432,user='c1_bootstrap',password=password,connect_timeout=2)
    connections=[]
    try:
        for db,schema,anchor in [('c1_business','c1_private','deployment'),('c1_authority','c1_authority','namespaces')]:
            c=psycopg.connect(**kw,dbname=db,autocommit=True);connections.append(c)
            if c.execute('SELECT current_database(),current_user').fetchone()!=(db,'c1_bootstrap'):raise OwnershipError('DB_SCOPE')
            # Runtime connections or ANY owned domain row forbid destructive retries.
            if c.execute("SELECT count(*) FROM pg_stat_activity WHERE datname IN('c1_business','c1_authority') AND usename<>'c1_bootstrap'").fetchone()[0]:raise OwnershipError('RUNTIME_CONNECTIONS')
            names=c.execute('SELECT tablename FROM pg_tables WHERE schemaname=%s',(schema,)).fetchall()
            from psycopg import sql
            for (table,) in names:
                if c.execute(sql.SQL('SELECT EXISTS(SELECT 1 FROM {}.{} LIMIT 1)').format(sql.Identifier(schema),sql.Identifier(table))).fetchone()[0]:raise OwnershipError('BUSINESS_RECORDS')
        return connections,kw,m,identity
    except BaseException:
        for c in connections:c.close()
        raise

def seal(run,cluster_id):
    run,m=scope(run,phases=('INITIALIZED',))
    if m.get('cluster_id')!=cluster_id:raise OwnershipError('CLUSTER_ID')
    m['phase']='SEALED';m['sealed_at']=time.time();write_marker(run,m)
    p=run/'FIXTURE_STARTED';fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:os.write(fd,b'SEALED_BEFORE_FIRST_FIXTURE\n');os.fsync(fd)
    finally:os.close(fd)


def app_identity(run,pid,*,config,python,registry=None):
    run,_=scope(run,phases=('SEALED',))
    config=private_file(config)
    if config.parent!=run or Path(python).resolve()!=(run/'venv/bin/python').resolve():raise OwnershipError('APP_PATH')
    result=subprocess.run(['/bin/ps','-p',str(pid),'-o','uid=,lstart=,command='],env={'LC_ALL':'C'},capture_output=True,text=True,check=True)
    fields=result.stdout.strip().split(maxsplit=6)
    if len(fields)!=7 or int(fields[0])!=os.getuid():raise OwnershipError('APP_OWNER')
    command=fields[6]
    if not command.startswith(str(run/'venv/bin/python')+' -c ') or not command.endswith('--config '+str(config)):raise OwnershipError('APP_EXECUTABLE_CONFIG')
    actual={'pid':pid,'start':' '.join(fields[1:6]),'config':str(config),'python':str(Path(python).resolve()),'uid':os.getuid(),'command_digest':hashlib.sha256(command.encode()).hexdigest()}
    if registry and any(registry.get(k)!=v for k,v in actual.items()):raise OwnershipError('APP_PID_REUSED')
    return actual
