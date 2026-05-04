// Shared frame interval for render throttling and animations (~30fps).
// 16ms (60fps) keeps the event loop busy and wastes CPU for a TUI.
export const FRAME_INTERVAL_MS = 33
