# Fresh run full-app configuration — 2026-10-13

This is a complete public **draft**, not an executable approved plan. It keeps all
execution/role activation disabled and unknown facts null or visibly marked.
Only Root completes and saves the private approved plan under the new run. No
old configuration, private key, token, OTP, email, journal or runtime was read to
prepare this document. No initializer or service was executed.

Factory is actually VERIFIED by Root: address
`0x645d1176e8315afd04fe40f0c528e5370545acfb`, deployed code hash
`0x1ea00538cb2ee389e06b403bb6b6f505bf325393b24ded1df8939b2239bdcf24`,
transaction `0xea244bbd4744735c1151a150d60c0cde4079777fd6dbef6001fd8e7cdcfada5a`,
receipt height70489377. The explicitly authorized public proof
`/Users/mili/.mf-cp30-20261013/factory-verified.json` was read; its getters/domain
verification does not imply app, store or user-flow readiness. Chain/genesis and
USDC code hash below come from Root's supplied public verification. Five public system addresses, role handle metadata and finite budgets are filled
from the explicitly authorized new public-accounts.json, custody-metadata.json and
startup-budgets.json. No key file was opened. The token symbol is filled from Root's explicitly authorized public pending plan.

## Complete JSON shape

This JSON has no references or omitted subobjects. Replace every angle-bracket
placeholder and every pending null before activation. `mf_cp30_20261013`, grant
IDs and wallet-proof name/version are proposed fresh local choices, not external
observations; Root can select/review them. The finite signing/gas budgets are Root-selected startup caps, not estimates.
RPC budgets below show source ceilings,
not proof of provider throughput or permission for transactions.

