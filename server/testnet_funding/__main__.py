"""Explicit initialization after Leader campaign approval; web never signs."""
import argparse
import json
import logging
from .rpc import ROOT
from .store import FundingStore,private_json
from .service import FundingService
from .web import create_app
from .chain import FundingError

def main():
    parser=argparse.ArgumentParser(description='CP21 external wallet observer, no signer or broadcast')
    parser.add_argument('command',choices=('init','web'))
    parser.add_argument('--directory',default=str(ROOT/'.localbackend/cp21-funding'))
    parser.add_argument('--approved-config')
    args=parser.parse_args()
    try:
        store=FundingStore(args.directory)
        if args.command=='init':
            if not args.approved_config: raise FundingError('APPROVED_CAMPAIGN_REQUIRED')
            store.initialize(private_json(args.approved_config));print(json.dumps({'status':'PREPARED'}));return 0
        logging.getLogger('werkzeug').disabled=True
        create_app(FundingService(store)).run(host='127.0.0.1',port=19005,debug=False,use_reloader=False)
        return 0
    except FundingError as error: print(json.dumps({'status':'STOPPED','code':error.code}));return 2
    except Exception: print(json.dumps({'status':'STOPPED','code':'INTERNAL_REDACTED'}));return 2

if __name__=='__main__': raise SystemExit(main())
