/** Counts presented frames for telemetry: fps, dropped frames and the display refresh estimate. */
export class FrameMeter {
  private frames = 0
  private dropped = 0
  private last = 0
  private dts: number[] = []

  tick(now: number) {
    if (this.last) {
      const dt = now - this.last
      this.dts.push(dt)
      if (this.dts.length > 120) this.dts.shift()
      const expected = this.frameMs()
      if (dt > expected * 1.5) this.dropped += Math.max(1, Math.round(dt / expected) - 1)
    }
    this.last = now
    this.frames++
  }

  /** the median frame time, ms */
  frameMs(): number {
    if (!this.dts.length) return 1000 / 60
    const s = [...this.dts].sort((a, b) => a - b)
    return s[s.length >> 1]
  }

  /** the refresh rate snapped to a common value */
  refresh(): number {
    const hz = 1000 / this.frameMs()
    const common = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240]
    return common.reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a))
  }

  /** fps and dropped since the last take; resets the counters */
  take(seconds: number): { fps: number; dropped: number } {
    const out = { fps: Math.round(this.frames / seconds), dropped: this.dropped }
    this.frames = 0
    this.dropped = 0
    return out
  }
}
