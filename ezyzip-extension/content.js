/**
 * content.js — ezyZip extension detection marker
 *
 * Runs at document_start on ezyZip origins so the page can detect whether
 * the extension is installed before Vue mounts. Two mechanisms:
 *
 * 1. Meta tag: synchronous DOM check via
 *    document.querySelector('meta[name="ezyzip-extension"][content="installed"]')
 *
 * 2. Ping/pong events: async fallback covering the rare race where Vue mounts
 *    before the content script's DOM write is visible.
 */

// Inject the detection marker meta tag
const marker = document.createElement('meta');
marker.name = 'ezyzip-extension';
marker.content = 'installed';
(document.head || document.documentElement).appendChild(marker);

// Respond to async extension-ping events from the page
window.addEventListener('ezyzip-extension-ping', () => {
  window.dispatchEvent(new CustomEvent('ezyzip-extension-pong'));
});
