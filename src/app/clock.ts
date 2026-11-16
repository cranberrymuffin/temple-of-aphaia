// App clock. Real time by default; the test hook can switch it to a manual clock advanced by tick(ms).
export class AppClock {
  private manual = false
  private now = 0
  private last = performance.now()

  setManual(on: boolean) {
    this.manual = on
    this.last = performance.now()
  }

  get isManual() {
    return this.manual
  }

  /** Advances real time; returns the frame delta in ms (0 in manual mode). */
  frame(): number {
    if (this.manual) return 0
    const t = performance.now()
    const dt = t - this.last
    this.last = t
    this.now += dt
    return dt
  }

  /** Manual mode only: advance by ms. */
  tick(ms: number): number {
    this.now += ms
    return ms
  }

  get time() {
    return this.now
  }
}
