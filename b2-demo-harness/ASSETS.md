# Independent meal image provenance

Both photographs were generated with the built-in ImageGen tool for this synthetic demo. No private user images were uploaded; no UI screenshot was cropped into a shipped image. They are illustrative meals for fictional stores, reused consistently across the three built-in menus. They are not evidence of a real restaurant or real food offering.

| Shipped image | ImageGen output | SHA-256 of shipped JPEG |
| --- | --- | --- |
| `public/assets/chicken.jpg` | `/Users/mili/.codex/generated_images/01a0f0e8-2ab0-72a1-bfd3-018f378af54a/exec-0d6e21ac-ce80-4cae-b386-f005ceaa0b89.png` | `2d56de0f5eac11ee90bb7ee4ecb5fe7c1f583ba999b2b8093be09c250c6d56da` |
| `public/assets/tofu.jpg` | `/Users/mili/.codex/generated_images/01a0f0e8-2ab0-72a1-bfd3-018f378af54a/exec-206463b3-410b-4433-bab4-29b1c3b33af6.png` | `e7ccb3415d8e8f811eae2bbef09bba2f0fcb73013f9b108d2793db5519d74a26` |

Prompt briefs retained here summarize the generation instructions, rather than claiming verbatim tool logs: mushroom chicken rice in a ceramic bowl with vegetables, natural daylight on a wooden table, realistic neighborhood meal photography, 3:2 composition; mushroom tofu rice with the same bowl/table/daylight art direction. No text, logos or interface elements were requested. The generated PNGs were visually inspected and converted with macOS `sips` to 800px JPEG at quality 82. CSS uses `object-fit: cover` with reserved image sizes.

UI icons use Lucide React; the demo QR uses qrcode.react and encodes only an explicit `mealforward:demo:` string. The brand is text in the frozen Georgia/system font stack. No third-party photograph or embedded font was downloaded.
