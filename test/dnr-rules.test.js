'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Extension declarativeNetRequest (DNR) rule invariants.
 *
 * The extension injects CORS response headers via declarativeNetRequest so the
 * ezyZip web app can fetch user-chosen archive URLs cross-origin. The rules are
 * deliberately narrow; these invariants lock in the constraints that keep them
 * safe:
 *
 * - Wildcard Access-Control-Allow-Origin must stay CONDITIONAL. On Chromium it
 *   is set to '*' only when the response carries no ACAO header of its own
 *   (excludedResponseHeaders), so credentialed third-party requests made from
 *   the host pages are never affected (a wildcard ACAO is invalid alongside
 *   credentials). Because some add-on store package validators use a schema
 *   that predates Chromium 128 and reject response-header conditions in a
 *   static rules.json, that rule is registered as a DYNAMIC rule from
 *   background.js; the static rules.json uses only validator-known condition
 *   properties.
 * - Firefox has no response-header conditions, so it ships exact per-origin
 *   ACAO echo rules instead (archives served behind a cross-origin redirect are
 *   a known limitation there).
 *
 * Common to every variant: rules are initiator-scoped and GET-only, never
 * modify Access-Control-Allow-Methods, and only append to
 * Access-Control-Expose-Headers (a 'set' would clobber headers the host page
 * already exposes).
 *
 * Run with:  node --test
 */

const repoRoot = path.resolve(__dirname, '..');

const CHROMIUM_VARIANTS = {
  chrome: 'ezyzip-extension',
  edge: 'ezyzip-extension-edge',
};

const FIREFOX_DIR = 'ezyzip-extension-firefox';

const PRODUCTION_ORIGINS = {
  'www.ezyzip.com': 'https://www.ezyzip.com',
  'ezyzip.com': 'https://ezyzip.com',
  'ezyzip.pro': 'https://ezyzip.pro',
};

function loadJson(variantDir, file) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, variantDir, file), 'utf8'));
}

function header(rule, name) {
  return (rule.action.responseHeaders ?? []).find((h) => h.header === name);
}

