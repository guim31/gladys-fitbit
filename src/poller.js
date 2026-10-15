// -----------------------------------------------------------------------------
// The container's own refresh timer.
//
// The device is published with `should_poll: true` and a valid
// `poll_frequency`, but the core cannot be trusted to call onPoll: Gladys
// 5.2.x skips devices created without `should_poll`, and a device keeps the
// polling fields it was created with (GladysAssistant/Gladys#3198). So the
// container refreshes by itself, at the configured pace, and the core's
// onPoll (once a minute) stays as a fallback that only reads Google when the
// timer has not done it for 90 % of a period.
//
// The account is read even before the device is added to Gladys: the scene
// triggers and the dashboard widget live on the same reading.
// -----------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {(options: { force: boolean }) => Promise<void>} options.refresh one reading, errors handled inside
 * @param {() => number} options.periodMs
 * @param {boolean} [options.timers] run the periodic timer (tests may turn it off)
 * @param {() => number} [options.now]
 */
export function createPoller({ gladys, refresh, periodMs, timers = true, now = Date.now }) {
  let lastAt = -Infinity;
  let running = null;
  let timer = null;
  let stopped = false;

  /** One reading, never two at once: a second caller shares the first. */
  function run({ force = false } = {}) {
    if (running) {
      return running;
    }
    lastAt = now();
    running = (async () => {
      try {
        await refresh({ force });
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      try {
        if (gladys.connected !== false) {
          await run();
        }
      } finally {
        schedule();
      }
    }, periodMs());
  }

  return {
    /** (Re)start: read now, then every period. */
    async restart() {
      stopped = false;
      schedule();
      await run({ force: true });
    },

    /** Read now (an action, a new connection), the timer keeps its pace. */
    async now() {
      await run({ force: true });
    },

    /** The core's onPoll: read only if the timer has stalled. */
    async fromCore() {
      if (now() - lastAt < periodMs() * 0.9) {
        return false;
      }
      await run();
      return true;
    },

    /** Resolves once the reading in progress, if any, is over. */
    async idle() {
      await running;
    },

    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
  };
}
