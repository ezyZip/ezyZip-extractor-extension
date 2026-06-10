/**
 * popup.js — ezyZip extension settings popup
 *
 * Manages two persisted settings in chrome.storage.sync:
 *   domain  — which ezyZip site to open links on ('free' | 'pro')
 *   lang    — language override ('auto' = browser auto-detect, or a BCP-47 key)
 *
 * Changes are persisted immediately. background.js listens on chrome.storage.onChanged
 * and rebuilds the context menu title whenever 'lang' changes, so the new label is
 * visible the next time the user right-clicks — no browser restart needed.
 *
 * Localization
 * ------------
 * The popup UI strings live in UI_STRINGS below — a hand-rolled map keyed by lang code
 * (same shape as MENU_TITLES in background.js). We can't use chrome.i18n.getMessage()
 * here because that always follows the browser UI locale, but we want the popup to
 * reflect the user's dropdown override immediately on change.
 */

const DEFAULT_DOMAIN = 'free';
const DEFAULT_LANG = 'auto';

// ── UI string translations ───────────────────────────────────────────────────
//
// Keys must match the data-i18n attribute values in popup.html.
// Add a new language: add a key here AND add an <option> to popup.html's
// language <select>, AND update LANG_PATHS / MENU_TITLES in background.js.

const UI_STRINGS = {
  en:      { openLinks: 'Open links with…',           free: 'Free',      pro: 'Pro', language: 'Language',   autoDetect: 'Auto-detect (browser language)' },
  de:      { openLinks: 'Links öffnen mit…',          free: 'Kostenlos', pro: 'Pro', language: 'Sprache',    autoDetect: 'Automatisch erkennen (Browsersprache)' },
  es:      { openLinks: 'Abrir enlaces con…',         free: 'Gratis',    pro: 'Pro', language: 'Idioma',     autoDetect: 'Detección automática (idioma del navegador)' },
  fr:      { openLinks: 'Ouvrir les liens avec…',     free: 'Gratuit',   pro: 'Pro', language: 'Langue',     autoDetect: 'Détection automatique (langue du navigateur)' },
  id:      { openLinks: 'Buka tautan dengan…',        free: 'Gratis',    pro: 'Pro', language: 'Bahasa',     autoDetect: 'Deteksi otomatis (bahasa peramban)' },
  it:      { openLinks: 'Apri i link con…',           free: 'Gratis',    pro: 'Pro', language: 'Lingua',     autoDetect: 'Rilevamento automatico (lingua del browser)' },
  ja:      { openLinks: 'リンクを開く…',                free: '無料',       pro: 'Pro', language: '言語',        autoDetect: '自動検出（ブラウザの言語）' },
  ko:      { openLinks: '링크 열기…',                   free: '무료',       pro: 'Pro', language: '언어',        autoDetect: '자동 감지 (브라우저 언어)' },
  pl:      { openLinks: 'Otwórz linki w…',            free: 'Darmowy',   pro: 'Pro', language: 'Język',      autoDetect: 'Autowykrywanie (język przeglądarki)' },
  pt:      { openLinks: 'Abrir links com…',           free: 'Grátis',    pro: 'Pro', language: 'Idioma',     autoDetect: 'Detecção automática (idioma do navegador)' },
  ru:      { openLinks: 'Открывать ссылки в…',        free: 'Бесплатно', pro: 'Pro', language: 'Язык',       autoDetect: 'Автоопределение (язык браузера)' },
  tr:      { openLinks: 'Bağlantıları şununla aç…',   free: 'Ücretsiz',  pro: 'Pro', language: 'Dil',        autoDetect: 'Otomatik algıla (tarayıcı dili)' },
  vi:      { openLinks: 'Mở liên kết bằng…',          free: 'Miễn phí',  pro: 'Pro', language: 'Ngôn ngữ',   autoDetect: 'Tự động (ngôn ngữ trình duyệt)' },
  'zh-CN': { openLinks: '使用以下方式打开链接…',          free: '免费',       pro: 'Pro', language: '语言',        autoDetect: '自动检测（浏览器语言）' },
  'zh-TW': { openLinks: '使用以下方式開啟連結…',          free: '免費',       pro: 'Pro', language: '語言',        autoDetect: '自動偵測（瀏覽器語言）' },
};

// ── Language resolution (mirrors background.js) ──────────────────────────────

/** Normalise chrome.i18n.getUILanguage() to one of UI_STRINGS' keys. */
function detectLang() {
  const raw = chrome.i18n.getUILanguage().toLowerCase(); // e.g. "en-us", "zh-cn", "zh-hant"
  if (raw.startsWith('zh-')) {
    return (raw === 'zh-cn' || raw === 'zh-hans') ? 'zh-CN' : 'zh-TW';
  }
  const base = raw.split('-')[0];
  return UI_STRINGS[base] ? base : 'en';
}

/** Effective lang: stored override wins unless 'auto' or invalid. */
function resolveLang(stored) {
  return (stored && stored !== 'auto' && UI_STRINGS[stored]) ? stored : detectLang();
}

/** Apply UI strings for the given (already-resolved) lang to all [data-i18n] elements. */
function applyTranslations(lang) {
  const strings = UI_STRINGS[lang] ?? UI_STRINGS.en;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const value = strings[el.dataset.i18n];
    if (value) el.textContent = value;
  }
  document.documentElement.lang = lang;
}

// ── Wire-up ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const radios = document.querySelectorAll('input[name="domain"]');
  const langSelect = document.getElementById('lang');

  // Read saved settings, pre-select controls, and translate the UI.
  chrome.storage.sync.get({ domain: DEFAULT_DOMAIN, lang: DEFAULT_LANG }, ({ domain, lang }) => {
    for (const radio of radios) {
      radio.checked = radio.value === domain;
    }
    langSelect.value = lang;
    applyTranslations(resolveLang(lang));
  });

  // Persist domain selection on change.
  for (const radio of radios) {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        chrome.storage.sync.set({ domain: radio.value });
      }
    });
  }

  // Persist language selection on change AND re-translate the popup live.
  // (background.js's chrome.storage.onChanged listener rebuilds the menu title.)
  langSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ lang: langSelect.value });
    applyTranslations(resolveLang(langSelect.value));
  });
});
