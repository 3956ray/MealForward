# Wallet modal minimal human acceptance

Use https://mealforward-t1e-claim-laodao.onrender.com/mvp/product.html in the browser with existing MetaMask. Wait for HANDOFF live confirmation. No third voucher or on-chain transaction required.

1. Refresh once for the new version, then click 钱包登录. A modal should show discovered extensions as cards. MetaMask should not also appear as a duplicate generic injected entry for the same provider. No need to install another wallet solely for testing.
2. Select MetaMask and explicitly connect/login as Owner. Reject the first login signature once, verify understandable retry, then retry and confirm login. Only a login message, no transaction/Gas.
3. Refresh with the same permitted wallet/account/network and valid server session: identity should restore without a connection or signature prompt. First login after upgrading is expected because no provider preference existed before this feature.
4. Switch to Donor: old Owner identity must clear. Explicitly choose/login again; no silent signing. Current workspace indicator should read 当前工作台 when already on the matching work page.

Existing two business records remain settled. Do not create business3, approve tokens, donate, issue or settle again for this UI acceptance. Report which step failed and visible error if any; no raw signatures or private links.
