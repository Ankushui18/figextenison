'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'extension');
const source = fs.readFileSync(path.join(root, 'js/capture-stability.js'), 'utf8');

function harness() {
  const context = vm.createContext({ Set, Object, Error });
  vm.runInContext(source, context);
  return { context, api: context.PageCaptureStability };
}

function animation(state = 'running', time = 125) {
  return {
    playState: state, currentTime: time, calls: [],
    pause() { this.calls.push('pause'); this.playState = 'paused'; },
    play() { this.calls.push('play'); this.playState = 'running'; }
  };
}

function documentWith(animations, elements = []) {
  return {
    nodeType: 9,
    querySelectorAll: () => elements,
    getAnimations: () => animations
  };
}

test('Running transitions and infinite animations freeze at their capture-start frame and resume once', () => {
  const { api } = harness();
  const transition = animation('running', 40), infinite = animation('running', 900);
  const paused = animation('paused', 20), finished = animation('finished', 100), idle = animation('idle', null);
  const session = api.pause(documentWith([transition, infinite, paused, finished, idle]));
  assert.equal(session.count, 2);
  assert.equal(transition.playState, 'paused');
  assert.equal(infinite.playState, 'paused');
  assert.equal(transition.currentTime, 40);
  assert.equal(infinite.currentTime, 900);
  assert.deepEqual(paused.calls, []);
  assert.deepEqual(finished.calls, []);
  assert.deepEqual(idle.calls, []);

  transition.currentTime = 999;
  session.restore(); session.restore();
  assert.equal(transition.currentTime, 40);
  assert.equal(infinite.currentTime, 900);
  assert.deepEqual(transition.calls, ['pause', 'play']);
  assert.deepEqual(infinite.calls, ['pause', 'play']);
});

test('Nested open shadow roots are included without duplicate pauses and adopted stylesheets are untouched', () => {
  const { api } = harness();
  const light = animation(), shadowAnimation = animation(), nestedAnimation = animation();
  const adopted = [{ name: 'existing-adopted-sheet' }];
  const nestedRoot = { querySelectorAll: () => [], getAnimations: () => [nestedAnimation], adoptedStyleSheets: adopted };
  const nestedHost = { shadowRoot: nestedRoot };
  const shadowRoot = {
    querySelectorAll: () => [nestedHost],
    getAnimations: () => [shadowAnimation, shadowAnimation]
  };
  const host = { shadowRoot: shadowRoot };
  const document = documentWith([light, shadowAnimation], [host]);
  const session = api.pause(document);
  assert.equal(session.count, 3);
  assert.deepEqual(shadowAnimation.calls, ['pause']);
  assert.deepEqual(nestedAnimation.calls, ['pause']);
  assert.equal(nestedRoot.adoptedStyleSheets, adopted);
  session.restore();
  assert.equal(nestedRoot.adoptedStyleSheets, adopted);
});

test('A page-originated cancel or play during capture is not undone by restoration', () => {
  const { api } = harness();
  const canceled = animation(), replayed = animation();
  const session = api.pause(documentWith([canceled, replayed]));
  canceled.playState = 'idle'; canceled.currentTime = null;
  replayed.playState = 'running'; replayed.currentTime = 800;
  session.restore();
  assert.deepEqual(canceled.calls, ['pause']);
  assert.deepEqual(replayed.calls, ['pause']);
  assert.equal(replayed.currentTime, 800);
});

test('Pause and restore failures are isolated so capture and remaining rollback can continue', () => {
  const { api } = harness();
  const unsupported = animation();
  unsupported.pause = function() { this.calls.push('pause-failed'); throw new Error('unsupported'); };
  const seekFailure = animation();
  Object.defineProperty(seekFailure, 'currentTime', {
    get() { return 50; }, set() { throw new Error('seek failed'); }
  });
  const restoreFailure = animation();
  restoreFailure.play = function() { this.calls.push('play-failed'); throw new Error('detached'); };
  const last = animation();
  const session = api.pause(documentWith([unsupported, seekFailure, restoreFailure, last]));
  assert.equal(session.count, 3);
  assert.deepEqual(unsupported.calls, ['pause-failed']);
  assert.doesNotThrow(() => session.restore());
  assert.deepEqual(restoreFailure.calls, ['pause', 'play-failed']);
  assert.deepEqual(last.calls, ['pause', 'play']);
});

test('Missing roots and failing animation APIs degrade to a safe no-op', () => {
  const { api } = harness();
  assert.equal(api.pause(null).count, 0);
  const broken = {
    nodeType: 9,
    querySelectorAll() { throw new Error('detached root'); },
    getAnimations() { throw new Error('unsupported root'); }
  };
  const session = api.pause(broken);
  assert.equal(session.count, 0);
  assert.doesNotThrow(() => session.restore());
  assert.equal(api.pause(documentWith(null)).count, 0);
  assert.equal(api.pause(documentWith(42)).count, 0);
});

test('The serializer owns rollback with try/finally and yields inside its single DOM traversal', () => {
  const toolbar = fs.readFileSync(path.join(root, 'js/h2d_toolbar.js'), 'utf8');
  assert.match(toolbar, /PageCaptureStability\?\.pause\(e\);try\{/);
  assert.match(toolbar, /finally\{captureStability\?\.restore\(\)\}/);
  assert.match(toolbar, /visited%200===0/);
  assert.match(toolbar, /onProgress\?\.\(\{phase:"layout",visited\}\)/);
  assert.doesNotMatch(toolbar, /dryRun/i);
  assert.equal(toolbar.split('let u=await async function(e,t,options)').length - 1, 1);
});
