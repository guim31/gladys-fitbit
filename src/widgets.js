// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `health_summary`.
//
// The use case: a glance on the wall tablet in the morning — how the night
// went, how far the day's steps are from the goal, the resting heart rate,
// and whether the watch still syncs (a flat battery or an old sync explains
// figures that do not move).
//
// Budget (8 components, 6 tiles, 1 status): three tiles (steps, sleep,
// resting heart rate) and one status list. The figures are values, not bound
// to device features: the widget works before the device is added to Gladys.
// Read only: no button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { sleepClock } from './device.js';
import { formatDateTime, formatDecimal, formatInteger, pick } from './i18n.js';

export const WIDGET_KEY = 'health_summary';

// Past this, the watch has not synced for long: the figures are stale.
export const STALE_SYNC_MS = 24 * 60 * 60 * 1000;
// Under this, the battery is worth a warning colour.
const LOW_BATTERY = 20;

export const TEXT = {
  steps: { en: 'Steps', fr: 'Pas', de: 'Schritte', es: 'Pasos' },
  sleep: { en: 'Sleep', fr: 'Sommeil', de: 'Schlaf', es: 'Sueño' },
  heart: { en: 'Resting HR', fr: 'FC au repos', de: 'Ruhepuls', es: 'FC en reposo' },
  goal: { en: 'Step goal', fr: 'Objectif de pas', de: 'Schrittziel', es: 'Objetivo de pasos' },
  night: { en: 'Last night', fr: 'Nuit dernière', de: 'Letzte Nacht', es: 'Anoche' },
  efficiency: {
    en: 'Sleep efficiency',
    fr: 'Efficacité du sommeil',
    de: 'Schlafeffizienz',
    es: 'Eficiencia del sueño',
  },
  watch: { en: 'Watch', fr: 'Montre', de: 'Uhr', es: 'Reloj' },
  sync: {
    en: 'Last sync',
    fr: 'Dernière synchro',
    de: 'Letzte Synchronisierung',
    es: 'Última sincronización',
  },
  noData: { en: 'No data', fr: 'Aucune donnée', de: 'Keine Daten', es: 'Sin datos' },
  // Short problem lines (a status value holds 40 characters).
  setup: {
    en: 'To be set up',
    fr: 'À configurer',
    de: 'Noch einzurichten',
    es: 'Por configurar',
  },
  reconnect: {
    en: 'Connect the account again',
    fr: 'Reconnectez le compte',
    de: 'Verbinde das Konto erneut',
    es: 'Vuelva a conectar la cuenta',
  },
  unreachable: {
    en: 'Unreachable, last figures',
    fr: 'Injoignable, derniers chiffres',
    de: 'Nicht erreichbar, letzte Werte',
    es: 'Inaccesible, últimas cifras',
  },
  waiting: {
    en: 'Waiting for the first reading of the Google account…',
    fr: 'En attente de la première lecture du compte Google…',
    de: 'Warte auf die erste Abfrage des Google-Kontos…',
    es: 'Esperando la primera lectura de la cuenta de Google…',
  },
};

const unit = { bpm: { en: 'bpm', fr: 'bpm', de: 'bpm', es: 'ppm' }, hours: 'h' };

/**
 * @param {object} options
 * @param {import('./reader.js').Snapshot|null} options.snapshot the last reading
 * @param {'setup'|'reconnect'|'unreachable'|null} options.problem why Google cannot be read now
 * @param {object|null} [options.detail] the long status text, shown when there is no figure at all
 * @param {{ stepGoal: number }} options.config
 * @param {string} options.language the language of the dashboard user
 * @param {number} [options.now]
 */
export function buildHealthContent({
  snapshot,
  problem = null,
  detail = null,
  config,
  language,
  now = Date.now(),
}) {
  const t = (text) => pick(text, language);
  if (!snapshot) {
    return {
      ttl_seconds: 60,
      components: [{ type: 'text', variant: 'body', text: t(detail ?? TEXT.waiting) }],
    };
  }

  const { activity, sleep, tracker } = snapshot;
  const steps = activity?.steps ?? null;
  const reached = steps !== null && steps >= config.stepGoal;
  const components = [
    {
      type: 'value',
      label: t(TEXT.steps),
      icon: 'activity',
      value: steps ?? '–',
      ...(reached ? { color: WIDGET_COLORS.SUCCESS } : {}),
    },
    {
      type: 'value',
      label: t(TEXT.sleep),
      icon: 'moon',
      value: sleep ? formatDecimal(sleep.minutesAsleep / 60, language) : '–',
      unit: unit.hours,
    },
    {
      type: 'value',
      label: t(TEXT.heart),
      icon: 'heart',
      value: typeof snapshot.restingHeartRate === 'number' ? snapshot.restingHeartRate : '–',
      unit: t(unit.bpm),
    },
  ];

  const items = [];
  if (steps !== null) {
    const percent = Math.round((steps / config.stepGoal) * 100);
    items.push({
      label: t(TEXT.goal),
      value: `${formatInteger(steps, language)} / ${formatInteger(config.stepGoal, language)} (${percent} %)`,
      icon: reached ? 'check-circle' : 'target',
      color: reached ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (sleep) {
    items.push({
      label: t(TEXT.night),
      value: `${sleepClock(sleep, 'start', snapshot.timeZone)} → ${sleepClock(sleep, 'end', snapshot.timeZone)}`,
      icon: 'moon',
      color: WIDGET_COLORS.INFO,
    });
    if (sleep.efficiency !== null) {
      items.push({
        label: t(TEXT.efficiency),
        value: `${sleep.efficiency} %`,
        icon: 'bar-chart-2',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
  }
  if (tracker) {
    if (tracker.battery !== null) {
      items.push({
        label: t(TEXT.watch),
        value: tracker.model ? `${tracker.model} · ${tracker.battery} %` : `${tracker.battery} %`,
        icon: 'battery',
        color: tracker.battery <= LOW_BATTERY ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
      });
    }
    if (tracker.lastSync) {
      const stale = now - Date.parse(tracker.lastSync) > STALE_SYNC_MS;
      items.push({
        label: t(TEXT.sync),
        value: formatDateTime(tracker.lastSync, language, snapshot.timeZone),
        icon: 'refresh-cw',
        color: stale ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      });
    }
  }
  if (problem) {
    // The last figures stay, with why they no longer move.
    items.unshift({
      label: 'Google Health',
      value: t(TEXT[problem]),
      icon: 'alert-triangle',
      color: WIDGET_COLORS.WARNING,
    });
  }
  components.push(
    items.length > 0
      ? { type: 'status', items }
      : { type: 'text', variant: 'caption', text: t(TEXT.noData) },
  );
  return { ttl_seconds: 300, components };
}
