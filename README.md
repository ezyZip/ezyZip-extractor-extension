# ezyZip File Extractor — browser extension

Right-click any archive link and choose **"Extract with ezyZip"**. The extension
opens [ezyZip](https://www.ezyzip.com) with that file, and the web app downloads
and extracts it entirely in your browser — nothing is uploaded to a server.

Homepage: **https://www.ezyzip.com**

## Install

| Browser | Listing |
| --- | --- |
| Chrome  | https://chromewebstore.google.com/detail/ezyzip-file-extractor/onahphjemcklekcejkblaghjipokancd |
| Edge    | https://microsoftedge.microsoft.com/addons/detail/ezyzip-file-extractor/dlobmohjanccicfpdadkoklblpdhgdbp |
| Firefox | https://addons.mozilla.org/firefox/addon/ezyzip-file-extractor/ |

## What it does

The extension adds a single context-menu item to links. Selecting it opens a new
tab at the ezyZip web app with the link passed as a `?url=` parameter; the app
fetches the archive and unpacks it client-side. A popup lets the user pick the
target site (the free **www.ezyzip.com** or **ezyzip.pro**) and the menu
language (auto-detected from the browser UI locale by default).

## How it works

The extension is **Manifest V3** and has three parts:

**1. Context menu (`background.js`).** Registers the "Extract with ezyZip" item
on links, localises its label, and on click opens
`https://<site>/<localised-path>?url=<encoded link>`.

**2. Page ↔ extension detection (`content.js`).** A small content script runs on
ezyZip pages and announces the extension to the web app two ways:

- it injects a `<meta name="ezyzip-extension" content="installed">` marker into
  the page `<head>` for synchronous detection, and
- it answers an `ezyzip-extension-ping` `CustomEvent` with an
  `ezyzip-extension-pong` `CustomEvent` for an asynchronous check.

**3. CORS headers (`declarativeNetRequest`).** So the web app can fetch archives
from arbitrary user-chosen URLs, the extension adds the response headers a
cross-origin `fetch` needs. Every rule is **scoped by `initiatorDomains`** to the
ezyZip origins (`www.ezyzip.com`, `ezyzip.com`, `ezyzip.pro`) and matches **GET
requests only**; rules never touch `Access-Control-Allow-Methods` and only
**append** to `Access-Control-Expose-Headers` (`Content-Disposition`,
`Content-Length`).

`Access-Control-Allow-Origin` (ACAO) handling differs per engine:

- **Chromium (Chrome / Edge).** `Access-Control-Allow-Origin: *` is added **only
  when the response carries no ACAO header of its own** — expressed with the
  `excludedResponseHeaders` condition. Responses that already implement CORS are
  left untouched, so credentialed cross-origin requests made from the host pages
  are never affected (a wildcard ACAO is invalid alongside credentials). That
  response-header condition requires **Chromium 128+**, which is why the
  manifests set `minimum_chrome_version: 128`. It is registered as a **dynamic
  rule from `background.js`**, so the static `rules.json` needs only the
  append-only expose-headers rule (whose conditions every store package
  validator recognises). The Chrome and Edge variants are otherwise byte-for-byte
  identical in `rules.json` and `background.js`.
- **Firefox.** Firefox's `declarativeNetRequest` has no response-header
  conditions, so the Firefox variant instead ships **per-origin ACAO echo rules**
  in `rules.json` — each sets ACAO to the exact requesting origin (the `www` rule
  outranks the apex rule). One consequence: archives served behind a
  **cross-origin redirect** can't be fetched yet on Firefox, because a redirected
  request sends `Origin: null` and only a wildcard `*` would satisfy it.

## Privacy

- No data collection and no analytics.
- No remote code — everything the extension runs ships inside the package.
- Response headers are modified only for GET requests **initiated from ezyZip
  pages** (`initiatorDomains`), and only the CORS headers described above.

## Repository layout

```
ezyzip-extension/          Chrome variant (MV3, service worker)
ezyzip-extension-edge/     Edge variant (rules/background identical to Chrome)
ezyzip-extension-firefox/  Firefox variant (event page, per-origin ACAO rules)
test/dnr-rules.test.js     declarativeNetRequest rule invariants (node --test)
build-zips.sh              packages each variant for store submission
```

## Develop

Load a variant unpacked:

- **Chrome:** `chrome://extensions` → enable *Developer mode* → *Load unpacked* →
  select `ezyzip-extension/`.
- **Edge:** `edge://extensions` → enable *Developer mode* → *Load unpacked* →
  select `ezyzip-extension-edge/`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…*
  → pick any file inside `ezyzip-extension-firefox/` (e.g. `manifest.json`).
  Temporary add-ons unload when Firefox closes.

## Test

The rule invariants are checked by a dependency-free Node test (no install step):

```
node --test        # or: npm test
```

It validates, across the variants, that the CORS rules stay initiator-scoped and
GET-only, never modify `Access-Control-Allow-Methods`, only append to the
expose-headers list, keep the wildcard ACAO conditional and dynamic on Chromium,
keep Chrome and Edge byte-identical, and keep Firefox's per-origin echo rules
(with `www` outranking the apex) free of wildcard/response-header conditions.

## Build store packages

```
./build-zips.sh
```

Produces one zip per variant under `dist/` (git-ignored), each containing the
variant's files with `manifest.json` at the zip root, ready for store upload.
