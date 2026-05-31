/**
 * VirtualInput — shared directional and action flags written by the mobile
 * D-pad in HudScene and read by PlayerController each update tick.
 */

/** Live flags set by the on-screen D-pad. */
export const virtualInput = {
  left:   false,
  right:  false,
  up:     false,
  down:   false,
  /** True while the action button is held; PlayerController detects rising edge. */
  action: false,
}

/**
 * True when the viewport is narrower than 640 CSS px — the threshold used to
 * activate mobile controls and the compact HUD layout.
 */
export function isMobileDevice(): boolean {
  return window.innerWidth < 640
}
