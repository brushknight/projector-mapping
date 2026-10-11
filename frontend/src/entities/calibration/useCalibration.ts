import { useCallback, useEffect, useState } from 'react'
import { useChannel } from '../../shared/lib/useHub'
import type { Hub } from '../../shared/lib/ws'
import { calibrationApi } from './api'
import type { CalibProgress, Calibration } from './types'

/** A calibration run: start it, follow `calib:{id}`, read its quality when it ends. */
export function useCalibration(hub: Hub, setupId: string | null, existingId: string | null) {
  const [id, setId] = useState<string | null>(existingId)
  const [result, setResult] = useState<Calibration | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setId(existingId), [existingId])
  const progress = useChannel<CalibProgress>(hub, id ? `calib:${id}` : null).doc
  const failed = progress?.step === 'failed'
  const done = !!progress && !failed && (progress.step === 'done' || (progress.total > 0 && progress.done >= progress.total))
  useEffect(() => {
    if (!id) return
    if (done || failed || !progress) calibrationApi.get(id).then(setResult, () => {})
  }, [id, done, failed, progress])
  const start = useCallback(async () => {
    if (!setupId) return
    setError(null)
    setResult(null)
    try {
      const r = await calibrationApi.start(setupId)
      setId(r.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [setupId])
  return { id, progress, result, done, running: !!progress && !done && !failed, error: error ?? (failed ? progress?.message || 'The calibration failed.' : null), start }
}
