import { performance } from "node:perf_hooks";

/**
 * Startup timing for the packaged runtime.
 *
 * The packaged launch does strictly more than the dev shell — it reads its
 * config, prepares namespace-scoped paths, spawns the daemon and web sidecars
 * and waits for each to report a URL — so a slow cold start is almost always
 * one identifiable link in that chain. Marks are recorded in call order and
 * `report` prints the gap between each consecutive pair.
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
