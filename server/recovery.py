"""Controlled local backup/restore. Restores are permanently quarantined in CP15."""
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import time
import uuid
from contextlib import closing
from server.storage import Store
from server.dynamic_contracts import BACKUP_FORMAT, SCHEMA_VERSION

FILES=('backend.sqlite3','encryption.key','issuer.key','config.json')
SIGNER_FILES={'operator':'operator.key','settler':'settler.key'}

def new_directory(path):
    root=Path(path).resolve()
    # Never overwrite an active deployment, a previous restore, or an old backup.
    root.mkdir(mode=0o700,parents=True,exist_ok=False)
    return root

def relocated_config(config, root):
    result={**config,'databasePath':str(root/'backend.sqlite3'),
            'secretKeyFile':str(root/'encryption.key'),'issuerKeyFile':str(root/'issuer.key')}
    for role,name in SIGNER_FILES.items():
        if role in config.get('workSigners',{}): result[role+'KeyFile']=str(root/name)
    # Current Dynamic authority is an explicit out-of-bundle input, never restored.
    for key in ('dynamicAuthority', 'dynamicAuthorityFile', 'dynamicMappings', 'dynamicClaimProfile'):
        result.pop(key, None)
    return result

def quarantine(store, reason, *, bind_path=False):
    with store.transaction() as db:
        db.execute("INSERT OR REPLACE INTO metadata VALUES('recovery_state','QUARANTINED')")
        db.execute("INSERT OR REPLACE INTO metadata VALUES('recovery_reason',?)",(reason,))
        if bind_path:
            db.execute("INSERT OR REPLACE INTO metadata VALUES('database_origin_path',?)",(str(store.path.resolve()),))
        # Restoring old sessions must not undo a later logout/revocation.
        db.execute('UPDATE work_sessions SET revoked=1')
        db.execute('UPDATE support_caps SET expires_at=0')
        db.execute('UPDATE recipient_sessions SET revoked=1')
        db.execute('UPDATE presentation_codes SET active=0,code_cipher=NULL')
        db.execute('UPDATE owner_wallet_sessions SET revoked=1')
        db.execute('UPDATE owner_wallet_challenges SET consumed=1')
        db.execute("UPDATE dynamic_identity_mappings SET enabled=0,authority_source_version='',revision=revision+1")

def write_private(path, data):
    path.write_bytes(data);path.chmod(0o600)

def backup_bundle(config, destination):
    from server.local import load_backend
    backend=load_backend(config)
    root=new_directory(destination)
    with closing(backend.store.connect()) as source, closing(sqlite3.connect(root/'backend.sqlite3')) as target:
        source.backup(target)
    store=Store(root/'backend.sqlite3')
    quarantine(store,'BACKUP_REQUIRES_RESTORE')
    with closing(store.connect()) as db: db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    write_private(root/'encryption.key',Path(config['secretKeyFile']).read_bytes())
    write_private(root/'issuer.key',Path(config['issuerKeyFile']).read_bytes())
    files=list(FILES)
    for role,name in SIGNER_FILES.items():
        if role in config.get('workSigners',{}):
            write_private(root/name,Path(config[role+'KeyFile']).read_bytes());files.append(name)
    saved=relocated_config(config,root)
    write_private(root/'config.json',(json.dumps(saved,indent=2)+'\n').encode())
    manifest={'format':BACKUP_FORMAT,
              'backupId':uuid.uuid4().hex,'createdAt':int(time.time()),'schemaVersion':SCHEMA_VERSION,
              'deploymentId':backend.deployment['deploymentId'],
              'sha256':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in files}}
    # Last file is the completion marker; interrupted bundles cannot be restored.
    write_private(root/'backup.json',(json.dumps(manifest,indent=2)+'\n').encode())
    return root

def restore_bundle(backup, destination):
    root=Path(backup).resolve()
    manifest=json.loads((root/'backup.json').read_text())
    versions={'mealforward-cp15-quarantined-backup-v1':1,'mealforward-cp16-quarantined-backup-v2':2,
              'mealforward-cp16-quarantined-backup-v3':3, BACKUP_FORMAT:SCHEMA_VERSION}
    version=versions.get(manifest.get('format'));files=set(manifest.get('sha256',{}))
    if not version or not set(FILES)<=files or files-set(FILES)-set(SIGNER_FILES.values()):
        raise ValueError('Unsupported or incomplete backup bundle')
    if (version==1 and files!=set(FILES)) or manifest.get('schemaVersion')!=version or type(manifest.get('createdAt')) is not int or not isinstance(manifest.get('backupId'),str):
        raise ValueError('Missing backup provenance')
    for name in files:
        if (root/name).is_symlink() or hashlib.sha256((root/name).read_bytes()).hexdigest()!=manifest['sha256'][name]:
            raise ValueError('Backup integrity mismatch')
    config=json.loads((root/'config.json').read_text())
    if set(config.get('workSigners',{}))-set(SIGNER_FILES): raise ValueError('Unsupported backup signer role')
    expected=set(FILES)|{SIGNER_FILES[role] for role in config.get('workSigners',{})}
    if files!=expected: raise ValueError('Missing or unexpected signer material')
    if config['deployment']['deploymentId']!=manifest['deploymentId']:
        raise ValueError('Backup deployment mismatch')
    target=new_directory(destination)
    for name in files:
        shutil.copyfile(root/name,target/name);(target/name).chmod(0o600)
    store=Store(target/'backend.sqlite3')
    quarantine(store,'RESTORED_BACKUP',bind_path=True)
    with store.transaction() as db:
        db.execute("INSERT OR REPLACE INTO metadata VALUES('recovery_backup_id',?)",(manifest['backupId'],))
        db.execute("INSERT OR REPLACE INTO metadata VALUES('recovery_backup_created_at',?)",(str(manifest['createdAt']),))
        db.execute("INSERT OR REPLACE INTO metadata VALUES('recovery_restored_at',?)",(str(int(time.time())),))
    restored=relocated_config(config,target)
    write_private(target/'config.json',(json.dumps(restored,indent=2)+'\n').encode())
    return restored