```json
{
  "mode": "CP30_FULL_APPLICATION",
  "enabled": false,
  "registrar": {
    "mode": "CP30_REGISTRAR_RUNTIME",
    "enabled": false,
    "namespace": "mf_cp30_20261013",
    "profile": {
      "mode": "TESTNET",
      "chainId": "10143",
      "genesisHash": "0x298034669ee44327d2da9744b9b2782848e2f2a6959756b7b0471b09a404f5c9",
      "factory": "0x645d1176e8315afd04fe40f0c528e5370545acfb",
      "registrar": "0x7b9ac33903b17b442c9f2e8f9c2f479d339f2543",
      "quoteAuthority": "0x814232fa062dc7b6d14610db8b614715b2dd0fc5",
      "catalogAuthority": "0x864218503e18bb73d86bcbffbb3a27d7f7a34a2d",
      "issuerAuthority": "0x177d5dbb0fc6cc03c209fc81987065380fed667c",
      "operatorAuthority": "0x5f8e8eeec17778da5d0681217c8c98fc0c249371",
      "asset": "0x534b2f3a21130d7a60830c2df862319e593943a3",
      "assetDecimals": 6,
      "assetSymbol": "USDC",
      "factoryCodeHash": "0x1ea00538cb2ee389e06b403bb6b6f505bf325393b24ded1df8939b2239bdcf24",
      "chainProfileDigest": "0x87d3f36f431adc218fd5953b344f5ef94f3029b6755a35171f8811807c6bcaee",
      "escrowCreationCodeHash": "0x3aed59967d18f9b80a436f1080f9b55b5ea9299f62eb1c7d8f612d7ed8d30b4e",
      "runtimeTemplatePins": {
        "factory": "0xcc94e6dd8c3e594ed94ef9221e7b3c55e941321285afcd39966f04c36231fb1a",
        "escrow": "0x2d6f320edd2627a18683f2fd37f45acd41f7fb4951c89b99e062650487ce191b"
      }
    },
    "grant": {
      "id": "fresh20261013_registrar",
      "signatureUnits": "3",
      "gasUnits": "2880000000000000000",
      "expiresAt": null
    },
    "transactionLimits": {
      "gas": "8000000",
      "maxFeePerGas": "120000000000",
      "maxPriorityFeePerGas": "2000000000"
    },
    "rpc": {
      "endpoint": "https://testnet-rpc.monad.xyz",
      "allowedEndpoints": [
        "https://testnet-rpc.monad.xyz"
      ],
      "allowedHosts": [
        "testnet-rpc.monad.xyz"
      ],
      "maxCalls": 48,
      "maxTotalSeconds": 20
    },
    "keyHandle": "/Users/mili/.mf-cp30-20261013/registrar/registrar.key",
    "postgresBin": "/opt/homebrew/Cellar/postgresql@17/17.11/bin",
    "pythonExecutable": "/Users/mili/.mf-cp30-20261013/.venv/bin/python"
  },
  "application": {
    "mode": "CP30_FULL_APPLICATION",
    "enabled": false,
    "origin": "https://localhost:16443",
    "httpPort": 16443,
    "allowedOrigin": "https://localhost:16443",
    "allowedOriginApproved": true,
    "tls": {
      "certfile": "/Users/mili/.mf-cp30-20261013/tls/server.crt",
      "keyfile": "/Users/mili/.mf-cp30-20261013/tls/server.key"
    },
    "identity": {
      "claimProfile": {
        "environment_id": "7fe95f70-e5cc-4c3c-beed-a133e81268dc",
        "issuer": "app.dynamicauth.com/7fe95f70-e5cc-4c3c-beed-a133e81268dc",
        "audiences": [
          "https://localhost:16443"
        ],
        "verified": false,
        "allow_absent_audience": false,
        "allow_absent_environment_id": false,
        "allow_absent_sid": false
      },
      "emailProfile": {
        "email_path": [
          "email"
        ],
        "verified_path": null,
        "email_type": "string",
        "verified_type": null,
        "approved": false,
        "mode": "dynamic_verified_profile",
        "credentials_path": null,
        "format_key": null,
        "credential_email_key": null
      }
    },
    "walletProof": {
      "name": "MealForward Owner Wallet Binding",
      "version": "1",
      "chainId": 10143,
      "verifyingContract": "0x645d1176e8315afd04fe40f0c528e5370545acfb",
      "backendOriginHash": "0x4231332d62baa13130995dfdb9b2116e4c2db4654ce70488086a61992e45ae30",
      "ttlSeconds": 300
    },
    "walletKindRpc": {
      "endpoint": "https://testnet-rpc.monad.xyz",
      "allowedEndpoints": [
        "https://testnet-rpc.monad.xyz"
      ],
      "allowedHosts": [
        "testnet-rpc.monad.xyz"
      ],
      "pythonExecutable": "/Users/mili/.mf-cp30-20261013/.venv/bin/python",
      "profile": {
        "chainId": 10143,
        "genesisHash": "0x298034669ee44327d2da9744b9b2782848e2f2a6959756b7b0471b09a404f5c9",
        "factory": "0x645d1176e8315afd04fe40f0c528e5370545acfb",
        "budget": {
          "maxCalls": 48,
          "maxTotalMs": 20000,
          "maxCallMs": 3000,
          "maxResponseBytes": 1048576,
          "maxTotalBytes": 1048576,
          "maxCatalogEntries": 3
        }
      }
    },
    "registrationObserver": {
      "endpoint": "https://testnet-rpc.monad.xyz",
      "allowedEndpoints": [
        "https://testnet-rpc.monad.xyz"
      ],
      "allowedHosts": [
        "testnet-rpc.monad.xyz"
      ],
      "pythonExecutable": "/Users/mili/.mf-cp30-20261013/.venv/bin/python",
      "profile": {
        "chainId": 10143,
        "genesisHash": "0x298034669ee44327d2da9744b9b2782848e2f2a6959756b7b0471b09a404f5c9",
        "factory": "0x645d1176e8315afd04fe40f0c528e5370545acfb",
        "registrar": "0x7b9ac33903b17b442c9f2e8f9c2f479d339f2543",
        "quoteAuthority": "0x814232fa062dc7b6d14610db8b614715b2dd0fc5",
        "catalogAuthority": "0x864218503e18bb73d86bcbffbb3a27d7f7a34a2d",
        "issuerAuthority": "0x177d5dbb0fc6cc03c209fc81987065380fed667c",
        "operatorAuthority": "0x5f8e8eeec17778da5d0681217c8c98fc0c249371",
        "asset": "0x534b2f3a21130d7a60830c2df862319e593943a3",
        "escrowCreationCodeHash": "0x3aed59967d18f9b80a436f1080f9b55b5ea9299f62eb1c7d8f612d7ed8d30b4e",
        "finality": "rpc-finalized",
        "eip1898": true,
        "runtimeTemplatePins": {
          "factory": "0xcc94e6dd8c3e594ed94ef9221e7b3c55e941321285afcd39966f04c36231fb1a",
          "escrow": "0x2d6f320edd2627a18683f2fd37f45acd41f7fb4951c89b99e062650487ce191b"
        },
        "budget": {
          "maxCalls": 48,
          "maxTotalMs": 20000,
          "maxCallMs": 3000,
          "maxResponseBytes": 1048576,
          "maxTotalBytes": 1048576,
          "maxCatalogEntries": 3
        }
      },
      "compilerPins": {
        "registration-observer.mjs": "62dc4f5fe4b8d0e525715c747e303138387684dbde1c16de6bc921c596c7c884",
        "registration-observer-runner.mjs": "675e23f2e28f030376ff2aa9c8e08cf6b51073671f1e029823bc662067a6e3e6",
        "observer-artifacts.mjs": "823728c980f74db6e8271b288c708db4d5346a711f0d2862c457f66caeac10bf",
        "index.mjs": "5a5c2c1961e55519829e78824b306308c09657f32712dccbc0dda13ccf44eca0",
        "factory-abi.mjs": "e32e4605f0333b04464e3cdf55155016c512cb44ed05fdaceeb9af15c9aed838",
        "escrow-abi.mjs": "1f8c6f4e1d1657042ed89f0f76a16dac8ff7d608099d2edfa58dee6be0e69af7",
        "escrow-creation-code.mjs": "bd1eb01f7cfc4ce219df5e577bea09db63c2f9f20b06af5380264d0fb8908df7"
      }
    },
    "activation": {
      "identity": false,
      "ownerWalletBinding": false,
      "storeDeployment": false,
      "payerWalletTransactions": false,
      "ownerSettlement": false,
      "expiresAt": null
    },
    "business": {
      "asset": {
        "chainId": 10143,
        "address": "0x534b2f3a21130d7a60830c2df862319e593943a3",
        "decimals": 6,
        "symbol": "USDC",
        "codeHash": "0x96215e6049ed615cdc22fea7701e85458a8e51a2df3e7d45e8f9fa1d521b5a78",
        "reviewed": true
      },
      "rpc": {
        "endpoint": "https://testnet-rpc.monad.xyz",
        "allowedEndpoints": [
          "https://testnet-rpc.monad.xyz"
        ],
        "allowedHosts": [
          "testnet-rpc.monad.xyz"
        ],
        "pythonExecutable": "/Users/mili/.mf-cp30-20261013/.venv/bin/python"
      },
      "observer": {
        "genesisHash": "0x298034669ee44327d2da9744b9b2782848e2f2a6959756b7b0471b09a404f5c9",
        "finality": "rpc-finalized",
        "eip1898": true,
        "runtimeTemplatePin": "0x2d6f320edd2627a18683f2fd37f45acd41f7fb4951c89b99e062650487ce191b",
        "compilerPins": {
          "index.mjs": "aa29a72b051c95e1d96a49b4fc6c4fbb118b20abf77e4144123cee62f5580c1c",
          "bridge.mjs": "b67034cff7e0c54620c5d7dda3a526718e620221109a2c8a1d92f73aae81f359",
          "escrow-abi.mjs": "1e751fbb8e7c900a87f9b01ddf3a6a2a76af081d849deabf8fb2bd19ee18d74e",
          "codec.py": "63736cb1dae6049ac5e9710e6c425e755702dccb823c210515361b1580bc0589",
          "../wallet/index.mjs": "5a5c2c1961e55519829e78824b306308c09657f32712dccbc0dda13ccf44eca0",
          "../wallet/escrow-abi.mjs": "1f8c6f4e1d1657042ed89f0f76a16dac8ff7d608099d2edfa58dee6be0e69af7",
          "../wallet/factory-abi.mjs": "e32e4605f0333b04464e3cdf55155016c512cb44ed05fdaceeb9af15c9aed838",
          "../wallet/escrow-creation-code.mjs": "bd1eb01f7cfc4ce219df5e577bea09db63c2f9f20b06af5380264d0fb8908df7",
          "../wallet/registration-observer.mjs": "62dc4f5fe4b8d0e525715c747e303138387684dbde1c16de6bc921c596c7c884",
          "../wallet/observer-artifacts.mjs": "823728c980f74db6e8271b288c708db4d5346a711f0d2862c457f66caeac10bf"
        },
        "budget": {
          "maxCalls": 96,
          "maxTotalMs": 20000,
          "maxCallMs": 3000,
          "maxResponseBytes": 1048576,
          "maxTotalBytes": 1048576,
          "maxMealIds": 3
        }
      },
      "approvalBudget": {
        "maxCalls": 12,
        "maxTotalMs": 20000,
        "maxCallMs": 3000,
        "maxResponseBytes": 1048576,
        "maxTotalBytes": 1048576
      },
      "maxSnapshotAgeSeconds": 120
    },
    "businessTemplate": {
      "roles": {
        "quoteAuthority": {
          "account": "0x814232fa062dc7b6d14610db8b614715b2dd0fc5",
          "profileCaps": {
            "registrar": "0x7b9ac33903b17b442c9f2e8f9c2f479d339f2543",
            "maxGas": "100000",
            "maxFeePerGas": "120000000000",
            "maxPriorityFeePerGas": "2000000000",
            "maxTransactionCostWei": "12000000000000000"
          },
          "grant": {
            "id": "fresh20261013_quoteAuthority",
            "signatureUnits": "10",
            "gasUnits": "120000000000000000",
            "enabled": false,
            "expiresAt": null
          }
        },
        "issuerAuthority": {
          "account": "0x177d5dbb0fc6cc03c209fc81987065380fed667c",
          "profileCaps": {
            "registrar": "0x7b9ac33903b17b442c9f2e8f9c2f479d339f2543",
            "maxGas": "1000000",
            "maxFeePerGas": "120000000000",
            "maxPriorityFeePerGas": "2000000000",
            "maxTransactionCostWei": "120000000000000000"
          },
          "grant": {
            "id": "fresh20261013_issuerAuthority",
            "signatureUnits": "10",
            "gasUnits": "1200000000000000000",
            "enabled": false,
            "expiresAt": null
          }
        },
        "operatorAuthority": {
          "account": "0x5f8e8eeec17778da5d0681217c8c98fc0c249371",
          "profileCaps": {
            "registrar": "0x7b9ac33903b17b442c9f2e8f9c2f479d339f2543",
            "maxGas": "1000000",
            "maxFeePerGas": "120000000000",
            "maxPriorityFeePerGas": "2000000000",
            "maxTransactionCostWei": "120000000000000000"
          },
          "grant": {
            "id": "fresh20261013_operatorAuthority",
            "signatureUnits": "10",
            "gasUnits": "1200000000000000000",
            "enabled": false,
            "expiresAt": null
          }
        }
      }
    },
    "custody": {
      "quoteAuthority": {
        "directory": "/Users/mili/.mf-cp30-20261013/quoteAuthority",
        "keyHandle": {
          "name": "authority.key",
          "device": 16777232,
          "inode": 9593462
        }
      },
      "issuerAuthority": {
        "directory": "/Users/mili/.mf-cp30-20261013/issuerAuthority",
        "keyHandle": {
          "name": "authority.key",
          "device": 16777232,
          "inode": 9593463
        }
      },
      "operatorAuthority": {
        "directory": "/Users/mili/.mf-cp30-20261013/operatorAuthority",
        "keyHandle": {
          "name": "authority.key",
          "device": 16777232,
          "inode": 9593464
        }
      }
    },
    "broadcastRpc": {
      "endpoint": "https://testnet-rpc.monad.xyz",
      "allowedEndpoints": [
        "https://testnet-rpc.monad.xyz"
      ],
      "allowedHosts": [
        "testnet-rpc.monad.xyz"
      ],
      "pythonExecutable": "/Users/mili/.mf-cp30-20261013/.venv/bin/python",
      "budget": {
        "maxCalls": 6,
        "maxCallMs": 3000,
        "maxTotalMs": 20000,
        "maxResponseBytes": 262144,
        "maxTotalBytes": 1048576
      }
    }
  }
}
```

