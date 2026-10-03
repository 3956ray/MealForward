import type { OwnerWalletController } from '../src/wallet/owner-controller.ts'

/** Release event subscriptions before the UI drops its only controller reference. */
export function releaseOwnerController(controller?: OwnerWalletController) {
  if (!controller) return
  controller.detach()
  controller.invalidate()
}
