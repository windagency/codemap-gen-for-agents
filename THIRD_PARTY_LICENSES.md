# Third-party licenses

[Back to README.md](README.md) • [Back to AGENTS.md](AGENTS.md) • [Back to 0045-discovery-follows-the-root-gitignore.md](documentation/adr/0045-discovery-follows-the-root-gitignore.md) • [Back to TESTING.md](documentation/TESTING.md)

This file lists the licenses of every package in this project's **production** dependency tree - the packages that ship inside `dist/` and the published npm package, including transitive dependencies pulled in by direct ones. `devDependencies` (Biome, Vitest, TypeScript's own toolchain outside the `typescript` package itself, etc.) are not listed here: they are used to build and test this project but are never distributed with it.

This file is generated - do not hand-edit it. Regenerate it with:

```bash
node scripts/generate-third-party-licenses.mjs
```

CI runs the same script with `--check` and fails the build if this file is stale, or if a production dependency's license isn't on the generator's permissive allowlist - see `.github/workflows/ci.yml`.

All 146 packages in the production tree use a permissive license (Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MIT, Unlicense). None introduce copyleft obligations.

## Direct dependencies

The packages this project's own `package.json` depends on directly.

| Package | Version | License | Copyright |
| --- | --- | --- | --- |
| typescript | 7.0.2 | Apache-2.0 | Microsoft Corp. |
| d3 | 7.9.0 | ISC | Mike Bostock |
| @modelcontextprotocol/sdk | 1.31.0 | MIT | Anthropic, PBC |
| graphology | 0.26.0 | MIT | - |
| graphology-communities-louvain | 2.0.2 | MIT | - |
| ignore | 7.0.11 | MIT | kael |
| picomatch | 4.0.7 | MIT | Jon Schlinkert |
| tree-sitter | 0.25.1 | MIT | Max Brunsfeld |
| tree-sitter-go | 0.25.0 | MIT | Max Brunsfeld |
| tree-sitter-java | 0.23.5 | MIT | Ayman Nadeem |
| tree-sitter-python | 0.25.0 | MIT | Max Brunsfeld |
| tree-sitter-rust | 0.24.0 | MIT | Maxim Sokolov |
| zod | 4.6.5 | MIT | Colin McDonnell |

## Full production dependency tree

Every package resolved into the production tree (direct and transitive), as installed by `pnpm-lock.yaml`. A dash in the Copyright column means the package's own metadata does not declare an author.

