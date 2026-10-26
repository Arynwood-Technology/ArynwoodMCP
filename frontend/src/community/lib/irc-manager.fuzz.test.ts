import { expect, it } from 'vitest'
import fc from 'fast-check'
import { named, stripIRC } from './irc-manager'

// Bounded property fuzzing runs in the normal suite; fast-check prints a replay seed/path
// and shrinks failures. Include prototype names explicitly alongside arbitrary Unicode keys.
const key = fc.oneof(fc.string({ maxLength: 256 }), fc.constantFrom('__proto__', 'constructor', 'toString', 'hasOwnProperty'))

it('fuzzes untrusted IRC names without exposing or mutating object prototypes', () => {
  fc.assert(fc.property(fc.array(fc.tuple(key, fc.string({ maxLength: 256 })), { maxLength: 50 }), entries => {
    const originalPrototype = Object.getPrototypeOf({})
    const record = named<string>()
    for (const [name, value] of entries) record[name] = value
    const copy = named(record)
    expect(Object.getPrototypeOf(copy)).toBeNull()
    expect(Object.getPrototypeOf({})).toBe(originalPrototype)
    expect(Object.entries(copy)).toEqual(Object.entries(record))
    for (const [name, value] of new Map(entries)) {
      expect(Object.hasOwn(copy, name)).toBe(true)
      expect(copy[name]).toBe(value)
    }
    copy.__proto__ = 'untrusted nickname'
    expect(Object.getPrototypeOf(copy)).toBeNull()
    expect(record.__proto__).toBe(new Map(entries).get('__proto__'))
  }), { numRuns: 2000 })
})

it('fuzzes IRC formatting removal across arbitrary messages', () => {
  fc.assert(fc.property(fc.string({ maxLength: 8192 }), text => {
    const result = stripIRC(text)
    expect(result.length).toBeLessThanOrEqual(text.length)
    // These formatting controls must not survive, even in truncated color sequences.
    for (const code of [2, 3, 15, 22, 29, 31]) expect(result.includes(String.fromCharCode(code))).toBe(false)
  }), { numRuns: 2000, examples: [['\u0003\u000302,99hostile\u000f']] })
})
