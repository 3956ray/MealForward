"""Explicit initialization after Leader issuance approval; web never signs."""
import argparse
import json
import logging
from .rpc import ROOT
from .store import IssuanceStore,private_json
from .service import IssuanceService
from .web import create_app
from .chain import IssuanceError

def main():
    parser=argparse.ArgumentParser(description='CP22 issuance observer, no signer or broadcast')
    parser.add_argument('command',choices=('init','web'))
    parser.add_argument('--directory',default=str(ROOT/'.localbackend/cp22-issuance'))
    parser.add_argument('--approved-config')
    args=parser.parse_args()
    try:
        store=IssuanceStore(args.directory)
        if args.command=='init':
            if not args.approved_config: raise IssuanceError('APPROVED_ISSUANCE_REQUIRED')
            record=IssuanceService(store).initialize(private_json(args.approved_config))
            print(json.dumps({'status':record['status'],'operationId':record['operationId'],'voucherId':record['voucherId']}));return 0
        logging.getLogger('werkzeug').disabled=True
        create_app(IssuanceService(store)).run(host='127.0.0.1',port=19006,debug=False,use_reloader=False)
        return 0
    except IssuanceError as error: print(json.dumps({'status':'STOPPED','code':error.code}));return 2
    except Exception: print(json.dumps({'status':'STOPPED','code':'INTERNAL_REDACTED'}));return 2

if __name__=='__main__': raise SystemExit(main())