| Package | Version | License | Copyright |
| --- | --- | --- | --- |
| typescript | 7.0.2 | Apache-2.0 | Microsoft Corp. |
| json-schema-typed | 8.0.2 | BSD-2-Clause | Remy Rylan |
| d3-ease | 3.0.1 | BSD-3-Clause | Mike Bostock |
| fast-uri | 3.1.8 | BSD-3-Clause | Vincent Le Goff |
| qs | 6.16.0 | BSD-3-Clause | - |
| rw | 1.3.3 | BSD-3-Clause | Mike Bostock |
| d3 | 7.9.0 | ISC | Mike Bostock |
| d3-array | 3.2.4 | ISC | Mike Bostock |
| d3-axis | 3.0.0 | ISC | Mike Bostock |
| d3-brush | 3.0.0 | ISC | Mike Bostock |
| d3-chord | 3.0.1 | ISC | Mike Bostock |
| d3-color | 3.1.0 | ISC | Mike Bostock |
| d3-contour | 4.0.2 | ISC | Mike Bostock |
| d3-delaunay | 6.0.4 | ISC | Mike Bostock |
| d3-dispatch | 3.0.1 | ISC | Mike Bostock |
| d3-drag | 3.0.0 | ISC | Mike Bostock |
| d3-dsv | 3.0.1 | ISC | Mike Bostock |
| d3-fetch | 3.0.1 | ISC | Mike Bostock |
| d3-force | 3.0.0 | ISC | Mike Bostock |
| d3-format | 3.1.2 | ISC | Mike Bostock |
| d3-geo | 3.1.1 | ISC | Mike Bostock |
| d3-hierarchy | 3.1.2 | ISC | Mike Bostock |
| d3-interpolate | 3.0.1 | ISC | Mike Bostock |
| d3-path | 3.1.0 | ISC | Mike Bostock |
| d3-polygon | 3.0.1 | ISC | Mike Bostock |
| d3-quadtree | 3.0.1 | ISC | Mike Bostock |
| d3-random | 3.0.1 | ISC | Mike Bostock |
| d3-scale | 4.0.2 | ISC | Mike Bostock |
| d3-scale-chromatic | 3.1.0 | ISC | Mike Bostock |
| d3-selection | 3.0.0 | ISC | Mike Bostock |
| d3-shape | 3.2.0 | ISC | Mike Bostock |
| d3-time | 3.1.0 | ISC | Mike Bostock |
| d3-time-format | 4.1.0 | ISC | Mike Bostock |
| d3-timer | 3.0.1 | ISC | Mike Bostock |
| d3-transition | 3.0.1 | ISC | Mike Bostock |
| d3-zoom | 3.0.0 | ISC | Mike Bostock |
| delaunator | 5.1.0 | ISC | Vladimir Agafonkin |
| inherits | 2.0.4 | ISC | - |
| internmap | 2.0.3 | ISC | Mike Bostock |
| isexe | 2.0.0 | ISC | Isaac Z. Schlueter |
| once | 1.4.0 | ISC | Isaac Z. Schlueter |
| setprototypeof | 1.2.0 | ISC | Wes Todd |
| which | 2.0.2 | ISC | Isaac Z. Schlueter |
| wrappy | 1.0.2 | ISC | Isaac Z. Schlueter |
| zod-to-json-schema | 3.25.2 | ISC | Stefan Terdell |
| @hono/node-server | 2.1.3 | MIT | Yusuke Wada |
| @modelcontextprotocol/sdk | 1.31.0 | MIT | Anthropic, PBC |
| accepts | 2.0.0 | MIT | - |
| ajv | 8.20.0 | MIT | Evgeny Poberezkin |
| ajv-formats | 3.0.1 | MIT | Evgeny Poberezkin |
| body-parser | 2.3.0 | MIT | - |
| bytes | 3.1.2 | MIT | TJ Holowaychuk |
| call-bind-apply-helpers | 1.0.2 | MIT | Jordan Harband |
| call-bound | 1.0.4 | MIT | Jordan Harband |
| commander | 7.2.0 | MIT | TJ Holowaychuk |
| content-disposition | 1.1.0 | MIT | Douglas Christopher Wilson |
| content-type | 1.0.5,2.1.0 | MIT | Douglas Christopher Wilson |
| cookie | 0.7.2 | MIT | Roman Shtylman |
| cookie-signature | 1.2.2 | MIT | TJ Holowaychuk |
| cors | 2.8.6 | MIT | Troy Goode |
| cross-spawn | 7.0.6 | MIT | André Cruz |
| debug | 4.4.3 | MIT | Josh Junon |
| depd | 2.0.0 | MIT | Douglas Christopher Wilson |
| dunder-proto | 1.0.1 | MIT | Jordan Harband |
| ee-first | 1.1.1 | MIT | Jonathan Ong |
| encodeurl | 2.0.0 | MIT | - |
| es-define-property | 1.0.1 | MIT | Jordan Harband |
| es-errors | 1.3.0 | MIT | Jordan Harband |
| es-object-atoms | 1.1.2 | MIT | Jordan Harband |
| escape-html | 1.0.3 | MIT | - |
| etag | 1.8.1 | MIT | - |
| events | 3.3.0 | MIT | Irakli Gozalishvili |
| eventsource | 3.0.7 | MIT | Espen Hovlandsdal |
| eventsource-parser | 3.1.1 | MIT | Espen Hovlandsdal |
| express | 5.2.1 | MIT | TJ Holowaychuk |
| express-rate-limit | 8.7.0 | MIT | Nathan Friedly |
| fast-deep-equal | 3.1.3 | MIT | Evgeny Poberezkin |
| finalhandler | 2.1.1 | MIT | Douglas Christopher Wilson |
| forwarded | 0.2.0 | MIT | - |
| fresh | 2.0.0 | MIT | TJ Holowaychuk |
| function-bind | 1.1.2 | MIT | Raynos |
| get-intrinsic | 1.3.0 | MIT | Jordan Harband |
| get-proto | 1.0.1 | MIT | Jordan Harband |
| gopd | 1.2.0 | MIT | Jordan Harband |
| graphology | 0.26.0 | MIT | - |
| graphology-communities-louvain | 2.0.2 | MIT | - |
| graphology-indices | 0.17.0 | MIT | Guillaume Plique |
| graphology-types | 0.24.8 | MIT | - |
| graphology-utils | 2.5.2 | MIT | - |
| has-symbols | 1.1.0 | MIT | Jordan Harband |
| hasown | 2.0.4 | MIT | Jordan Harband |
| hono | 4.13.12 | MIT | Yusuke Wada |
| http-errors | 2.0.1 | MIT | Jonathan Ong |
| iconv-lite | 0.6.3,0.7.3 | MIT | Alexander Shtuchkin |
| ignore | 7.0.11 | MIT | kael |
| ip-address | 10.7.2 | MIT | Beau Gunderson |
| ipaddr.js | 1.9.1 | MIT | whitequark |
| is-promise | 4.0.0 | MIT | ForbesLindesay |
| jose | 6.2.12 | MIT | Filip Skokan |
| json-schema-traverse | 1.0.0 | MIT | Evgeny Poberezkin |
| math-intrinsics | 1.1.0 | MIT | Jordan Harband |
| media-typer | 1.1.1 | MIT | Douglas Christopher Wilson |
| merge-descriptors | 2.0.0 | MIT | - |
| mime-db | 1.54.0 | MIT | - |
| mime-types | 3.0.2 | MIT | - |
| mnemonist | 0.39.8 | MIT | Guillaume Plique |
| ms | 2.1.3 | MIT | - |
| negotiator | 1.1.0 | MIT | - |
| node-addon-api | 8.9.2 | MIT | - |
| node-gyp-build | 4.8.4 | MIT | Mathias Buus |
| object-assign | 4.1.1 | MIT | Sindre Sorhus |
| object-inspect | 1.13.4 | MIT | James Halliday |
| obliterator | 2.0.5 | MIT | Guillaume Plique |
| on-finished | 2.4.1 | MIT | - |
| pandemonium | 2.4.1 | MIT | Guillaume Plique |
| parseurl | 1.3.3 | MIT | - |
| path-key | 3.1.1 | MIT | Sindre Sorhus |
| path-to-regexp | 8.4.2 | MIT | - |
| picomatch | 4.0.7 | MIT | Jon Schlinkert |
| pkce-challenge | 5.0.1 | MIT | crouchcd |
| proxy-addr | 2.0.8 | MIT | Douglas Christopher Wilson |
| range-parser | 1.3.0 | MIT | TJ Holowaychuk |
| raw-body | 3.0.2 | MIT | Jonathan Ong |
| require-from-string | 2.0.2 | MIT | Vsevolod Strukchinsky |
| router | 2.2.0 | MIT | Douglas Christopher Wilson |
| safer-buffer | 2.1.2 | MIT | Nikita Skovoroda |
| send | 1.2.1 | MIT | TJ Holowaychuk |
| serve-static | 2.2.1 | MIT | Douglas Christopher Wilson |
| shebang-command | 2.0.0 | MIT | Kevin Mårtensson |
| shebang-regex | 3.0.0 | MIT | Sindre Sorhus |
| side-channel | 1.1.1 | MIT | Jordan Harband |
| side-channel-list | 1.0.1 | MIT | Jordan Harband |
| side-channel-map | 1.0.1 | MIT | Jordan Harband |
| side-channel-weakmap | 1.0.2 | MIT | Jordan Harband |
| statuses | 2.0.2 | MIT | - |
| toidentifier | 1.0.1 | MIT | Douglas Christopher Wilson |
| tree-sitter | 0.25.1 | MIT | Max Brunsfeld |
| tree-sitter-go | 0.25.0 | MIT | Max Brunsfeld |
| tree-sitter-java | 0.23.5 | MIT | Ayman Nadeem |
| tree-sitter-python | 0.25.0 | MIT | Max Brunsfeld |
| tree-sitter-rust | 0.24.0 | MIT | Maxim Sokolov |
| type-is | 2.1.0 | MIT | - |
| unpipe | 1.0.0 | MIT | Douglas Christopher Wilson |
| vary | 1.1.2 | MIT | Douglas Christopher Wilson |
| zod | 4.6.5 | MIT | Colin McDonnell |
| robust-predicates | 3.0.3 | Unlicense | Vladimir Agafonkin |

