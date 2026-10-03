import argparse
import logging
from .identity import ROOT
from .store import ReadStore
from .sync import Synchronizer
from .web import create_app

parser=argparse.ArgumentParser(description='CP20 fixed testnet read-only service; no signers')
parser.add_argument('--database',default=str(ROOT/'.localbackend/cp20-testnet/readonly.sqlite3'))
args=parser.parse_args()
logging.getLogger('werkzeug').disabled=True
sync=Synchronizer(ReadStore(args.database))
create_app(sync).run(host='127.0.0.1',port=18995,debug=False,use_reloader=False)
