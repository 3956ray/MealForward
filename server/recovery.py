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

FILES=('backend.sqlite3','encryption.key','issuer.key','config.json')

def new_directory(path):
    root=Path(path).resolve()
    # Never overwrite an active deployment, a previous restore, or an old backup.
    root.mkdir(mode=0o700,parents=True,exist_ok=False)
    return root

def relocated_config(config, root):
    return {**config,'databasePath':str(root/'backend.sqlite3'),
            'secretKeyFile':str(root/'encryption.key'),'issuerKeyFile':str(root/'issuer.key')}

def quarantine(store, reason, *, bind_path=False):
    with store.transaction() as db:
        db.execute("INSERT OR REPLACE INTO metadata VALUES('recovery_state','QUARANTINED')")
        db.execute("INSERT OR REPLACE INTO metadata VALUES('recovery_reason',?)",(reason,))
        if bind_path:
            db.execute("INSERT OR REPLACE INTO metadata VALUES('database_origin_path',?)",(str(store.path.resolve()),))
        # Restoring old sessions must not undo a later logout/revocation.
        db.execute('UPDATE work_sessions SET revoked=1')
        db.execute('UPDATE support_caps SET expires_at=0')

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
    saved=relocated_config(config,root)
    write_private(root/'config.json',(json.dumps(saved,indent=2)+'\n').encode())
    manifest={'format':'mealforward-cp15-quarantined-backup-v1',
              'backupId':uuid.uuid4().hex,'createdAt':int(time.time()),'schemaVersion':1,
              'deploymentId':backend.deployment['deploymentId'],
              'sha256':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in FILES}}
    # Last file is the completion marker; interrupted bundles cannot be restored.
    write_private(root/'backup.json',(json.dumps(manifest,indent=2)+'\n').encode())
    return root

def restore_bundle(backup, destination):
    root=Path(backup).resolve()
    manifest=json.loads((root/'backup.json').read_text())
    if manifest.get('format')!='mealforward-cp15-quarantined-backup-v1' or set(manifest.get('sha256',{}))!=set(FILES):
        raise ValueError('Unsupported or incomplete backup bundle')
    if manifest.get('schemaVersion')!=1 or type(manifest.get('createdAt')) is not int or not isinstance(manifest.get('backupId'),str):
        raise ValueError('Missing backup provenance')
    for name in FILES:
        if (root/name).is_symlink() or hashlib.sha256((root/name).read_bytes()).hexdigest()!=manifest['sha256'][name]:
            raise ValueError('Backup integrity mismatch')
    config=json.loads((root/'config.json').read_text())
    if config['deployment']['deploymentId']!=manifest['deploymentId']:
        raise ValueError('Backup deployment mismatch')
    target=new_directory(destination)
    for name in FILES:
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