## Fill and review before any initialize call

1. Set the actual signed sample's exact issuer/audiences/absence flags and selected
   signed email claim mode/paths. Candidate diagnostics remain unapproved; only
   after review set ClaimProfile `verified:true` and emailProfile `approved:true`.
   Never paste or persist the raw sample. The issuer validator now accepts only
   `app.dynamicauth.com/7fe95f70-e5cc-4c3c-beed-a133e81268dc`, exactly matching
   Root's verified signed sample; HTTPS-prefixed or other issuers are rejected.
   The minified token's signed email alone is not verified email. The selected
   `dynamic_verified_profile` mode requires the fixed official profile check below.
2. The verified public pending plan supplies token symbol `USDC`.
   Registrar `assetSymbol` and business `asset.symbol` must remain identical;
   symbol matches `[A-Za-z0-9._-]{1,24}`. Set the registrar chainProfileDigest to a
   reviewed public audit digest. Source requires nonzero lowercase `0x`+64hex,
   retains it in the original signer approval, and does not prescribe its hash
   preimage. Root's selected convention is SHA256 of canonical JSON containing
   the public registrar profile without chainProfileDigest. Retain the exact
   public preimage and separate Factory/chain verification evidence; do not reuse a digest from another run.
   Canonical means sorted keys, compact separators, UTF-8, no NaN, no newline.
