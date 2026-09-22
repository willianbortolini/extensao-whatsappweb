import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/media-viewer-guard.js', import.meta.url), 'utf8');

function setup() {
  const events = [];
  let update;

  class FakeElement {
    constructor({ parent = null, width = 100, height = 100, position = 'static', role = '', testId = '', kind = '' } = {}) {
      this.parentElement = parent;
      this.width = width;
      this.height = height;
      this.position = position;
      this.kind = kind;
      this.attrs = new Map([['role', role], ['data-testid', testId]]);
      this.children = [];
      if (parent) parent.children.push(this);
    }
    getAttribute(name) { return this.attrs.get(name) || null; }
    hasAttribute(name) { return this.attrs.has(name) && Boolean(this.attrs.get(name)); }
    getBoundingClientRect() { return { width: this.width, height: this.height }; }
    contains(node) {
      for (let current = node; current; current = current.parentElement) if (current === this) return true;
      return false;
    }
    closest(selector) {
      if (selector.includes('#main .message-in')) {
        for (let current = this; current; current = current.parentElement) {
          if (current.kind === 'bubble') return current;
        }
        return null;
      }
      if (selector === '#wai-sidebar') {
        for (let current = this; current; current = current.parentElement) {
          if (current.kind === 'sidebar') return current;
        }
        return null;
      }
      return null;
    }
    querySelector(selector) {
      if (selector === 'footer') return this.descendant(node => node.kind === 'footer');
      if (selector.includes('video, canvas, iframe')) return this.descendant(node => ['video', 'canvas', 'iframe'].includes(node.kind));
      if (selector === 'img') return this.descendant(node => node.kind === 'img');
      return null;
    }
    descendant(predicate) {
      for (const child of this.children) {
        if (predicate(child)) return child;
        const nested = child.descendant(predicate);
        if (nested) return nested;
      }
      return null;
    }
  }

  const body = new FakeElement({ kind: 'body', width: 1200, height: 900 });
  const main = new FakeElement({ parent: body, kind: 'main', width: 1100, height: 900 });
  const conversation = new FakeElement({
    parent: main, testId: 'media-container', position: 'absolute', width: 950, height: 850
  });
  new FakeElement({ parent: conversation, kind: 'footer' });
  const bubble = new FakeElement({ parent: conversation, kind: 'bubble' });
  const sticker = new FakeElement({ parent: bubble, kind: 'img', width: 300, height: 300 });
  const groupsMedia = [sticker];
  const explicit = [conversation];
  const classes = new Set();

  body.classList = {
    contains: name => classes.has(name),
    toggle(name, enabled) {
      if (enabled) classes.add(name);
      else classes.delete(name);
    }
  };

  const document = {
    body,
    readyState: 'complete',
    querySelector(selector) { return selector === '#main' ? main : null; },
    querySelectorAll(selector) {
      if (selector === 'video,canvas,iframe,embed,object,img') return groupsMedia;
      return explicit;
    },
    dispatchEvent(event) { events.push(event); },
    addEventListener() {}
  };

  class FakeMutationObserver {
    constructor(callback) { update = callback; }
    observe() {}
  }

  const sandbox = vm.createContext({
    document, Element: FakeElement, MutationObserver: FakeMutationObserver,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    getComputedStyle: node => ({
      display: 'block', visibility: 'visible', opacity: '1', position: node.position
    }),
    innerWidth: 1200, innerHeight: 900,
    requestAnimationFrame: callback => callback(),
    addEventListener() {},
    setTimeout
  });

  vm.runInContext(source, sandbox);

  return {
    body, explicit, groupsMedia, events, main, sticker,
    trigger: () => update?.(),
    element: options => new FakeElement(options),
    open: () => classes.has('wai-media-viewer-open')
  };
}

test('figurinhas e wrappers de mídia de um grupo não escondem a sidebar', () => {
  const fixture = setup();
  assert.equal(fixture.open(), false);
  fixture.trigger();
  assert.equal(fixture.open(), false);
  assert.equal(fixture.events.length, 0);
});

test('visualizador verdadeiro esconde a sidebar e ao fechar a mostra novamente', () => {
  const fixture = setup();
  const viewer = fixture.element({
    parent: fixture.body, role: 'dialog', position: 'fixed', width: 1000, height: 850
  });
  const image = fixture.element({ parent: viewer, kind: 'img', width: 600, height: 600 });
  fixture.explicit.push(viewer);
  fixture.groupsMedia.push(image);

  fixture.trigger();
  assert.equal(fixture.open(), true);
  assert.equal(fixture.events.at(-1).detail.open, true);

  fixture.explicit.pop();
  fixture.groupsMedia.pop();
  fixture.trigger();
  assert.equal(fixture.open(), false);
  assert.equal(fixture.events.at(-1).detail.open, false);
});

test('foto aberta num visualizador fixo sem role=dialog continua detectada', () => {
  const fixture = setup();
  const viewer = fixture.element({
    parent: fixture.body, position: 'fixed', width: 1000, height: 850
  });
  fixture.groupsMedia.push(fixture.element({ parent: viewer, kind: 'img', width: 600, height: 600 }));
  fixture.trigger();
  assert.equal(fixture.open(), true);
});
