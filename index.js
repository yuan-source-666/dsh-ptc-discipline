/**
 * PTC Discipline — a preset plugin that makes the goal + todo surface mandatory.
 *
 * The row mounts inside the preset's own scope, and a preset scope is an
 * ancestor of every agent joined to that preset, so the guard registered here
 * covers exactly those agents and nothing else.
 *
 * Every model tool call is refused until the session has both:
 *   - an `active` goal, and
 *   - a todo list with something `in_progress`.
 *
 * Exempt: the reserved `run_code` transport (denying it would make PTC
 * unusable), the bootstrap tools that create the discipline, and non-root
 * agents — `create_goal` requires a direct human turn on a runtime root, so a
 * subagent could never satisfy the rule and would deadlock.
 *
 * @module dsh-ptc-discipline
 */

/** Tools that may run before the discipline exists. */
const DEFAULT_BOOTSTRAP_TOOLS = [
  'create_goal',
  'get_goal',
  'update_goal',
  'todo_write',
  'ask_user_question',
  'skill',
  'present',
];

/** The reserved PTC transport; the model's only directly callable tool. */
const RUN_CODE = 'run_code';

/** Marker for "the goal service is not composed here, so do not enforce". */
const UNAVAILABLE = Symbol('unavailable');

const POLICY_SECTION = `## Discipline gate: goal + todo are mandatory

This agent runs under a monotonic gate. Every tool call is refused until two things exist in
this session's own log, and both must exist **before** the first real tool call:

1. **A goal** — \`create_goal\` with the concrete completion objective. Not a restatement of
   the request: state the end condition that makes the work verifiably done. The goal must be
   \`active\`; do not \`complete\` it while work remains, and do not leave it paused.
2. **A todo list** — \`todo_write\` with the complete task list, at least one item
   \`in_progress\`. Rewrite the whole list as work advances; mark items \`completed\` only when
   they are actually done.

The order is fixed: \`create_goal\` → \`todo_write\` → everything else. The todo list is cleared
at each new turn, so seed both again when a new request starts.

A refused call returns an error naming what is missing. Fix the discipline and retry; never
retry the same call unchanged and never work around the gate. A request that needs no tool
work at all can be answered directly — the gate only governs tool calls.

Seed the gate in one program before doing anything else:

\`\`\`ts
await tools.create_goal({ objective: "<the verifiable end condition>" });
await tools.todo_write({ todos: [
  { content: "<first concrete step>", status: "in_progress" },
  { content: "<later step>", status: "pending" },
] });
\`\`\`

Subagents are exempt (they cannot create a goal), so a delegated child starts working
immediately under the parent's goal.`;

/**
 * Normalize the row config.
 * @param raw - the Loader row's config value, or undefined.
 * @returns the effective policy.
 */
function resolveConfig(raw) {
  const config = raw ?? {};
  return {
    requireGoal: config.requireGoal !== false,
    requireTodo: config.requireTodo !== false,
    requireActiveTodo: config.requireActiveTodo !== false,
    bootstrapTools: Array.isArray(config.bootstrapTools)
      ? config.bootstrapTools.filter((name) => typeof name === 'string')
      : DEFAULT_BOOTSTRAP_TOOLS,
    sectionText: typeof config.sectionText === 'string' ? config.sectionText : POLICY_SECTION,
  };
}

/**
 * Read the agent's current goal phase.
 * @param ctx - the plugin context.
 * @param agent - the calling agent.
 * @returns the phase, UNAVAILABLE when the goal surface is absent, or undefined when no goal exists.
 */
function goalPhase(ctx, agent) {
  const goals = ctx.get('goals');
  if (goals === undefined) return UNAVAILABLE;
  try {
    return goals.get(agent)?.phase;
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Read the session's latest todo list.
 * @param ctx - the plugin context.
 * @param session - the calling session.
 * @returns the list (possibly empty), or UNAVAILABLE when the todo surface is absent.
 */
function todoList(ctx, session) {
  const projections = ctx.get('sessionProjections');
  if (projections === undefined) return UNAVAILABLE;
  try {
    const state = projections.stateOf(session, 'todos');
    return state ?? [];
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Whether the calling agent is a runtime root. Non-roots cannot create goals,
 * so enforcing the gate on them would deadlock every subagent.
 * @param ctx - the plugin context.
 * @param agent - the calling agent.
 * @returns true when the agent is a root, or when the registry is unavailable.
 */
function isRootAgent(ctx, agent) {
  const agents = ctx.get('agents');
  if (agents === undefined) return true;
  try {
    return agents.roots().includes(agent);
  } catch {
    return true;
  }
}

/**
 * Register the gate and its prompt section.
 * @param ctx - the preset-scoped Cordis context.
 * @param rawConfig - the Loader row config.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);

  ctx.inject(['systemPrompt', 'tools'], (scoped) => {
    let policyOrder = 850;
    try {
      policyOrder = scoped.systemPrompt.getSectionOrder('PTC_ONLY') + 50;
    } catch {
      /* keep the fallback order when the named slot is unknown */
    }

    scoped.systemPrompt.section({
      name: 'ptc-discipline:policy',
      order: policyOrder,
      text: config.sectionText,
      interpolate: false,
    });

    scoped.tools.guard((exec) => {
      // The PTC transport is the only way in; gating it would deadlock the program.
      if (exec.name === RUN_CODE) return undefined;
      const agent = exec.agent;
      if (agent === undefined) return undefined;
      if (config.bootstrapTools.includes(exec.name)) return undefined;
      if (!isRootAgent(scoped, agent)) return undefined;

      const missing = [];

      if (config.requireGoal) {
        const phase = goalPhase(scoped, agent);
        if (phase !== UNAVAILABLE) {
          if (phase === undefined) {
            missing.push('no goal (call create_goal with the verifiable end condition)');
          } else if (phase !== 'active') {
            missing.push(`goal is "${phase}" (resume it or create an active one before continuing)`);
          }
        }
      }

      if (config.requireTodo) {
        const todos = todoList(scoped, agent.session);
        if (todos !== UNAVAILABLE) {
          if (todos.length === 0) {
            missing.push('no todo list (call todo_write with the complete task list)');
          } else if (config.requireActiveTodo && !todos.some((item) => item.status === 'in_progress')) {
            missing.push(
              todos.every((item) => item.status === 'completed')
                ? 'every todo is completed (add the next concrete step and mark it in_progress)'
                : 'no todo is in_progress (mark the task you are about to do)',
            );
          }
        }
      }

      if (missing.length === 0) return undefined;

      return `Discipline gate: ${missing.join('; ')}. Seed it from inside run_code first — create_goal, then todo_write, then call "${exec.name}".`;
    });
  });
}
