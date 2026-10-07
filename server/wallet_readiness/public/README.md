# CP19 original public compiler artifact

MealForwardTestnet.json is an exact public copy of the artifact used by reviewed
CP19 source commit 701b756009bfa8fb92d3cdba8b6e0762ac659b29. It was not rebuilt or
normalized for CP27. The parent historical-manifest.json pins its raw SHA256,
canonical JSON SHA256, compiler settings, immutable merchant and full runtime hash.

The approved CP19 historical deployment is reference only. This public compiler
output has no wallet keys, signed transaction, private RPC configuration or user data.
A local rebuild with different paths/metadata must not silently replace this artifact.
