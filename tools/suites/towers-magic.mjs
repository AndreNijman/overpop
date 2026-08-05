import { assertFamily } from './_towerfamily.mjs'

export const name = 'towers-magic'
export const needs = ['js/towers/magic.js']

export function run (t, OP, env) {
  assertFamily(t, OP, 'magic', { expect: 6 })
}
