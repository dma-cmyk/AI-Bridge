const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const noopEvent = { addListener() {} };
const context = vm.createContext({
  chrome: {
    action: { onClicked: noopEvent },
    contextMenus: { create() {}, onClicked: noopEvent },
    declarativeNetRequest: { updateDynamicRules: async () => {} },
    runtime: { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', onInstalled: noopEvent },
    sidePanel: { open: async () => {} },
    scripting: {},
    storage: {},
    tabs: {}
  },
  console
});

vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);

const captureInterval = vm.runInContext('CAPTURE_INTERVAL_MS', context);
const rule = JSON.parse(JSON.stringify(
  vm.runInContext("createAiFrameRule('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')", context)
));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const optionsSource = fs.readFileSync(path.join(root, 'options.js'), 'utf8');

assert.ok(captureInterval >= 500, 'captureVisibleTab must run at most twice per second');
assert.deepEqual(rule.condition.initiatorDomains, ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
assert.equal(rule.condition.urlFilter, undefined);
assert.equal(manifest.host_permissions.includes('<all_urls>'), false);
assert.equal(manifest.declarative_net_request, undefined);
assert.equal(fs.existsSync(path.join(root, 'rules.json')), false);
assert.match(optionsSource, /if \(isAiListUpdate\) settings\.customAiList = aiListText;/);
assert.match(optionsSource, /new URL\(url\)\.protocol === 'https:'/);

const expectedHosts = rule.condition.requestDomains.map(domain => `https://${domain}/*`).sort();
assert.deepEqual([...manifest.host_permissions].sort(), expectedHosts);

console.log('AI-Bridge smoke tests passed.');
