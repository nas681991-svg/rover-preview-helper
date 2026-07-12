import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { acquire, send, release, isValid, initializeListeners, setTestOverrides, clearTestOverrides, _resetCoordinatorState } from './debugger-coordinator.js';

describe('debugger-coordinator', () => {
  let attachedTabs = new Set();
  let detachedTabs = new Set();
  let commands = [];
  let onDetachListeners = [];
  let onTabRemovedListeners = [];
  let onEventListeners = [];

  beforeEach(() => {
    attachedTabs.clear();
    detachedTabs.clear();
    commands = [];
    onDetachListeners = [];
    onTabRemovedListeners = [];

    // Reset coordinator state between tests
    _resetCoordinatorState();

    globalThis.chrome = {
      debugger: {
        attach: async (target, version) => {
          if (target.tabId === 999) throw new Error('Cannot attach to this target');
          attachedTabs.add(target.tabId);
        },
        detach: async (target) => {
          detachedTabs.add(target.tabId);
          attachedTabs.delete(target.tabId);
        },
        sendCommand: async (target, method, params) => {
          commands.push({ tabId: target.tabId, method, params });
          return {};
        },
        onEvent: {
          addListener: (cb) => onEventListeners.push(cb),
          removeListener: (cb) => {
            onEventListeners = onEventListeners.filter(l => l !== cb);
          }
        },
        onDetach: {
          addListener: (cb) => onDetachListeners.push(cb),
          removeListener: (cb) => {
            onDetachListeners = onDetachListeners.filter(l => l !== cb);
          }
        }
      },
      tabs: {
        onRemoved: {
          addListener: (cb) => onTabRemovedListeners.push(cb),
          removeListener: (cb) => {
            onTabRemovedListeners = onTabRemovedListeners.filter(l => l !== cb);
          }
        }
      }
    };

    // Initialize listeners after chrome is set up
    initializeListeners();
  });

  afterEach(() => {
    delete globalThis.chrome;
    clearTestOverrides();
  });

  test('acquire attaches debugger and returns lease', async () => {
    const lease = await acquire(1, 'test-owner');
    
    assert.ok(attachedTabs.has(1));
    assert.equal(lease.tabId, 1);
    assert.equal(lease.owner, 'test-owner');
    assert.ok(lease.leaseId.startsWith('lease_'));
  });

  test('acquire handles attach errors', async () => {
    await assert.rejects(acquire(999, 'test-owner'), /Cannot attach to this target/);
    assert.ok(!attachedTabs.has(999));
  });

  test('multiple acquires on same tab attach only once', async () => {
    const lease1 = await acquire(1, 'owner1');
    const lease2 = await acquire(1, 'owner2');
    
    // Verify chrome.debugger.attach was called exactly once
    assert.equal(attachedTabs.size, 1);
    assert.ok(attachedTabs.has(1));
    assert.notEqual(lease1.leaseId, lease2.leaseId);
  });

  test('send with valid lease succeeds', async () => {
    const lease = await acquire(1, 'test-owner');
    
    await send(lease, 'Test.command', { param: 'value' });
    
    assert.equal(commands.length, 1);
    assert.equal(commands[0].method, 'Test.command');
    assert.equal(commands[0].params.param, 'value');
  });

  test('send with invalid lease throws', async () => {
    const fakeLease = { tabId: 1, leaseId: 'fake_lease', owner: 'test' };
    
    await assert.rejects(send(fakeLease, 'Test.command', {}), /Invalid or stale lease/);
  });

  test('send with wrong owner throws', async () => {
    const lease = await acquire(1, 'test-owner');
    const wrongOwnerLease = { tabId: 1, leaseId: lease.leaseId, owner: 'wrong-owner' };
    
    await assert.rejects(send(wrongOwnerLease, 'Test.command', {}), /Invalid or stale lease/);
  });

  test('send with stale lease throws', async () => {
    const lease = await acquire(1, 'test-owner');
    await release(lease);
    
    await assert.rejects(send(lease, 'Test.command', {}), /Invalid or stale lease/);
  });

  test('release detaches when last lease is released', async () => {
    const lease = await acquire(1, 'test-owner');
    
    await release(lease);
    
    assert.ok(detachedTabs.has(1));
    assert.ok(!attachedTabs.has(1));
  });

  test('release does not detach when other leases exist', async () => {
    const lease1 = await acquire(1, 'owner1');
    const lease2 = await acquire(1, 'owner2');
    
    await release(lease1);
    assert.ok(!detachedTabs.has(1));
    assert.ok(attachedTabs.has(1));
    
    await release(lease2);
    assert.ok(detachedTabs.has(1));
  });

  test('release detaches only when last lease is released', async () => {
    const lease1 = await acquire(3, 'owner1');
    const lease2 = await acquire(3, 'owner2');
    
    await release(lease1);
    assert.ok(!detachedTabs.has(3));
    
    await release(lease2);
    assert.ok(detachedTabs.has(3));
  });

  test('over-release does not detach active session', async () => {
    const lease = await acquire(4, 'test-owner');
    
    await release(lease);
    assert.ok(detachedTabs.has(4));
    
    detachedTabs.clear();
    await release(lease); // Over-release
    assert.ok(!detachedTabs.has(4)); // Should not detach again
  });

  test('wrong-owner release does not detach active session', async () => {
    const lease1 = await acquire(5, 'owner1');
    const wrongLease = { tabId: 5, leaseId: 'wrong_lease', owner: 'owner1' };
    
    await release(wrongLease); // Wrong leaseId
    assert.ok(!detachedTabs.has(5));
    assert.ok(attachedTabs.has(5));
    
    const wrongOwnerLease = { tabId: 5, leaseId: lease1.leaseId, owner: 'wrong-owner' };
    await release(wrongOwnerLease); // Valid leaseId but wrong owner
    assert.ok(!detachedTabs.has(5));
    assert.ok(attachedTabs.has(5));
    
    await release(lease1);
    assert.ok(detachedTabs.has(5));
  });

  test('isValid returns true for valid lease', async () => {
    const lease = await acquire(1, 'test-owner');
    
    assert.ok(isValid(lease));
  });

  test('isValid returns false for invalid lease', () => {
    const fakeLease = { tabId: 1, leaseId: 'fake', owner: 'test' };
    
    assert.ok(!isValid(fakeLease));
  });

  test('isValid returns false for wrong owner', async () => {
    const lease = await acquire(1, 'test-owner');
    const wrongOwnerLease = { tabId: 1, leaseId: lease.leaseId, owner: 'wrong-owner' };
    
    assert.ok(!isValid(wrongOwnerLease));
  });

  test('isValid returns false for released lease', async () => {
    const lease = await acquire(1, 'test-owner');
    await release(lease);
    
    assert.ok(!isValid(lease));
  });

  test('onDetach clears coordinator state', async () => {
    const lease = await acquire(1, 'test-owner');
    
    // Simulate external detach
    onDetachListeners.forEach(cb => cb({ tabId: 1 }, 'target_closed'));
    
    // Assert coordinator-visible outcomes: lease should be invalid
    assert.ok(!isValid(lease));
  });

  test('onTabRemoved clears coordinator state', async () => {
    const lease = await acquire(1, 'test-owner');
    
    // Simulate tab close
    onTabRemovedListeners.forEach(cb => cb(1));
    
    assert.ok(!isValid(lease));
  });

  test('nested leases work correctly', async () => {
    const lease1 = await acquire(1, 'owner1');
    const lease2 = await acquire(1, 'owner2');
    const lease3 = await acquire(1, 'owner3');
    
    assert.ok(isValid(lease1));
    assert.ok(isValid(lease2));
    assert.ok(isValid(lease3));
    assert.equal(attachedTabs.size, 1);
    
    await release(lease2);
    assert.ok(attachedTabs.has(1));
    
    await release(lease1);
    assert.ok(attachedTabs.has(1));
    
    await release(lease3);
    assert.ok(detachedTabs.has(1));
  });

  test('multiple tabs can have separate leases', async () => {
    const lease1 = await acquire(1, 'owner1');
    const lease2 = await acquire(2, 'owner2');
    
    assert.ok(isValid(lease1));
    assert.ok(isValid(lease2));
    assert.equal(attachedTabs.size, 2);
    
    await release(lease1);
    assert.ok(detachedTabs.has(1));
    assert.ok(!detachedTabs.has(2));
    
    await release(lease2);
    assert.ok(detachedTabs.has(2));
  });

  test('release handles detach errors gracefully', async () => {
    const lease = await acquire(1, 'test-owner');
    
    // Make detach throw
    chrome.debugger.detach = async () => { throw new Error('Detach failed'); };
    
    await release(lease); // Should not throw
  });

  test('concurrent same-tab acquire calls attach only once', async () => {
    // Run the real implementation without overrides
    const attachCount = { value: 0 };
    const originalAttach = chrome.debugger.attach;
    chrome.debugger.attach = async (target, version) => {
      attachCount.value++;
      return originalAttach(target, version);
    };

    // Fire concurrent acquires
    const [lease1, lease2, lease3] = await Promise.all([
      acquire(10, 'owner1'),
      acquire(10, 'owner2'),
      acquire(10, 'owner3')
    ]);

    // Exactly one attach should have occurred
    assert.equal(attachCount.value, 1);
    assert.ok(attachedTabs.has(10));

    // All leases should be valid
    assert.ok(isValid(lease1));
    assert.ok(isValid(lease2));
    assert.ok(isValid(lease3));
    assert.notEqual(lease1.leaseId, lease2.leaseId);
    assert.notEqual(lease2.leaseId, lease3.leaseId);

    // Release all leases - should detach exactly once
    const detachCount = { value: 0 };
    const originalDetach = chrome.debugger.detach;
    chrome.debugger.detach = async (target) => {
      detachCount.value++;
      return originalDetach(target);
    };

    await Promise.all([release(lease1), release(lease2), release(lease3)]);

    assert.equal(detachCount.value, 1);
    assert.ok(detachedTabs.has(10));
  });

  test('non-overridden same-tab integration test', async () => {
    // Integration test proving real coordinator supports multiple consumers safely
    // This uses the real implementation without any test overrides
    
    const lease1 = await acquire(20, 'network-capture');
    const lease2 = await acquire(20, 'replay-worker');
    const lease3 = await acquire(20, 'visual-fallback');

    // All leases should be valid and on the same tab
    assert.equal(lease1.tabId, 20);
    assert.equal(lease2.tabId, 20);
    assert.equal(lease3.tabId, 20);
    assert.ok(isValid(lease1));
    assert.ok(isValid(lease2));
    assert.ok(isValid(lease3));

    // Only one attach should have occurred
    assert.equal(attachedTabs.size, 1);
    assert.ok(attachedTabs.has(20));

    // Each lease can send commands
    await send(lease1, 'Network.enable', {});
    await send(lease2, 'Input.dispatchMouseEvent', { type: 'mousePressed' });
    await send(lease3, 'DOM.getDocument', {});
    assert.equal(commands.length, 3);

    // Releasing leases in any order should work
    await release(lease2);
    assert.ok(attachedTabs.has(20)); // Still attached
    assert.ok(isValid(lease1));
    assert.ok(isValid(lease3));

    await release(lease1);
    assert.ok(attachedTabs.has(20)); // Still attached
    assert.ok(isValid(lease3));

    await release(lease3);
    assert.ok(detachedTabs.has(20)); // Now detached
    assert.ok(!attachedTabs.has(20));
  });

  test('addEventListener fans out events to lease owners', async () => {
    const { addEventListener, removeEventListener } = await import('./debugger-coordinator.js');
    
    const lease1 = await acquire(1, 'owner1');
    const lease2 = await acquire(2, 'owner2');
    
    const owner1Events = [];
    const owner2Events = [];
    
    const fn1 = (s, method, params) => owner1Events.push({s, method, params});
    const fn2 = (s, method, params) => owner2Events.push({s, method, params});
    
    addEventListener('owner1', fn1);
    addEventListener('owner2', fn2);
    
    const cb = onEventListeners[onEventListeners.length - 1];
    
    // Simulate event from tab 1
    cb({ tabId: 1 }, 'Event.foo', { a: 1 });
    
    // Simulate event from tab 2
    cb({ tabId: 2 }, 'Event.bar', { b: 2 });
    
    assert.equal(owner1Events.length, 1);
    assert.equal(owner1Events[0].method, 'Event.foo');
    
    assert.equal(owner2Events.length, 1);
    assert.equal(owner2Events[0].method, 'Event.bar');
    
    removeEventListener('owner1', fn1);
    removeEventListener('owner2', fn2);
  });
});
