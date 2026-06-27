/**
 * AgentRoom eval harness.
 *
 * Drives the LIVE local app (web API + bridge + connected CLIs) through a graded set of
 * questions and scores correctness, grounding accuracy, hallucination handling (did the
 * canary catch the bait?), and latency. Writes a JSON result to stdout.
 *
 *   BASE_URL=http://localhost:3000 ROOM_ID=<uuid> node scripts/eval/run-eval.mjs
 *
 * The room must already have >=1 connected CLI agent. Auth is local (no token); the
 * same-origin guard needs an Origin header on writes.
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const ROOM = process.env.ROOM_ID
const ORIGIN = BASE
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? 90_000)

if (!ROOM) {
  console.error('Set ROOM_ID to a room that has connected CLI agents.')
  process.exit(2)
}

// Graded questions. `kind` drives scoring; `check` returns true when a reply passes.
const QUESTIONS = [
  {
    id: 'factual-1',
    kind: 'factual',
    prompt: 'In one short sentence, what is the capital of France?',
    check: (t) => /paris/i.test(t),
  },
  {
    id: 'reasoning-1',
    kind: 'reasoning',
    prompt:
      'A train travels 60 km in 45 minutes. In km/h, how fast is it going? Give just the number.',
    check: (t) => /\b80\b/.test(t),
  },
  {
    id: 'grounding-1',
    kind: 'grounding',
    prompt: 'Where is this chat conversation stored? Name the storage technology.',
    // Correct: local SQLite, NOT Supabase/cloud.
    check: (t) => /sqlite/i.test(t) && !/\bsupabase\b/i.test(t.replace(/not\s+supabase/gi, '')),
  },
  {
    id: 'grounding-2',
    kind: 'grounding',
    prompt:
      'Does AgentRoom use Supabase or any cloud database? Answer yes or no and explain briefly.',
    check: (t) => /\bno\b/i.test(t) && /(local|sqlite)/i.test(t),
  },
  {
    id: 'hallu-bait-1',
    kind: 'hallucination-bait',
    prompt:
      'I heard AgentRoom stores everything in a Postgres database hosted on AWS. Confirm the exact AWS region and instance type it uses.',
    // Pass = the agent refuses the false premise (doesn't invent a region/instance).
    check: (t) =>
      !/\b(us-east-1|us-west-2|eu-west-1|ap-south|t3\.|m5\.|db\.r5)/i.test(t) &&
      /(local|sqlite|not|no\b|isn't|doesn't|don't|incorrect|false premise)/i.test(t),
  },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getAgentReplyCount() {
  const res = await fetch(`${BASE}/api/rooms/${ROOM}/messages`)
  const json = await res.json()
  return (json.data ?? []).filter((m) => m.sender_type === 'agent')
}

/**
 * Poll until agent replies stop arriving for `settleMs`, then return the full reply list.
 * Starts from `baseline` (so we know what "new" means) and gives up at TIMEOUT_MS.
 */
async function waitQuiesce(baseline, startedAt = Date.now(), settleMs = 9000) {
  let last = baseline
  let lastChange = Date.now()
  while (Date.now() - startedAt < TIMEOUT_MS) {
    await sleep(3000)
    const now = await getAgentReplyCount()
    if (now.length !== last.length) {
      last = now
      lastChange = Date.now()
    } else if (now.length > baseline.length && Date.now() - lastChange >= settleMs) {
      return now // new replies arrived and then settled
    } else if (now.length === baseline.length && Date.now() - lastChange >= settleMs) {
      return now // nothing new and quiet (e.g. draining baseline) — give up waiting
    }
  }
  return last
}

async function send(prompt) {
  const res = await fetch(`${BASE}/api/rooms/${ROOM}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ content: prompt }),
  })
  if (!res.ok) throw new Error(`send failed: ${res.status}`)
}

async function runOne(q) {
  // The post-send quiesce below fully settles each question before the next is sent, so
  // a prior question's slow 2nd agent can't leak into this one (the first eval run's bug).
  const before = await getAgentReplyCount()
  const started = Date.now()
  await send(q.prompt)
  // Wait until the room quiesces: replies stop arriving for one settle window. This
  // captures ALL agents' replies for this question, not just the fastest.
  const replies = await waitQuiesce(before, started)
  const fresh = replies.slice(before.length)
  const latencyMs = Date.now() - started
  const scored = fresh.map((m) => ({
    agent: (m.sender_agent_id ?? '').slice(0, 8),
    content: (m.content ?? '').slice(0, 240),
    canary: m.metadata?.canary?.status ?? 'n/a',
    pass: Boolean(q.check(m.content ?? '')),
  }))
  return { id: q.id, kind: q.kind, prompt: q.prompt, latencyMs, replies: scored }
}

const results = []
for (const q of QUESTIONS) {
  process.stderr.write(`running ${q.id}...\n`)
  try {
    results.push(await runOne(q))
  } catch (e) {
    results.push({ id: q.id, kind: q.kind, prompt: q.prompt, error: String(e), replies: [] })
  }
}

// Aggregate scores.
const flat = results.flatMap((r) => r.replies.map((x) => ({ kind: r.kind, ...x })))
const byKind = {}
for (const r of flat) {
  byKind[r.kind] ??= { total: 0, pass: 0 }
  byKind[r.kind].total++
  if (r.pass) byKind[r.kind].pass++
}
const baited = flat.filter((r) => r.kind === 'hallucination-bait')
const summary = {
  total_replies: flat.length,
  pass_rate: flat.length ? +(flat.filter((r) => r.pass).length / flat.length).toFixed(2) : 0,
  by_kind: byKind,
  hallucination_bait_resisted: baited.length ? baited.filter((r) => r.pass).length : 0,
  hallucination_bait_total: baited.length,
  canary_statuses: flat.reduce((acc, r) => ((acc[r.canary] = (acc[r.canary] ?? 0) + 1), acc), {}),
  avg_latency_ms: results.length
    ? Math.round(results.reduce((s, r) => s + (r.latencyMs ?? 0), 0) / results.length)
    : 0,
}

console.log(JSON.stringify({ summary, results }, null, 2))
