import argparse
from .core import VoucherService, VoucherStore

def main():
    parser = argparse.ArgumentParser(description="CP23 private-link voucher state; no signer or RPC")
    parser.add_argument("command", choices=("init", "status"))
    parser.add_argument("--directory", default=".localbackend/cp23-voucher")
    parser.add_argument("--issuance-directory", default=".localbackend/cp22-issuance")
    args = parser.parse_args()
    service = VoucherService(VoucherStore(args.directory), args.issuance_directory)
    if args.command == "init":
        state = service.initialize(); binding = state["binding"]
        print("CP23 private-link store ready; no invite secret created")
        print("voucherId:", binding["voucherId"]); print("partnerLabel:", binding["partnerLabel"])
    else:
        state = service.store.load(); invite = state["invite"]
        print("configured: true"); print("generation:", state["generation"])
        print("invite:", "none" if not invite else ("opened" if invite["first_opened_at"] is not None else "created"))

if __name__ == "__main__": main()
