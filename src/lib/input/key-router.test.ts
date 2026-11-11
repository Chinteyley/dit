import { describe, expect, it } from 'vitest';
import { createKeyRouter, type KeyEventLike, type KeyHandler, type LearnerHook } from './key-router';
import { createFakeKeyTarget } from './test-support';

function recordingHandler(): KeyHandler & { readonly seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    keyDown: (e) => seen.push(`down:${e.code}`),
    keyUp: (e) => seen.push(`up:${e.code}`),
  };
}

function learner(consume: (e: KeyEventLike) => boolean): LearnerHook & { armed: boolean } {
  const hook = {
    armed: true,
    isArmed: () => hook.armed,
    offer: (e: KeyEventLike) => consume(e),
  };
  return hook;
}

describe('createKeyRouter', () => {
  it('adds the DOM listeners on the first handler and removes them after the last', () => {
    const target = createFakeKeyTarget();
    const router = createKeyRouter(target);
    expect(target.listenerCount()).toBe(0);
    const removeA = router.add(recordingHandler());
    const removeB = router.add(recordingHandler());
    expect(target.listenerCount()).toBe(1);
    removeA();
    removeA();
    expect(target.listenerCount()).toBe(1);
    removeB();
    expect(target.listenerCount()).toBe(0);
  });

  it('passes unconsumed events to every handler', () => {
    const target = createFakeKeyTarget();
    const router = createKeyRouter(target);
    const a = recordingHandler();
    const b = recordingHandler();
    router.add(a);
    router.add(b);
    target.down('Space');
    target.up('Space');
    expect(a.seen).toStrictEqual(['down:Space', 'up:Space']);
    expect(b.seen).toStrictEqual(['down:Space', 'up:Space']);
  });

  it('gives an armed learner the first look and swallows the consumed keydown and its late keyup', () => {
    const target = createFakeKeyTarget();
    const router = createKeyRouter(target);
    const handler = recordingHandler();
    router.add(handler);
    const hook = learner((e) => e.code === 'KeyJ');
    router.setLearner(hook);

    target.down('KeyJ');
    // The learner disarms before the keyup arrives (Req 5.5).
    hook.armed = false;
    router.setLearner(null);
    target.down('Space');
    target.up('KeyJ');
    target.up('Space');
    target.down('KeyJ');
    target.up('KeyJ');
    expect(handler.seen).toStrictEqual(['down:Space', 'up:Space', 'down:KeyJ', 'up:KeyJ']);
  });

  it('passes keydowns the learner declines to the handlers', () => {
    const target = createFakeKeyTarget();
    const router = createKeyRouter(target);
    const handler = recordingHandler();
    router.add(handler);
    router.setLearner(learner(() => false));
    target.down('Tab');
    target.up('Tab');
    expect(handler.seen).toStrictEqual(['down:Tab', 'up:Tab']);
  });

  it('listens while only an armed learner is registered', () => {
    const target = createFakeKeyTarget();
    const router = createKeyRouter(target);
    const hook = learner(() => true);
    router.setLearner(hook);
    expect(target.listenerCount()).toBe(1);
    router.setLearner(null);
    expect(target.listenerCount()).toBe(0);
  });

  it('forgets suppressed codes once it stops listening, so a later press is not swallowed', () => {
    const target = createFakeKeyTarget();
    const router = createKeyRouter(target);
    router.setLearner(learner(() => true));
    target.down('KeyJ');
    router.setLearner(null);

    const handler = recordingHandler();
    router.add(handler);
    target.down('KeyJ');
    target.up('KeyJ');
    expect(handler.seen).toStrictEqual(['down:KeyJ', 'up:KeyJ']);
  });

  it('a throwing handler does not stop the others', () => {
    const target = createFakeKeyTarget();
    const router = createKeyRouter(target);
    router.add({
      keyDown: () => {
        throw new Error('handler failure');
      },
      keyUp: () => undefined,
    });
    const handler = recordingHandler();
    router.add(handler);
    target.down('Enter');
    expect(handler.seen).toStrictEqual(['down:Enter']);
  });
});
