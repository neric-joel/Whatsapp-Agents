import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PROBLEMS,
  buildEvaluationPrompt,
  filterAgentsForStress,
  formatProblemReport,
  summarizeProblemResults,
  type AgentRunResult,
  type Problem,
} from './stress-test-agents.ts'

const problem: Problem = {
  cat: 'MATH',
  level: 'EASY',
  q: 'What is 15% of 240?',
}

const results: AgentRunResult[] = [
  {
    agentId: 'agent-1',
    agentName: 'Claude Thinker',
    status: 'completed',
    runCount: 1,
    completedRunCount: 1,
    failedRunCount: 0,
    timedOutRunCount: 0,
    roundsCompleted: 1,
    hallucinationFlagged: false,
    replyPreview: 'The answer is 36 because 10% is 24 and 5% is 12.',
  },
  {
    agentId: 'agent-2',
    agentName: 'Codex Builder',
    status: 'failed',
    runCount: 1,
    completedRunCount: 0,
    failedRunCount: 1,
    timedOutRunCount: 0,
    roundsCompleted: 0,
    hallucinationFlagged: true,
    replyPreview: null,
  },
]

describe('stress test report helpers', () => {
  it('filters stress agents by comma-separated slug list', () => {
    const agents = [
      { id: 'a1', name: 'Claude Thinker', slug: 'claude_thinker' },
      { id: 'a2', name: 'Reviewer', slug: 'reviewer' },
    ]

    assert.deepEqual(filterAgentsForStress(agents, 'reviewer'), [agents[1]])
  })

  it('contains the full five-domain, four-tier evaluation bank', () => {
    assert.equal(PROBLEMS.length, 20)
    assert.deepEqual([...new Set(PROBLEMS.map((problem) => problem.cat))].sort(), [
      'CODING',
      'LIFE',
      'MATH',
      'PHILOSOPHY',
      'PHYSICS',
    ])
    assert.deepEqual([...new Set(PROBLEMS.map((problem) => problem.level))].sort(), [
      'EASY',
      'EXTRA_HARD',
      'HARD',
      'MEDIUM',
    ])
  })

  it('builds an evaluation prompt with the strict three-phase protocol', () => {
    const prompt = buildEvaluationPrompt(problem)

    assert.match(prompt, /Phase 1: Individual Assessment/)
    assert.match(prompt, /Phase 2: Team Discussion/)
    assert.match(prompt, /Phase 3: Consensus & Conclusion/)
    assert.match(prompt, /What is 15% of 240\?/)
  })

  it('summarizes completed, failed, timed out, hallucination, and round totals', () => {
    const summary = summarizeProblemResults([
      ...results,
      {
        agentId: 'agent-3',
        agentName: 'Reviewer',
        status: 'timed_out',
        runCount: 1,
        completedRunCount: 0,
        failedRunCount: 0,
        timedOutRunCount: 1,
        roundsCompleted: 0,
        hallucinationFlagged: false,
        replyPreview: null,
      },
    ])

    assert.deepEqual(summary, {
      totalRuns: 3,
      completed: 1,
      failed: 1,
      timedOut: 1,
      hallucinationFlags: 1,
      totalRounds: 1,
    })
  })

  it('formats problem output with agent status and a 200 character reply preview', () => {
    const report = formatProblemReport(problem, results)

    assert.match(report, /\[MATH - EASY\] What is 15% of 240\?/)
    assert.match(report, /Claude Thinker: completed \| 1 round \| hallucination: false/)
    assert.match(report, /Codex Builder: failed \| 0 rounds \| hallucination: true/)
    assert.match(report, /Reply preview: "The answer is 36/)
  })
})
