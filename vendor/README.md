# Vendored libraries

Checked in rather than installed, so the project has no build-time dependency
chain and `build.sh` can inline them into a single self-contained page.

| File | Library | Version | Licence |
| --- | --- | --- | --- |
| `opencc-cn2t.js` | [opencc-js](https://github.com/nk2028/opencc-js) | 1.4.2 | MIT AND Apache-2.0 |
| `jszip.min.js` | [JSZip](https://github.com/Stuk/jszip) | 3.10.1 | MIT OR GPL-3.0-or-later |
| `opentype.min.js` | [opentype.js](https://github.com/opentypejs/opentype.js) | 2.0.0 | MIT |

Licence texts are in `licenses/`. JSZip is used under the MIT option.

`opencc-cn2t.js` is the UMD `cn2t` bundle — the simplified→traditional
direction only. The full bundle also carries the reverse direction, which this
project does not use.