3. Create all four grant expiry Unix **seconds** at final plan generation:
   `now < expiresAt <= now+86400`. Use a fresh bounded activation expiry no later
   than the relevant grants for this trial. IDs shown are Root-selected unique
   new IDs; do not refill, reset or adopt counters. Namespace must match
   `[a-z][a-z0-9_-]{0,63}`; selected draft namespace is a local choice.
4. Reconfirm the new approved public custody metadata privately. The three
   `authority.key` handles require current matching device/inode, owned0700
   directory, owned0600 regular single-link file,66–67bytes; this document only
   reads the metadata, never the bytes. Registrar uses the fixed string path
   `<new-run>/registrar/registrar.key` rather than a metadata object; its initializer
   checks owned0600 regular file,64–67bytes. No owner/payer key belongs here.
5. Set outer `enabled`, registrar `enabled`, application `enabled`, the three
   business role grant `enabled`, and intended activation flags to true only in
   Root's completed approved plan. `identity`, `ownerWalletBinding` and
   `storeDeployment` must be true for full initialize. Payer transaction and owner
   settlement flags govern explicit user-wallet operations; they grant no system
   authority to approve, fund or settle. False options remain false.
6. Validate complete source/profile shapes before the initializer's permanent
   INITIALIZING marker. Use the same pinned `.venv/bin/python` to invoke:
   `env -i <python> -I -B <backend>/tools/isolated-entry.py full-app initialize <new-run> --plan <private-plan>`.
   The plan must be a new owned0600 regular single-link JSON file <=262144bytes.
   Do not use prepare again on the existing run, or install this schema-preflight
   cluster as the application cluster. Root must stop the owned preparation page
   and release16443 before full-app start. This document authorizes no execution.

