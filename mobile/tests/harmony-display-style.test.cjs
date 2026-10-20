const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const test = require('node:test');

const sourceRoot = path.join(__dirname, '../harmony/entry/src/main/ets');
const moduleScope = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(sourceRoot, 'web/DisplayStyle.ets'), 'utf8')
  .replace(/\bexport /g, ''), { mode: 'strip' }) + '\nthis.script = HARMONY_DISPLAY_STYLE_SCRIPT;', moduleScope);
const script = new vm.Script(moduleScope.script);

function page({ mobile = true, frame = false, sheet = true, failAt = -1 } = {}) {
  const classes = new Set(mobile ? ['bridge-mobile'] : []);
  const rules = ['existing gateway rule'];
  const stylesheet = { href: 'https://gateway.example/style.css', cssRules: rules,
    insertRule(rule, index) { if (index === failAt) throw Error('Unsupported CSS'); rules.splice(index, 0, rule); },
    deleteRule(index) { rules.splice(index, 1); } };
  const context = vm.createContext({ URL, location: { origin: 'https://gateway.example' },
    document: { documentElement: { classList: { contains: value => classes.has(value), add: value => classes.add(value) } },
      styleSheets: sheet ? [{ href: 'https://external.example/style.css' }, stylesheet] : [] } });
  context.window = context; context.top = frame ? {} : context;
  return { context, classes, rules };
}

test('display refinement stays inert outside the top-level Harmony mobile document', () => {
  for (const options of [{ mobile: false }, { frame: true }, { sheet: false }]) {
    const state = page(options); script.runInContext(state.context);
    assert.equal(state.classes.has('bridge-harmony-display'), false);
    assert.deepEqual(state.rules, ['existing gateway rule']);
  }
});

test('display refinement reuses the same-origin sheet once and preserves list topology', () => {
  const state = page(); script.runInContext(state.context);
  assert.equal(state.classes.has('bridge-harmony-display'), true);
  assert.ok(state.rules.length > 1);
  const count = state.rules.length; script.runInContext(state.context);
  assert.equal(state.rules.length, count);
  for (const rule of state.rules.slice(1)) {
    assert.ok(rule.includes('.bridge-harmony-display'), 'every rule is scoped to the host class');
    assert.doesNotMatch(rule, /grid-(?:template|column|row)|border-left|box-shadow|\.message|\.login/);
  }
});

test('unsupported CSS leaves no partial appearance or active marker', () => {
  const state = page({ failAt: 4 }); script.runInContext(state.context);
  assert.deepEqual(state.rules, ['existing gateway rule']);
  assert.equal(state.classes.has('bridge-harmony-display'), false);
});

const index = fs.readFileSync(path.join(sourceRoot, 'pages/Index.ets'), 'utf8');
const method = index.match(/  private openGatewayControl\(id: string\): void \{[\s\S]*?\n  \}/);
assert.ok(method, 'load the production menu action');
vm.runInContext(stripTypeScriptTypes('class MenuAction {\n' + method[0] + '\n}\nthis.MenuAction = MenuAction;', { mode: 'strip' }), moduleScope);

function runMenu(id, { control, providerAccounts, sharedRelay = false } = {}) {
  let clicks = 0, accountCalls = 0;
  const alerts = [];
  const target = control === undefined ? { hidden: true, click() { clicks++; } } : control;
  const context = vm.createContext({ document: { getElementById: value => value === id ? target : null },
    BridgeSharedRelay: sharedRelay, alert: message => alerts.push(message),
    BridgeNavigation: providerAccounts ? { accounts() { accountCalls++; } } : undefined });
  context.window = context;
  const action = new moduleScope.MenuAction();
  action.L = zh => zh;
  action.webAction = value => vm.runInContext(value, context);
  action.openGatewayControl(id);
  return { clicks, accountCalls, alerts };
}

test('native menu invokes original controls even when their shortcut is hidden', () => {
  for (const id of ['accounts-button', 'pushplus-settings', 'clients-button']) {
    const result = runMenu(id);
    assert.equal(result.clicks, 1); assert.equal(result.alerts.length, 0);
  }
  const result = runMenu('accounts-button', { providerAccounts: true });
  assert.equal(result.accountCalls, 1); assert.equal(result.clicks, 0);
});

test('native menu explains unavailable controls and unsupported shared-relay alerts', () => {
  for (const control of [null, { disabled: true, click() { throw Error('disabled'); } }]) {
    const result = runMenu('clients-button', { control });
    assert.equal(result.clicks, 0); assert.equal(result.alerts.length, 1);
    assert.match(result.alerts[0], /刷新页面/);
  }
  const result = runMenu('pushplus-settings', { sharedRelay: true });
  assert.equal(result.clicks, 0); assert.match(result.alerts[0], /共享中继/);
});
