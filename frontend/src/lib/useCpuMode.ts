import { useAppStore } from '../store/useAppStore'

/** Whether CPU mode is on (backend/services/machine.py), from AppShell's status poll.
 *  False until the first status arrives, so nothing is marked off before we know. */
export const useCpuMode = () => useAppStore(s => s.status?.cpu_mode?.enabled ?? false)
