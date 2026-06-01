import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ABS_MAX_DISCUSSION_ROUNDS,
  buildCrossReviewPairs,
  buildDiscussionStagePrompt,
  detectChallenge,
  discussionStageNumber,
  nextDiscussionStage,
  parseTaskList,
  selectCoordinatorIndex,
  stageTarget,
} from '../src/discussion.js'

test('discuss DAG: plan→execute→integrate→(dissent if no challenge)→converge→null', () => {
  assert.deepEqual(nextDiscussionStage('discuss', 'plan', false), { phase: 'execute', target: 'all' })
  assert.deepEqual(nextDiscussionStage('discuss', 'execute', false), {
    phase: 'integrate',
    target: 'all',
  })
  // no challenge yet -> dissent
  assert.deepEqual(nextDiscussionStage('discuss', 'integrate', false), {
    phase: 'dissent',
    target: 'all',
  })
  // challenge present -> skip dissent, go to converge
  assert.deepEqual(nextDiscussionStage('discuss', 'integrate', true), {
    phase: 'converge',
    target: 'coordinator',
  })
  assert.deepEqual(nextDiscussionStage('discuss', 'dissent', false), {
    phase: 'converge',
    target: 'coordinator',
  })
  assert.equal(nextDiscussionStage('discuss', 'converge', true), null)
})

test('debate DAG: assign→argue→rebut→adjudicate→null, dissent never inserted', () => {
  assert.deepEqual(nextDiscussionStage('debate', 'assign', false), { phase: 'argue', target: 'all' })
  assert.deepEqual(nextDiscussionStage('debate', 'argue', false), { phase: 'rebut', target: 'all' })
  assert.deepEqual(nextDiscussionStage('debate', 'rebut', false), {
    phase: 'adjudicate',
    target: 'coordinator',
  })
  assert.equal(nextDiscussionStage('debate', 'adjudicate', false), null)
})

test('legacy phases still drain (back-compat)', () => {
  assert.deepEqual(nextDiscussionStage('discuss', 'individual', false), {
    phase: 'execute',
    target: 'all',
  })
  assert.equal(nextDiscussionStage('discuss', 'consensus', true), null)
})

test('stageTarget: only plan/assign/converge/adjudicate are coordinator phases', () => {
  for (const p of ['plan', 'assign', 'converge', 'adjudicate'] as const)
    assert.equal(stageTarget(p), 'coordinator')
  for (const p of ['execute', 'integrate', 'dissent', 'argue', 'rebut'] as const)
    assert.equal(stageTarget(p), 'all')
})

test('selectCoordinatorIndex: codex-first, then longest capabilities, then first', () => {
  assert.equal(
    selectCoordinatorIndex([
      { slug: 'planner', provider: 'mock', capabilities: 'a' },
      { slug: 'codex_builder', provider: 'codex_cli', capabilities: null },
    ]),
    1,
  )
  assert.equal(
    selectCoordinatorIndex([
      { slug: 'a', provider: 'mock', capabilities: 'short' },
      { slug: 'b', provider: 'mock', capabilities: 'a much longer capabilities blurb here' },
    ]),
    1,
  )
  assert.equal(selectCoordinatorIndex([{ slug: 'only', provider: 'mock' }]), 0)
  assert.equal(selectCoordinatorIndex([]), -1)
})

test('detectChallenge: substantive challenge vs rubber-stamp', () => {
  assert.equal(detectChallenge('I disagree with @planner — we should use a queue instead.'), true)
  assert.equal(detectChallenge('This misses the empty-input edge case; we need to add a guard.'), true)
  assert.equal(detectChallenge('Great work everyone, I fully agree with the plan.'), false)
  assert.equal(detectChallenge('Looks good to me.'), false)
  // a risk cue alone, without a proposed change or peer ref, is not enough
  assert.equal(detectChallenge('There is some risk.'), false)
})

test('parseTaskList: lines, fenced json, fallback, unknown-assignee drop, dedupe', () => {
  const roster = [
    { slug: 'planner', id: 'id-p' },
    { slug: 'coder', id: 'id-c' },
    { slug: 'reviewer', id: 'id-r' },
  ]
  const lines = parseTaskList(
    '1. @planner: design the API\n2. @coder - implement the handler\n@reviewer: write tests\n@ghost: nope',
    roster,
  )
  assert.equal(lines.length, 3)
  assert.deepEqual(
    lines.map((a) => a.agent_slug),
    ['planner', 'coder', 'reviewer'],
  )
  assert.equal(lines[0]?.agent_id, 'id-p')

  const json = parseTaskList(
    '```json\n[{"agent_slug":"coder","task":"build it"},{"slug":"planner","task":"plan it","position":"for"}]\n```',
    roster,
  )
  assert.equal(json.length, 2)
  assert.equal(json.find((a) => a.agent_slug === 'planner')?.position, 'for')

  // dedupe: same slug twice -> one assignment
  assert.equal(parseTaskList('@coder: a\n@coder: b', roster).length, 1)
  // nothing parseable -> empty (caller falls back)
  assert.deepEqual(parseTaskList('no assignments here', roster), [])
})

test('buildCrossReviewPairs: round-robin, each reviews exactly one peer', () => {
  const pairs = buildCrossReviewPairs(['a', 'b', 'c'])
  assert.deepEqual(pairs, [
    { reviewer_slug: 'a', reviewee_slug: 'b' },
    { reviewer_slug: 'b', reviewee_slug: 'c' },
    { reviewer_slug: 'c', reviewee_slug: 'a' },
  ])
  assert.deepEqual(buildCrossReviewPairs(['solo']), [])
})

test('buildDiscussionStagePrompt: discuss vs debate are genuinely different', () => {
  const dPlan = buildDiscussionStagePrompt('discuss', 'plan', 'X')
  assert.match(dPlan, /complementary sub-tasks/i)
  const bAssign = buildDiscussionStagePrompt('debate', 'assign', 'X')
  assert.match(bAssign, /distinct position/i)
  const dConv = buildDiscussionStagePrompt('discuss', 'converge', 'X')
  assert.match(dConv, /attribut/i)
  const bAdj = buildDiscussionStagePrompt('debate', 'adjudicate', 'X')
  assert.match(bAdj, /do not merge/i)
  // execute prompt embeds the blackboard
  const exec = buildDiscussionStagePrompt('discuss', 'execute', 'X', { blackboard: '- @coder: build' })
  assert.match(exec, /@coder: build/)
})

test('discussionStageNumber + ceilings sane', () => {
  assert.equal(discussionStageNumber('discuss', 'plan'), 1)
  assert.equal(discussionStageNumber('discuss', 'converge'), 5)
  assert.equal(discussionStageNumber('debate', 'adjudicate'), 4)
  assert.ok(ABS_MAX_DISCUSSION_ROUNDS >= 5)
})
