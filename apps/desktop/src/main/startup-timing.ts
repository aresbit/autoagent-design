import { performance } from "node:perf_hooks";

/**
 * Startup timing for the Electron shell.
 *
 * Desktop launch is a chain of awaits — app.whenReady, the daemon auth
 * handshake, updater construction, window creation, the first loadURL — and
 * when a launch feels slow the only question worth answering is *which* link
 * cost the time. Marks are recorded in call order and `report` prints the gap
 * between each consecutive pair, so adding a step means adding one `mark` call
 * and nothing else.
 *
 * Timing must never be able to break a launch: every entry point swallows its
 * own errors.
 */
export function createStartupTimer(scope: string) {
  const marks: { label: string; at: number }[] = [];

  return {
    mark(label: string): void {
      try {
        marks.push({ label, at: performance.now() });
      } catch {
        // timing is diagnostic only
      }
    },
    report(): void {
      try {
        if (marks.length < 2) return;
        for (let i = 1; i < marks.length; i += 1) {
          const previous = marks[i - 1];
          const current = marks[i];
          console.log(
            `[auto-design ${scope}] startup timing — ${current.label}: ${Math.round(current.at - previous.at)}ms`,
          );
        }
        const total = marks[marks.length - 1].at - marks[0].at;
        console.log(`[auto-design ${scope}] startup timing — total: ${Math.round(total)}ms`);
        marks.length = 0;
      } catch {
        // timing is diagnostic only
      }
    },
  };
}
