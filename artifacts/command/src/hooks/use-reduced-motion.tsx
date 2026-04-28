import * as React from "react"

/**
 * Tracks the user's OS-level `prefers-reduced-motion` setting and stays in
 * sync if it changes mid-session. Returns `false` during SSR / before mount
 * so the initial render matches the typical "animation on" default.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = React.useState<boolean>(false)

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)")
    const onChange = () => setPrefersReduced(mql.matches)
    setPrefersReduced(mql.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return prefersReduced
}