## License texts

Each permissive license's full terms require the text below plus the copyright line(s) for the specific package - see the Copyright column in the tables above for the holder that applies to each package. Where only one package in the tree uses a license, its license file is reproduced verbatim, copyright line included.

### Apache-2.0

Applies to: typescript. Reproduced verbatim from the package's own license file, copyright line included.

```
Apache License

Version 2.0, January 2004

http://www.apache.org/licenses/ 

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction, and distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all other entities that control, are controlled by, or are under common control with that entity. For the purposes of this definition, "control" means (i) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (ii) ownership of fifty percent (50%) or more of the outstanding shares, or (iii) beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity exercising permissions granted by this License.

"Source" form shall mean the preferred form for making modifications, including but not limited to software source code, documentation source, and configuration files.

"Object" form shall mean any form resulting from mechanical transformation or translation of a Source form, including but not limited to compiled object code, generated documentation, and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or Object form, made available under the License, as indicated by a copyright notice that is included in or attached to the work (an example is provided in the Appendix below).

"Derivative Works" shall mean any work, whether in Source or Object form, that is based on (or derived from) the Work and for which the editorial revisions, annotations, elaborations, or other modifications represent, as a whole, an original work of authorship. For the purposes of this License, Derivative Works shall not include works that remain separable from, or merely link (or bind by name) to the interfaces of, the Work and Derivative Works thereof.

"Contribution" shall mean any work of authorship, including the original version of the Work and any modifications or additions to that Work or Derivative Works thereof, that is intentionally submitted to Licensor for inclusion in the Work by the copyright owner or by an individual or Legal Entity authorized to submit on behalf of the copyright owner. For the purposes of this definition, "submitted" means any form of electronic, verbal, or written communication sent to the Licensor or its representatives, including but not limited to communication on electronic mailing lists, source code control systems, and issue tracking systems that are managed by, or on behalf of, the Licensor for the purpose of discussing and improving the Work, but excluding communication that is conspicuously marked or otherwise designated in writing by the copyright owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity on behalf of whom a Contribution has been received by Licensor and subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare Derivative Works of, publicly display, publicly perform, sublicense, and distribute the Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this section) patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by such Contributor that are necessarily infringed by their Contribution(s) alone or by combination of their Contribution(s) with the Work to which such Contribution(s) was submitted. If You institute patent litigation against any entity (including a cross-claim or counterclaim in a lawsuit) alleging that the Work or a Contribution incorporated within the Work constitutes direct or contributory patent infringement, then any patent licenses granted to You under this License for that Work shall terminate as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the Work or Derivative Works thereof in any medium, with or without modifications, and in Source or Object form, provided that You meet the following conditions:

You must give any other recipients of the Work or Derivative Works a copy of this License; and

You must cause any modified files to carry prominent notices stating that You changed the files; and

You must retain, in the Source form of any Derivative Works that You distribute, all copyright, patent, trademark, and attribution notices from the Source form of the Work, excluding those notices that do not pertain to any part of the Derivative Works; and

If the Work includes a "NOTICE" text file as part of its distribution, then any Derivative Works that You distribute must include a readable copy of the attribution notices contained within such NOTICE file, excluding those notices that do not pertain to any part of the Derivative Works, in at least one of the following places: within a NOTICE text file distributed as part of the Derivative Works; within the Source form or documentation, if provided along with the Derivative Works; or, within a display generated by the Derivative Works, if and wherever such third-party notices normally appear. The contents of the NOTICE file are for informational purposes only and do not modify the License. You may add Your own attribution notices within Derivative Works that You distribute, alongside or as an addendum to the NOTICE text from the Work, provided that such additional attribution notices cannot be construed as modifying the License. You may add Your own copyright statement to Your modifications and may provide additional or different license terms and conditions for use, reproduction, or distribution of Your modifications, or for any such Derivative Works as a whole, provided Your use, reproduction, and distribution of the Work otherwise complies with the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise, any Contribution intentionally submitted for inclusion in the Work by You to the Licensor shall be under the terms and conditions of this License, without any additional terms or conditions. Notwithstanding the above, nothing herein shall supersede or modify the terms of any separate license agreement you may have executed with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade names, trademarks, service marks, or product names of the Licensor, except as required for reasonable and customary use in describing the origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or agreed to in writing, Licensor provides the Work (and each Contributor provides its Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining the appropriateness of using or redistributing the Work and assume any risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory, whether in tort (including negligence), contract, or otherwise, unless required by applicable law (such as deliberate and grossly negligent acts) or agreed to in writing, shall any Contributor be liable to You for damages, including any direct, indirect, special, incidental, or consequential damages of any character arising as a result of this License or out of the use or inability to use the Work (including but not limited to damages for loss of goodwill, work stoppage, computer failure or malfunction, or any and all other commercial damages or losses), even if such Contributor has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing the Work or Derivative Works thereof, You may choose to offer, and charge a fee for, acceptance of support, warranty, indemnity, or other liability obligations and/or rights consistent with this License. However, in accepting such obligations, You may act only on Your own behalf and on Your sole responsibility, not on behalf of any other Contributor, and only if You agree to indemnify, defend, and hold each Contributor harmless for any liability incurred by, or claims asserted against, such Contributor by reason of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
```

