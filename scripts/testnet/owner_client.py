"""Dedicated owner test client. No backend process imports or holds this key."""
import argparse
import sys
from eth_account import Account
from .rpc import ROOT, Stop
from .journal import read_private
from .runner import cli


def load_owner_account(role):
    if role!='owner': raise Stop('OWNER_STEP_ONLY')
    data=read_private(ROOT/'.localbackend/cp19-owner-client/owner.json')
    if data['chainId']!=10143 or data['role']!='owner': raise Stop('KEY_IDENTITY_INVALID')
    account=Account.from_key(data['privateKey'])
    if account.address!=data['address']: raise Stop('KEY_IDENTITY_INVALID')
    return account


def main():
    parser=argparse.ArgumentParser(description='Controlled owner test client, not a human wallet UI')
    parser.add_argument('command',choices=('settle',));parser.add_argument('--plan-hash',required=True)
    args=parser.parse_args()
    return cli(['execute','--plan-hash',args.plan_hash],owner=True,account_loader=load_owner_account)

if __name__=='__main__': sys.exit(main())
