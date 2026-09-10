import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './useAppStore'

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState())
  })

  it('starts with no active server and empty collections', () => {
    const s = useAppStore.getState()
    expect(s.activeServer).toBeNull()
    expect(s.servers).toEqual([])
    expect(s.conversations).toEqual([])
  })

  it('setActiveModel updates activeModel', () => {
    useAppStore.getState().setActiveModel('llama3:8b')
    expect(useAppStore.getState().activeModel).toBe('llama3:8b')
  })

  it('setDashMsgs supports the functional-updater form', () => {
    useAppStore.getState().setDashMsgs([{ id: 1, role: 'user', text: 'hi' }])
    useAppStore.getState().setDashMsgs(prev => [...prev, { id: 2, role: 'assistant', text: 'hey' }])
    expect(useAppStore.getState().dashMsgs).toHaveLength(2)
  })
})
