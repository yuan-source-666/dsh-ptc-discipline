import assert from 'node:assert/strict';
import { apply } from '../index.js';

/**
 * Minimal fake Cordis context that records what the plugin registers.
 * @param {object} opts - simulated session state.
 * @returns {{ctx: object, state: object, agent: object}} the harness.
 */
function makeCtx({ phase = undefined, todos = null, root = true, services = true } = {}) {
  const state = { guard: null, sections: [], injected: [] };
  const agent = { id: 'session-x', session: { id: 'session-x' } };

  const get = (name) => {
    if (!services) return undefined;
    if (name === 'goals') return { get: () => (phase === undefined ? undefined : { phase }) };
    if (name === 'sessionProjections') return { stateOf: (_s, k) => (k === 'todos' ? todos : undefined) };
    if (name === 'agents') return { roots: () => (root ? [agent] : []) };
    return undefined;
  };

  const ctx = {
    get,
    inject(deps, fn) {
      state.injected.push(deps);
      fn({
        get,
        systemPrompt: {
          getSectionOrder: () => 800,
          section(s) { state.sections.push(s); },
        },
        tools: { guard(fn2) { state.guard = fn2; } },
      });
    },
  };

  return { ctx, state, agent };
}

/**
 * Assert the verdict of one tool call.
 * @param {object} opts - simulated session state.
 * @param {Record<string, boolean>} expected - tool name to "allowed".
 */
function scenario(label, opts, expected) {
  const { ctx, state, agent } = makeCtx(opts);
  apply(ctx, {});
  for (const [name, allowed] of Object.entries(expected)) {
    const reason = state.guard({ name, agent });
    const got = reason === undefined;
    assert.equal(got, allowed, `[${label}] ${name}: expected ${allowed ? 'ALLOW' : 'DENY'}, got ${got ? 'ALLOW' : 'DENY'} — ${reason}`);
  }
  console.log(`ok  ${label}`);
}

scenario('empty session (nothing seeded)', {}, {
  write: false, bash: false,
  create_goal: true, get_goal: true, update_goal: true, todo_write: true,
  run_code: true, ask_user_question: true, skill: true, present: true,
});

scenario('goal active, no todos', { phase: 'active', todos: null }, { write: false, todo_write: true });

scenario('goal active, todos all pending', { phase: 'active', todos: [{ content: 'a', status: 'pending' }] }, { write: false });

scenario('goal active, one in progress', { phase: 'active', todos: [{ content: 'a', status: 'in_progress' }] }, { write: true, bash: true });

scenario('all todos completed', { phase: 'active', todos: [{ content: 'a', status: 'completed' }] }, { write: false });

scenario('goal paused', { phase: 'paused', todos: [{ content: 'a', status: 'in_progress' }] }, { write: false });

scenario('goal complete', { phase: 'complete', todos: [{ content: 'a', status: 'in_progress' }] }, { write: false });

scenario('subagent (non-root)', { phase: undefined, todos: null, root: false }, { write: true, bash: true });

scenario('goal/todo services absent (fail open)', { services: false }, { write: true });

{
  const { ctx, state } = makeCtx();
  apply(ctx, {});
  const sec = state.sections[0];
  assert.equal(sec.name, 'ptc-discipline:policy');
  assert.equal(sec.interpolate, false);
  assert.deepEqual(state.injected[0], ['systemPrompt', 'tools']);
  console.log('ok  prompt section');
}

console.log('\nall scenarios passed');
