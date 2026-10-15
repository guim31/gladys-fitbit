// -----------------------------------------------------------------------------
// Scene triggers (manifest `scene_triggers`, Gladys 5.1+).
//
// - `woke_up`: a night of sleep ended. Known only once the watch has synced
//   and Google has computed the night, so it fires at the first refresh after
//   that sync, with the wake-up time (not the time it was detected). The
//   state "Wake-up time" changes too, but a scene cannot react to "a text
//   changed": the event is the clean way to start a morning routine.
// - `step_goal_reached`: today's steps crossed the goal of the configuration
//   (Google Health exposes no goal of the Fitbit app). Once a day.
//
// What was announced is kept in /data: a restart never fires twice for the
// same night or the same day. The very first read after the installation
// only records the current situation: last night or a goal reached hours ago
// is not news.
// -----------------------------------------------------------------------------

import { sleepClock } from './device.js';

export const TRIGGERS = Object.freeze({
  WOKE_UP: 'woke_up',
  STEP_GOAL_REACHED: 'step_goal_reached',
});

// A night detected later than this after its end is history, not an awakening.
export const WAKE_FRESHNESS_MS = 12 * 60 * 60 * 1000;

/**
 * @param {object} options
 * @param {import('./store.js').Store} options.store
 * @param {() => number} [options.now]
 */
export function createEventDetector({ store, now = Date.now }) {
  return {
    /**
     * The events a new snapshot brings, already recorded as announced.
     * @param {import('./reader.js').Snapshot} snapshot
     * @param {{ stepGoal: number }} config
     * @returns {Promise<Array<{ key: string, data: object }>>}
     */
    async detect(snapshot, config) {
      const seen = (await store.get('events')) ?? {};
      const first = !seen.initialized;
      const next = { ...seen, initialized: true };
      const events = [];

      const { sleep, activity } = snapshot;
      if (sleep && sleep.id !== seen.sleepId) {
        next.sleepId = sleep.id;
        if (!first && now() - Date.parse(sleep.end) <= WAKE_FRESHNESS_MS) {
          events.push({
            key: TRIGGERS.WOKE_UP,
            data: {
              wake_time: sleepClock(sleep, 'end', snapshot.timeZone),
              bedtime: sleepClock(sleep, 'start', snapshot.timeZone),
              sleep_hours: Math.round((sleep.minutesAsleep / 60) * 100) / 100,
              efficiency: sleep.efficiency,
            },
          });
        }
      }

      if (activity && activity.steps >= config.stepGoal && seen.goalDate !== snapshot.date) {
        next.goalDate = snapshot.date;
        if (!first) {
          events.push({
            key: TRIGGERS.STEP_GOAL_REACHED,
            data: { steps: activity.steps, goal: config.stepGoal },
          });
        }
      }

      if (JSON.stringify(next) !== JSON.stringify(seen)) {
        await store.set('events', next);
      }
      return events;
    },
  };
}
