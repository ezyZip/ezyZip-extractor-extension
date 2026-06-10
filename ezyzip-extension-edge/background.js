/**
 * background.js — ezyZip extension service worker
 *
 * Creates the right-click context menu on links and opens a new ezyZip tab
 * when the user selects the menu item.
 *
 * Language is resolved in two steps:
 *   1. If the user has set a manual override in the popup, use that.
 *   2. Otherwise, auto-detect from chrome.i18n.getUILanguage() (the browser UI locale).
 * Falls back to English for any unsupported locale.
 *
 * Domain options (stored in chrome.storage.sync as 'domain'):
 *   free  → https://www.ezyzip.com/<lang-path>?url=<encoded>
 *   pro   → https://ezyzip.pro/<lang-path>?url=<encoded>
 *
 * Language override stored in chrome.storage.sync as 'lang' ('auto' or a lang key).
 *
 * Only the production domains above are targeted; any unrecognised stored
 * 'domain' value falls through to the DOMAIN_URLS.free default in the click
 * handler.
 */

const MENU_ID = 'extract-with-ezyzip';

// ── Language data ────────────────────────────────────────────────────────────

/** URL path per language on the production ezyZip domains. */
const LANG_PATHS = {
  en:      '/unzip-files-online.html',
  de:      '/dateien-online-entpacken.html',
  es:      '/descomprime-archivos-en-linea.html',
  fr:      '/decompresser-des-fichiers-en-ligne.html',
  id:      '/id-unzip.html',
  it:      '/decomprimi-i-file-online.html',
  ja:      '/jp-unzip.html',
  ko:      '/kr-unzip.html',
  pl:      '/pl-unzip.html',
  pt:      '/descompactar-ficheiros-zip-online.html',
  ru:      '/ru-unzip.html',
  tr:      '/tr-unzip.html',
  vi:      '/vi-unzip.html',
  'zh-CN': '/cn-unzip.html',
  'zh-TW': '/hk-unzip.html',
};

/** Context menu label per language (used for manual override — can't use chrome.i18n.getMessage
 *  here because that always follows the browser UI locale, not the stored override). */
const MENU_TITLES = {
  en:      'Extract with ezyZip',
  de:      'Mit ezyZip entpacken',
  es:      'Extraer con ezyZip',
  fr:      'Extraire avec ezyZip',
  id:      'Ekstrak dengan ezyZip',
  it:      'Estrai con ezyZip',
  ja:      'ezyZipで解凍',
  ko:      'ezyZip으로 압축 풀기',
  pl:      'Rozpakuj za pomocą ezyZip',
  pt:      'Extrair com ezyZip',
  ru:      'Распаковать с ezyZip',
  tr:      'ezyZip ile Aç',
  vi:      'Giải nén với ezyZip',
  'zh-CN': '使用 ezyZip 解压',
  'zh-TW': '使用 ezyZip 解壓縮',
};

const DEFAULT_LANG = 'en';

// ── Language resolution ──────────────────────────────────────────────────────

/**
 * Normalise chrome.i18n.getUILanguage() (BCP-47 tag) to one of LANG_PATHS' keys.
 * Falls back to DEFAULT_LANG for unsupported locales.
 */
function detectLang() {
  const raw = chrome.i18n.getUILanguage().toLowerCase(); // e.g. "en-us", "zh-cn", "zh-hant"
  if (raw.startsWith('zh-')) {
    // Simplified variants → zh-CN; Traditional variants (tw, hk, hant, mo) → zh-TW
    return (raw === 'zh-cn' || raw === 'zh-hans') ? 'zh-CN' : 'zh-TW';
  }
  const base = raw.split('-')[0]; // "en", "de", "pt", …
  return LANG_PATHS[base] ? base : DEFAULT_LANG;
}

/**
 * Resolve the effective language:
 *   - stored override ('lang' key in sync storage) wins if it's a valid key and not 'auto'
 *   - otherwise falls back to browser auto-detection via detectLang()
 */
async function resolveLang() {
  const { lang } = await chrome.storage.sync.get({ lang: 'auto' });
  return (lang && lang !== 'auto' && LANG_PATHS[lang]) ? lang : detectLang();
}

// ── URL builders ─────────────────────────────────────────────────────────────

const DOMAIN_URLS = {
  free: async (url) => {
    const path = LANG_PATHS[await resolveLang()];
    return `https://www.ezyzip.com${path}?url=${encodeURIComponent(url)}`;
  },
  pro: async (url) => {
    const path = LANG_PATHS[await resolveLang()];
    return `https://ezyzip.pro${path}?url=${encodeURIComponent(url)}`;
  },
};

// ── Context menu ─────────────────────────────────────────────────────────────

/**
 * (Re)create the context menu with the currently resolved language label.
 * Called on install, browser startup, and whenever the user changes the lang override.
 */
async function refreshMenu() {
  const lang = await resolveLang();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: MENU_TITLES[lang] ?? MENU_TITLES[DEFAULT_LANG],
      contexts: ['link'],
    });
  });
}

chrome.runtime.onInstalled.addListener(refreshMenu);
chrome.runtime.onStartup.addListener(refreshMenu);

// ── CORS rule (dynamic) ──────────────────────────────────────────────────────
//
// Sets Access-Control-Allow-Origin: * — but ONLY when the response carries no
// ACAO header at all (excludedResponseHeaders condition, Chromium 128+, gated
// by minimum_chrome_version in the manifest). Responses that already implement
// CORS are never touched, so credentialed third-party requests made from the
// host pages are unaffected (a wildcard ACAO is invalid alongside credentials).
// Archive hosts and tainted cross-origin-redirect hops (which require '*', since
// an exact-origin echo can never match Origin: null) get the header they need.
//
// This rule is registered DYNAMICALLY rather than shipped in rules.json because
// some add-on store package validators reject excludedResponseHeaders in static
// rule files (their schema predates Chromium 128) even though the browser
// supports it. Dynamic rules persist across browser restarts; the
// onInstalled/onStartup registration is idempotent (remove-then-add). The
// companion expose-headers rule stays in rules.json (validator-safe).

const CORS_RULE_ID = 1;

async function registerCorsRules() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [CORS_RULE_ID],
      addRules: [
        {
          id: CORS_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'access-control-allow-origin', operation: 'set', value: '*' },
            ],
          },
          condition: {
            initiatorDomains: ['www.ezyzip.com', 'ezyzip.com', 'ezyzip.pro'],
            resourceTypes: ['xmlhttprequest', 'other'],
            requestMethods: ['get'],
            excludedResponseHeaders: [{ header: 'access-control-allow-origin' }],
          },
        },
      ],
    });
  } catch (e) {
    console.error('ezyZip: failed to register CORS dynamic rule', e);
  }
}

chrome.runtime.onInstalled.addListener(registerCorsRules);
chrome.runtime.onStartup.addListener(registerCorsRules);

// Rebuild the menu live when the user changes the language override in the popup.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'lang' in changes) refreshMenu();
});

// ── Click handler ─────────────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID || !info.linkUrl) return;

  const { domain } = await chrome.storage.sync.get({ domain: 'free' });
  const build = DOMAIN_URLS[domain] ?? DOMAIN_URLS.free;
  chrome.tabs.create({ url: await build(info.linkUrl) });
});