### BSD-2-Clause

Applies to: json-schema-typed. Reproduced verbatim from the package's own license file, copyright line included.

```
BSD 2-Clause License

Original source code is copyright (c) 2019-2025 Remy Rylan
<https://github.com/RemyRylan>

All JSON Schema documentation and descriptions are copyright (c):

2009 [draft-0] IETF Trust <https://www.ietf.org/>, Kris Zyp <kris@sitepen.com>,
and SitePen (USA) <https://www.sitepen.com/>.

2009 [draft-1] IETF Trust <https://www.ietf.org/>, Kris Zyp <kris@sitepen.com>,
and SitePen (USA) <https://www.sitepen.com/>.

2010 [draft-2] IETF Trust <https://www.ietf.org/>, Kris Zyp <kris@sitepen.com>,
and SitePen (USA) <https://www.sitepen.com/>.

2010 [draft-3] IETF Trust <https://www.ietf.org/>, Kris Zyp <kris@sitepen.com>,
Gary Court <gary.court@gmail.com>, and SitePen (USA) <https://www.sitepen.com/>.

2013 [draft-4] IETF Trust <https://www.ietf.org/>), Francis Galiegue
<fgaliegue@gmail.com>, Kris Zyp <kris@sitepen.com>, Gary Court
<gary.court@gmail.com>, and SitePen (USA) <https://www.sitepen.com/>.

2018 [draft-7] IETF Trust <https://www.ietf.org/>, Austin Wright <aaa@bzfx.net>,
Henry Andrews <henry@cloudflare.com>, Geraint Luff <luffgd@gmail.com>, and
Cloudflare, Inc. <https://www.cloudflare.com/>.

2019 [draft-2019-09] IETF Trust <https://www.ietf.org/>, Austin Wright
<aaa@bzfx.net>, Henry Andrews <andrews_henry@yahoo.com>, Ben Hutton
<bh7@sanger.ac.uk>, and Greg Dennis <gregsdennis@yahoo.com>.

2020 [draft-2020-12] IETF Trust <https://www.ietf.org/>, Austin Wright
<aaa@bzfx.net>, Henry Andrews <andrews_henry@yahoo.com>, Ben Hutton
<ben@jsonschema.dev>, and Greg Dennis <gregsdennis@yahoo.com>.

All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD-3-Clause

Applies to: d3-ease, fast-uri, qs, rw, with the copyright line(s) from the table above substituted per package.

```
Copyright (c) <year> <copyright holder>
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the author nor the names of contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### ISC

Applies to all 39 ISC packages in the table above, with the copyright line(s) from the table above substituted per package.

```
Copyright (c) <copyright holder>

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

### MIT

Applies to all 100 MIT packages in the table above, with the copyright line(s) from the table above substituted per package.

```
MIT License

Copyright (c) <year> <copyright holder>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Unlicense

Applies to: robust-predicates. Reproduced verbatim from the package's own license file, copyright line included.

```
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org>
```