## Identity shapes and decision rules

ClaimProfile has exactly these constructor fields: `environment_id`, `issuer`,
`audiences` (JSON string list, normalized to tuple), `verified`,
`allow_absent_audience`, `allow_absent_environment_id`, `allow_absent_sid`.
The environment is fixed to the public sandbox. The last four policy flags are
actual booleans. Empty audiences require explicitly reviewed absent-audience
policy; absence policy is not implied by null in this draft. Audience values must
be bounded nonempty identifiers; issuer is compared exactly by the verifier.
Signature/RS256/kid, fixed public JWKS, time, `user:basic` and signed environment
binding are checked by the existing verifier. Presence of extra scopes, unknown
audience semantics or absent claims still requires policy review.

SignedEmailClaimProfile has exactly the nine fields shown in JSON. Select one:

| mode | Required values | Fields that must stay null |
| --- | --- | --- |
| `signed_boolean` | `email_path` and `verified_path` arrays of claim segments; `email_type:"string"`, `verified_type:"boolean"`, approved true | credentials_path, format_key, credential_email_key |
| `signed_verified_credentials` | credentials_path array; actual format_key and credential_email_key strings; email_type string, approved true; email_path may be null or select a signed target email | verified_path, verified_type |
| `dynamic_verified_profile` | email_path exactly `["email"]`, email_type string, approved true; strictly verified JWT first, then the fixed official profile provider's matching verified email | verified_path, verified_type, credentials_path, format_key, credential_email_key |

Each path is1–16 nonempty string segments, each <=256characters; credential field
keys are1–256characters. Boolean mode requires the signed verification value
actually true. Credential mode accepts exactly one `format_key=="email"` match
(possibly filtered by signed email_path) and canonicalizes its selected email
field. Use `uniqueEmailCredentialStructure` as the field-type evidence; union
credentialStructure can include wallet fields. Do not choose a guessed alias.

