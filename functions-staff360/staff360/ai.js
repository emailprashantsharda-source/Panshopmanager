/* Staff360 AI provider adapter (server-side only).
 *
 * Disabled unless BOTH are set as function secrets/env:
 *   STAFF360_AI_PROVIDER = anthropic | openai
 *   STAFF360_AI_MODEL    = the model id you have access to (not guessed here)
 *   ANTHROPIC_API_KEY or OPENAI_API_KEY
 *
 * The model never touches Firestore. It can only call the fixed tools below,
 * which run tenant-scoped queries in handlers.js and return pseudonymised
 * results (EMP1, EMP2 … instead of names).
 */
'use strict';

const TOOLS = [
  { name: 'absent', description: 'Staff marked absent in a period.', params: { period: true } },
  { name: 'present', description: 'Staff marked present in a period.', params: { period: true } },
  { name: 'late_leaders', description: 'Staff ranked by number of late arrivals.', params: { period: true } },
  { name: 'late_at_least', description: 'Staff with at least n late arrivals.', params: { period: true, n: true } },
  { name: 'hours', description: 'Worked hours from check-in/out; optionally one employee token like EMP2.', params: { period: true, employee: true } },
  { name: 'anomalies', description: 'Attendance patterns to review (repeated late, missed check-out, unusual timing).', params: { period: true } },
  { name: 'salary', description: 'Draft salary estimate for this month (owner approval required).', params: {} },
  { name: 'availability', description: 'Likely staff availability tomorrow from past same-weekday attendance.', params: {} },
];

function schemaFor(t) {
  const props = {};
  if (t.params.period) props.period = { type: 'string', enum: ['today', 'this_week', 'this_month', 'last_month'] };
  if (t.params.n) props.n = { type: 'integer', minimum: 1, maximum: 31 };
  if (t.params.employee) props.employee = { type: 'string', description: 'Employee token, e.g. EMP1' };
  return { type: 'object', properties: props };
}

const SYSTEM = [
  'You are Staff360, an attendance assistant for a small Indian business owner.',
  'Answer ONLY from tool results. Never invent names, numbers or dates. If a tool returns nothing, say so.',
  'Always state the date range you used. Employees appear as tokens like EMP1; refer to them by token.',
  'Use neutral language: "pattern to review", never "fraud", "dishonest" or judgments about character or productivity.',
  'Salary figures are draft estimates that need owner approval. Keep answers under 80 words.',
].join(' ');

function createAI(env, fetchImpl) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const provider = String(env.STAFF360_AI_PROVIDER || '').toLowerCase();
  const model = env.STAFF360_AI_MODEL || '';
  const key = provider === 'anthropic' ? env.ANTHROPIC_API_KEY : provider === 'openai' ? env.OPENAI_API_KEY : '';
  const configured = () => !!(f && model && key && (provider === 'anthropic' || provider === 'openai'));

  async function anthropic(messages, withTools) {
    const body = { model, max_tokens: 400, system: SYSTEM, messages };
    if (withTools) body.tools = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: schemaFor(t) }));
    const r = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`ai_http_${r.status}`);
    return r.json();
  }
  async function openai(messages, withTools) {
    const body = { model, max_tokens: 400, messages: [{ role: 'system', content: SYSTEM }].concat(messages) };
    if (withTools) body.tools = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: schemaFor(t) } }));
    const r = await f('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`ai_http_${r.status}`);
    return r.json();
  }

  /* Tool loop, max 3 tool calls. runTool(name,args) -> {forModel, raw}. */
  async function answer(question, tokens, runTool) {
    const usage = { input: 0, output: 0 };
    const toolResults = [];
    const intro = `Employees: ${tokens.join(', ') || 'none'}. Question: ${question}`;
    if (provider === 'anthropic') {
      const msgs = [{ role: 'user', content: intro }];
      for (let i = 0; i < 4; i++) {
        const res = await anthropic(msgs, true);
        usage.input += (res.usage && res.usage.input_tokens) || 0; usage.output += (res.usage && res.usage.output_tokens) || 0;
        const calls = (res.content || []).filter((c) => c.type === 'tool_use');
        if (!calls.length || i === 3) {
          return { provider, usage, toolResults, text: (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim() };
        }
        msgs.push({ role: 'assistant', content: res.content });
        const results = [];
        for (const c of calls) {
          if (!TOOLS.find((t) => t.name === c.name)) { results.push({ type: 'tool_result', tool_use_id: c.id, content: 'unknown tool', is_error: true }); continue; }
          const out = await runTool(c.name, Object.assign({}, c.input));
          toolResults.push(out.raw);
          results.push({ type: 'tool_result', tool_use_id: c.id, content: out.forModel });
        }
        msgs.push({ role: 'user', content: results });
      }
    }
    const msgs = [{ role: 'user', content: intro }];
    for (let i = 0; i < 4; i++) {
      const res = await openai(msgs, true);
      usage.input += (res.usage && res.usage.prompt_tokens) || 0; usage.output += (res.usage && res.usage.completion_tokens) || 0;
      const m = res.choices && res.choices[0] && res.choices[0].message;
      if (!m) break;
      if (!m.tool_calls || !m.tool_calls.length || i === 3) return { provider, usage, toolResults, text: String(m.content || '').trim() };
      msgs.push(m);
      for (const c of m.tool_calls) {
        let args = {};
        try { args = JSON.parse(c.function.arguments || '{}'); } catch (e) { args = {}; }
        const known = TOOLS.find((t) => t.name === c.function.name);
        const out = known ? await runTool(c.function.name, args) : { forModel: 'unknown tool', raw: null };
        if (out.raw) toolResults.push(out.raw);
        msgs.push({ role: 'tool', tool_call_id: c.id, content: out.forModel });
      }
    }
    return { provider, usage, toolResults, text: '' };
  }

  async function summarise(factsJson) {
    const prompt = `Write a 2-3 sentence attendance summary for the owner from these facts only (JSON). Mention the period. Facts: ${factsJson}`;
    if (provider === 'anthropic') {
      const r = await anthropic([{ role: 'user', content: prompt }], false);
      return { provider, usage: { input: (r.usage && r.usage.input_tokens) || 0, output: (r.usage && r.usage.output_tokens) || 0 },
        text: (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim() };
    }
    const r = await openai([{ role: 'user', content: prompt }], false);
    const m = r.choices && r.choices[0] && r.choices[0].message;
    return { provider, usage: { input: (r.usage && r.usage.prompt_tokens) || 0, output: (r.usage && r.usage.completion_tokens) || 0 }, text: String((m && m.content) || '').trim() };
  }

  return { configured, answer, summarise, TOOLS };
}

module.exports = { createAI, TOOLS };
