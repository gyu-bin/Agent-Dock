/**
 * Demo vs fixture project naming helpers.
 * Fixture/e2e projects stay on disk for tests but are hidden from MVP UI.
 */
export function isFixtureProjectName(name: string): boolean {
  const n = name.trim()
  return (
    /^F[123]\b/i.test(n) ||
    /\bF[123]\s+Test\b/i.test(n) ||
    /\bF[123]\s+Bug\b/i.test(n) ||
    /^W1\b/i.test(n) ||
    /^K1\b/i.test(n) ||
    /^O1\b/i.test(n) ||
    /^S1\b/i.test(n) ||
    /fixture/i.test(n) ||
    /e2e[-\s]/i.test(n)
  )
}

export function isDemoProjectName(name: string): boolean {
  return /steam arena/i.test(name) || /steam game/i.test(name)
}