For the actual minified token, the third mode does not require invented
email_verified/verified_credentials claims. After the production JWT verifier and
subject/issuer/expiry binding checks, adapter passes the same raw token, verified
subject/environment and canonical signed email to the fixed helper
`verify_dynamic_verified_email`. It must explicitly return boolean true after a
single bounded authenticated official SDK profile GET has matched subject,
projectEnvironmentId and unique verified email credential. No configurable URL,
browser-provided email evidence, cookie, redirect, retry or claim fallback is
accepted. Root's reviewed plan passes pure source validation with this mode;
actual provider HTTP remains a separate normal-login verification step.

WalletProof has exactly the seven public fields in the draft. Name/version are
nonempty trimmed strings <=128characters, no controls. Integer chainId10143,
verifyingContract equals the actual Factory; ttlSeconds integer1–300. Backend
origin hash is `0x`+SHA256(exact UTF-8 origin), already computed in the draft;
full-app also derives it if explicitly null. Namespace hash is derived internally,
not an extra plan field. TLS files must be new private files under this run's tls,
key/cert public keys must match, certificate current, SAN must match `localhost`.
Origin has no trailing slash/path/query/fragment and must equal allowedOrigin.

## Exact runtime profile and transport boundaries

| Location | Shape / source behavior |
| --- | --- |
| registrar.profile | lowercase nonzero addresses for Factory/system roles/asset; **decimal string** chainId `"10143"`; nonzero lowercase64hex genesis/factoryCodeHash/chainProfileDigest/creation pins; runtimeTemplatePins factory+escrow; mode TESTNET and actual asset decimals/symbol |
| registrar.rpc | endpoint, exact allowedEndpoints, allowedHosts, maxCalls1–48, maxTotalSeconds1–20; child uses the pinned current interpreter, not a pythonExecutable in this RPC object |
| registrationObserver | endpoint/allowlists/pythonExecutable, **exact14-field** profile and exact7 compilerPins shown above; profile chainId is safe **integer**10143; finality rpc-finalized, eip1898 true, exact factory/escrow template pins and same-build creation pin |
| walletKindRpc | same readonly endpoint/allowlists/Python; its minimum consumed profile is integer chainId, genesisHash, factory, registration-style budget; finalized/canonical wallet code checks are hardcoded. It performs no broadcast |
| business.rpc | endpoint/allowlists/pythonExecutable only; strict per-store observer profile is generated after real CONFIRMED registration, never entered manually here |
| business.observer | exact six consumed fields: genesisHash/finality/eip1898/runtimeTemplatePin/compilerPins/budget; pin is same-build Escrow template; compilerPins are the exact10-key dictionary shown above |
| business.asset | **exact6 fields** chainId/address/decimals/symbol/codeHash/reviewed; safe integer chainId, integer decimals0–36, reviewed true, exact public asset code hash; no funded balance is implied |
| business.approvalBudget | exact5-key approve-read budget; asset/escrow/codeHash/finality profile is composed internally from verified store and asset |
| broadcastRpc | **exact5 fields** endpoint/allowedEndpoints/allowedHosts/pythonExecutable/budget; dedicated issuer/operator original-only methods, not the registrar transport or wallet provider |
| businessTemplate.roles | **exact3 keys** quoteAuthority/issuerAuthority/operatorAuthority. catalogAuthority remains an immutable Factory/getter input and is not an extra business runtime role |

All HTTPS RPC endpoints must be explicitly allowlisted, host lowercase approved,
no userinfo/fragment, port absent or443. All executable paths are absolute. Node
is source-fixed at `/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`;
no nodeExecutable field is accepted in the plan. The source's viem helpers and
their pinned compiler/ABI files must be present. Nine Python distributions must
match `requirements-connection.lock`, PG must be17.11. Only PG child processes
receive fixed public `LC_ALL=C`; apps use isolated empty-environment entry.

Each RPC budget key is a positive integer, <= the displayed JSON ceiling, with
maxCallMs<=maxTotalMs. Registration/wallet budget has exactly6 keys including
maxCatalogEntries<=3; business budget has exactly6 keys including maxMealIds<=3;
approval and broadcaster each exactly5 keys. Registrar uses seconds and no budget
subobject. maxSnapshotAgeSeconds is integer1–300 (draft120). These limits preserve
the three-store architecture while the authorized first run uses one store/meal.

## Selected budget arithmetic and generated fields

All fee/gas/money values are canonical decimal **strings**, measured in native wei
for gas budgets, not ERC20 amounts. Positive string pattern `[1-9][0-9]{0,77}`;
business priority may be `"0"`, registrar priority must remain positive. Values
used as uint256 must be <2^256. Do not use scientific notation, floats, separators,
leading zeroes or MON units in the JSON.

