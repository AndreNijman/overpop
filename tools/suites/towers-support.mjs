import { assertFamily } from './_towerfamily.mjs'

export const name = 'towers-support'
export const needs = ['js/towers/support.js']

export function run (t, OP, env) {
  assertFamily(t, OP, 'support', { expect: 5 })
}
