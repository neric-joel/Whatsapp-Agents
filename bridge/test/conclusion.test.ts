import assert from 'node:assert/strict'
import { test } from 'node:test'

import { conclusionDetected } from '../src/lib/conclusion.js'

test('detects an in conclusion phrase', () => {
  assert.equal(conclusionDetected('In conclusion, X'), true)
})

test('detects bracketed conclusion marker', () => {
  assert.equal(conclusionDetected('[CONCLUSION]'), true)
})

test('does not detect tentative reasoning as a conclusion', () => {
  assert.equal(conclusionDetected('I think X might be Y'), false)
})

test('does not detect plain agent reply text as a conclusion', () => {
  assert.equal(conclusionDetected('The next step is to compare the options and continue the discussion.'), false)
})