| Authority | Plan gas | Max fee / priority (wei/gas) | Per-transaction maximum wei | Signature cap | Total gas budget wei |
| --- | --- | --- | --- | --- | --- |
| registrar |8000000|120000000000 /2000000000|960000000000000000|3|2880000000000000000|
| quoteAuthority |100000|120000000000 /2000000000|12000000000000000|10|120000000000000000|
| issuerAuthority |1000000|120000000000 /2000000000|120000000000000000|10|1200000000000000000|
| operatorAuthority |1000000|120000000000 /2000000000|120000000000000000|10|1200000000000000000|

Registrar transactionLimits contains exactly gas/maxFeePerGas/maxPriorityFeePerGas;
priority<=fee and gas*fee<=registrar grant.gasUnits. Business profileCaps contains
exactly registrar/maxGas/maxFeePerGas/maxPriorityFeePerGas/maxTransactionCostWei;
priority<=fee and maxGas*maxFee<=maxTransactionCostWei. Selected total grants cover
the displayed signature count times the single-tx cap; runtime charges exact
original reservations monotonically and may close when actual capacity is spent.
Quote authority signs quotes, consumes signature units and reserves gas cost0;
its nominal positive caps are required by the shared profile validator, not a
quote transaction permission. This table is not an actual gas estimate. Factory
bootstrap is already separately retained/verified, not another createStore permit.

After real registration the binder derives the exact10-field binding (chainId,
escrow,asset,storeId,owner,receiver,quoteAuthority,catalogAuthority,issuerAuthority,
operatorAuthority), registrationState CONFIRMED and original registrationEvidence.
It probes actual Escrow code hash and computes its own chain-profile digest,
then creates each exact9-field signer profile (namespace,binding,escrowCodeHash,
chainProfileDigest,registrar plus the four numeric profile caps). Do not enter
escrow/storeId/owner/receiver/registrationId/manual confirmed evidence in this plan.
System authority must differ from owner and registrar. Issuer/operator broadcaster
adds genesisHash to that derived profile; no separate manual broadcaster binding.

Initializer generates DB passwords, API/private capabilities, HMAC/cursor secrets,
security/binding/registrar/ledger configuration and journals internally. Do not add
them to the public plan. Actual startup/role privilege checks remain separate from
the successful24-migration schema-only transaction reported by Root.

## Source evidence

Minimal verification: the complete JSON parses; Root's public pending plan passes
the existing non-identity application cross-field validator using transient
in-memory identity readiness doubles (never saved, no signed sample, not identity
approval). Selected budget arithmetic passes; both exact dictionaries and all17
referenced registration/business source SHA256 pins match current files. No
initializer, RPC, key/journal access or service execution occurred in this check.

| Rule | File / verified source line |
| --- | --- |
| Full draft shape | config/full-app.disabled.json |
| Fresh identity/custody/TLS/expiry gate | tools/full-app.py:23 |
| Registrar/limits/pins/runtime validator and permanent marker | tools/connection-bootstrap.py:45,73 |
| Full application cross-field consistency and exact fixed issuer | src/c1/full_configuration.py:13 |
| Config/secret generation boundaries | tools/application_setup.py:8 |
| ClaimProfile and pure public-key verifier | ../server/dynamic_contracts.py:25; ../server/dynamic_jwt.py:137,147 |
| Email modes and readiness | integrations/identity/adapter.py:22 |
| Fixed official verified-email helper | integrations/identity/dynamic_verified_email.py:108 |
| Wallet domain and internal normalization | integrations/identity/wallet_proof.py:33; src/c1/identity_runtime.py:101 |
| Registration exact profile/pins and read budget | integrations/wallet/registration_observer.py:29,57; integrations/wallet/rpc_transport.py:65 |
| Business derived profile/binder | src/c1/live_gateway.py:30; src/c1/automatic_business.py:16 |
| Strict business observer profile/budget | integrations/business/observer.py:214; integrations/business/rpc_transport.py:91 |
| Dedicated signer profile | integrations/business/original_signer.py:41 |
| Exact broadcaster config/profile/caps | integrations/business/original_broadcaster.py:22,28 |
| Approval budget/profile | integrations/wallet/approval_rpc.py:60,70 |
| Public identity diagnostic, no auto-approval | tools/identity-calibration.py; docs/IDENTITY-CALIBRATION-SOURCE.md |
