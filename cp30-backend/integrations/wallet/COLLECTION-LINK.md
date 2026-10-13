# Pure short-display collection links

Source is `cp30-backend/consumer/collection-link.mjs`. It exports exactly:

```text
createCollectionLink({origin,store,display}) -> absolute URL string
consumeCollectionLink({location,history}) -> {store,display} | null
```

create accepts exactly those three keys. origin must be the current reviewed,
canonical HTTPS `location.origin`, with no credentials/path/query/fragment.
store uses the current API's alias grammar `[A-Za-z0-9_-]{1,64}`; display uses
the server's 43-character `[A-Za-z0-9_-]` short-code grammar. The URL is:

```text
https://<trusted-origin>/#collection=v1&store=<alias>&display=<short-display>
```

This is only a **short-lived display** link. Main must obtain display from the
server's current display response; URL shape cannot distinguish a long-lived
access token of the same length. Never pass access, voucherId or a token from a
query, browser cache or unrelated credential. Extra create keys reject. No
voucherId, access, query secret, expiry or epoch is placed in the generated URL.

consume reads the fragment synchronously. Once the reserved collection namespace
is recognized, it immediately calls history.replaceState before validating or
returning store/display. Malformed target fragments also get erased; any query
on a target link is erased as well, and links with queries are rejected. Related
malformed case/encoded namespace forms are erased and rejected. Only the exact
canonical fragment/order/version is accepted. Root HTTPS links only; paths,
credentials, HTTP, duplicates, extra fields and invalid alias/display reject.
Unrelated app fragments are unchanged. If history erasure is unavailable/fails,
consume returns null and does not navigate or return display data. location and
history must be the current trusted browser objects, not attacker-controlled
request fields. Existing history.state is passed through without adding a code.

These functions do not fetch, consume/reserve a voucher, sign anything, access
local/sessionStorage or infer an expiry. Actual validity remains the server's
validUntil, display/access epoch, generation, session, owner/store permission,
serving window and voucher state checks. A URL alone provides no permission.
Opening only prefills the owner's store/display check form. Explicit reserve and
handover confirmation remain separate existing server actions.

Main owns follow-up integration: import consume early and clear the fragment
before login/asynchronous work; retain any pending `{store,display}` in memory
only across required owner sign-in; show the relevant check page without an
automatic request; submit only after explicit validation action. Render the URL
from create in QR and copy-link UI, preserving any separate manual short-code
option. The application's serving route must provide the root page. Main must
invalidate retained data on session/role/store changes and handle server expiry;
do not synthesize validUntil or automatically confirm collection/handover.

Only these new source/document/test files were written. consumer.js, qr-entry.js,
index.html, application.py and other shared code were not changed. URL tooling
does not prove browser or complete collection-flow integration.

Offline check: run installed Node with an empty environment against
`cp30-backend/integrations/wallet/test_collection_link.mjs`. Four URL/history-stub
tests pass: canonical construction; synchronous erase/return/replay; malformed
target/query/path/HTTP rejection and erase; unrelated fragment/history failure.
No browser, network, secret or existing test suite was used.