function commonInvariants(rules) {
  test('every modifyHeaders rule is initiator-scoped', () => {
    for (const rule of rules) {
      if (rule.action.type !== 'modifyHeaders') continue;
      assert.ok(rule.condition.initiatorDomains?.length > 0, `rule ${rule.id}`);
    }
  });

  test('no rule modifies access-control-allow-methods', () => {
    for (const rule of rules) {
      assert.strictEqual(header(rule, 'access-control-allow-methods'), undefined, `rule ${rule.id}`);
    }
  });

  test('expose-headers is appended, never set', () => {
    for (const rule of rules) {
      const aceh = header(rule, 'access-control-expose-headers');
      if (!aceh) continue;
      assert.strictEqual(aceh.operation, 'append', `rule ${rule.id}`);
      assert.ok(aceh.value.includes('Content-Disposition'));
      assert.ok(aceh.value.includes('Content-Length'));
    }
  });

  test('rules only match GET requests', () => {
    for (const rule of rules) {
      assert.deepStrictEqual(rule.condition.requestMethods, ['get'], `rule ${rule.id}`);
    }
  });

  test('rule ids unique, resourceTypes include xmlhttprequest', () => {
    const ids = rules.map((r) => r.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    for (const rule of rules) {
      assert.ok(rule.condition.resourceTypes.includes('xmlhttprequest'), `rule ${rule.id}`);
    }
  });
}

for (const [name, dir] of Object.entries(CHROMIUM_VARIANTS)) {
  describe(`${name} rules.json (conditional wildcard)`, () => {
    const rules = loadJson(dir, 'rules.json');

    commonInvariants(rules);

    test('static rules use only store-validator-known condition properties', () => {
      // Condition properties recognised by the add-on store package validators.
      // Their schema predates Chromium 128, so response-header conditions
      // (excludedResponseHeaders) are intentionally absent here and live in the
      // dynamic rule registered from background.js instead.
      const VALIDATOR_KNOWN = new Set([
        'domainType', 'domains', 'excludedDomains', 'excludedInitiatorDomains',
        'excludedRequestDomains', 'excludedRequestMethods', 'excludedResourceTypes',
        'excludedTabIds', 'initiatorDomains', 'isUrlFilterCaseSensitive',
        'regexFilter', 'requestDomains', 'requestMethods', 'resourceTypes',
        'tabIds', 'urlFilter',
      ]);
      for (const rule of rules) {
        for (const key of Object.keys(rule.condition)) {
          assert.ok(VALIDATOR_KNOWN.has(key), `rule ${rule.id}: condition.${key} would fail store validation`);
        }
      }
    });

    test('static rules never touch ACAO — that rule must be dynamic', () => {
      for (const rule of rules) {
        assert.strictEqual(header(rule, 'access-control-allow-origin'), undefined, `rule ${rule.id}`);
      }
    });

    test('background.js registers the conditional ACAO dynamic rule', () => {
      const bg = fs.readFileSync(path.join(repoRoot, dir, 'background.js'), 'utf8');
      assert.ok(bg.includes('updateDynamicRules'));
      assert.ok(bg.includes('excludedResponseHeaders'));
      assert.ok(bg.includes('access-control-allow-origin'));
      assert.match(bg, /requestMethods:\s*\['get'\]/);
      for (const domain of Object.keys(PRODUCTION_ORIGINS)) {
        assert.ok(bg.includes(`'${domain}'`), `${domain} in dynamic rule initiators`);
      }
      // The dynamic rule must stay wildcard-with-absent-ACAO, never an exact echo.
      assert.match(bg, /value:\s*'\*'/);
    });

    test('expose-headers rule is unconditional (works even when host sends own ACAO)', () => {
      const acehOnly = rules.find(
        (r) => header(r, 'access-control-expose-headers') && !r.condition.excludedResponseHeaders,
      );
      assert.ok(acehOnly, 'need an append-only expose-headers rule without response-header conditions');
    });

    test('production initiators covered', () => {
      for (const domain of Object.keys(PRODUCTION_ORIGINS)) {
        assert.ok(
          rules.every((r) => r.condition.initiatorDomains.includes(domain)),
          `${domain} in every rule's initiatorDomains`,
        );
      }
    });

    test('manifest requires Chromium 128+ (header conditions ignored in 121-127, unknown before)', () => {
      const manifest = loadJson(dir, 'manifest.json');
      assert.ok(parseInt(manifest.minimum_chrome_version, 10) >= 128);
    });
  });
}

describe('chrome vs edge rules', () => {
  test('rules.json and background.js byte-identical (both production-clean)', () => {
    for (const file of ['rules.json', 'background.js']) {
      const read = (dir) => fs.readFileSync(path.join(repoRoot, dir, file), 'utf8');
      assert.strictEqual(read(CHROMIUM_VARIANTS.chrome), read(CHROMIUM_VARIANTS.edge), file);
    }
    const chrome = loadJson(CHROMIUM_VARIANTS.chrome, 'rules.json');
    for (const rule of chrome) {
      assert.ok(!rule.condition.initiatorDomains.includes('localhost'), `rule ${rule.id}`);
    }
  });
});

describe('firefox rules.json (per-origin echo — no header conditions in FF)', () => {
  const rules = loadJson(FIREFOX_DIR, 'rules.json');

  commonInvariants(rules);

  test('no wildcard ACAO and no response-header conditions', () => {
    for (const rule of rules) {
      assert.notStrictEqual(header(rule, 'access-control-allow-origin')?.value, '*', `rule ${rule.id}`);
      assert.strictEqual(rule.condition.excludedResponseHeaders, undefined, `rule ${rule.id}: unsupported in Firefox`);
      assert.strictEqual(rule.condition.responseHeaders, undefined, `rule ${rule.id}: unsupported in Firefox`);
    }
  });

  test('rules echo the exact initiator origin', () => {
    for (const rule of rules) {
      const acao = header(rule, 'access-control-allow-origin');
      if (!acao) continue;
      assert.strictEqual(acao.operation, 'set', `rule ${rule.id}`);
      assert.strictEqual(rule.condition.initiatorDomains.length, 1, `rule ${rule.id}`);
      const domain = rule.condition.initiatorDomains[0];
      assert.strictEqual(acao.value, PRODUCTION_ORIGINS[domain], `rule ${rule.id}`);
    }
    const covered = rules
      .map((r) => header(r, 'access-control-allow-origin'))
      .filter(Boolean)
      .map((h) => h.value);
    assert.deepStrictEqual(covered.sort(), Object.values(PRODUCTION_ORIGINS).sort());
  });

  test('www rule outranks the apex rule (subdomain overlap)', () => {
    const www = rules.find((r) => r.condition.initiatorDomains?.join() === 'www.ezyzip.com');
    const apex = rules.find((r) => r.condition.initiatorDomains?.join() === 'ezyzip.com');
    assert.ok(www, 'dedicated www.ezyzip.com rule');
    assert.ok(apex, 'dedicated ezyzip.com apex rule');
    assert.ok(www.priority > apex.priority);
  });
});
