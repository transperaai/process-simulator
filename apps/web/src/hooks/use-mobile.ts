import { useSyncExternalStore } from "react"

// Below this width the sidebar is an off-canvas sheet. 1024 (not 768) keeps the map usable on tablets.
const QUERY = "(max-width: 1023px)"

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
