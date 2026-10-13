"""Private temporary-file checks; no database, real custody, controller or network."""
import importlib.util,tempfile,json
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('catalog_install',Path(__file__).with_name('catalog-provision.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

for stop in range(1,5):
    with tempfile.TemporaryDirectory(prefix='catalog-install-check-') as directory:
        root=Path(directory);files={}
        for name in ('application.json','automatic-business.json','INSTALLED.json','WALLET-LOGIN-INSTALLED.json'):
            module.setup.write(root/name,{'old':name})
            files[name]={'before':module.setup.digest(root/name),'after':{'new':name}}
        state={'files':files};statepath=root/'CATALOG-PREPARING.json';module.setup.write(statepath,state)
        original=module.replace_private;calls=[0]
        def interrupted(path,value):
            calls[0]+=1
            if calls[0]==stop:
                module.setup.write(path.with_name(path.name+'.catalog-tmp'),value)
                raise InterruptedError('synthetic interrupted rename')
            original(path,value)
        with patch.object(module,'replace_private',interrupted):
            try:module.finish_configs(root,state,statepath)
            except InterruptedError:pass
            else:raise AssertionError('expected interruption')
        module.finish_configs(root,state,statepath)
        for name,item in files.items():assert module.setup.digest(root/name)==module.value_digest(item['after'])
        assert module.setup.private_json(statepath)['committed']
        # A changed third value is never overwritten by recovery.
        original(root/'application.json',{'foreign':True})
        try:module.finish_configs(root,state,statepath)
        except ValueError as e:assert str(e)=='ORIGINAL_CONFIG_INSTALL_CONFLICT'
        else:raise AssertionError('foreign contents accepted')
print(json.dumps({'catalogConfigRecovery':'PASS','fourInterruptionPoints':True,'unknownContentsRejected':True,'realRunTouched':False}))
