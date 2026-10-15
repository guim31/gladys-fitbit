// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface: English, French, German (informal "du") and Spanish (formal
// "usted"). Brand names (Fitbit, Google, Pixel Watch) are never translated.
// -----------------------------------------------------------------------------

export const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/** Pick one language of a multi-language object (French, then English, as fallback). */
export function pick(text, language) {
  return text[language] ?? text.fr ?? text.en;
}

// Feature names, fixed when the user adds the device (Gladys never renames).
export const NAMES = {
  en: {
    device: 'Fitbit',
    steps: 'Steps today',
    distance: 'Distance today',
    floors: 'Floors today',
    calories: 'Calories burned (kcal)',
    activeMinutes: 'Active minutes',
    restingHeartRate: 'Resting heart rate (bpm)',
    sleepDuration: 'Sleep duration',
    sleepEfficiency: 'Sleep efficiency',
    bedtime: 'Bedtime',
    wakeTime: 'Wake-up time',
    weight: 'Weight (kg)',
    bodyFat: 'Body fat',
    battery: 'Watch battery',
    lastSync: 'Last sync',
  },
  fr: {
    device: 'Fitbit',
    steps: 'Pas du jour',
    distance: 'Distance du jour',
    floors: 'Étages du jour',
    calories: 'Calories brûlées (kcal)',
    activeMinutes: 'Minutes actives',
    restingHeartRate: 'Fréquence cardiaque au repos (bpm)',
    sleepDuration: 'Durée du sommeil',
    sleepEfficiency: 'Efficacité du sommeil',
    bedtime: 'Heure du coucher',
    wakeTime: 'Heure du lever',
    weight: 'Poids (kg)',
    bodyFat: 'Masse grasse',
    battery: 'Batterie de la montre',
    lastSync: 'Dernière synchronisation',
  },
  de: {
    device: 'Fitbit',
    steps: 'Schritte heute',
    distance: 'Distanz heute',
    floors: 'Etagen heute',
    calories: 'Verbrannte Kalorien (kcal)',
    activeMinutes: 'Aktivminuten',
    restingHeartRate: 'Ruhepuls (bpm)',
    sleepDuration: 'Schlafdauer',
    sleepEfficiency: 'Schlafeffizienz',
    bedtime: 'Schlafenszeit',
    wakeTime: 'Aufwachzeit',
    weight: 'Gewicht (kg)',
    bodyFat: 'Körperfett',
    battery: 'Akku der Uhr',
    lastSync: 'Letzte Synchronisierung',
  },
  es: {
    device: 'Fitbit',
    steps: 'Pasos de hoy',
    distance: 'Distancia de hoy',
    floors: 'Pisos de hoy',
    calories: 'Calorías quemadas (kcal)',
    activeMinutes: 'Minutos activos',
    restingHeartRate: 'Frecuencia cardíaca en reposo (ppm)',
    sleepDuration: 'Duración del sueño',
    sleepEfficiency: 'Eficiencia del sueño',
    bedtime: 'Hora de acostarse',
    wakeTime: 'Hora de despertarse',
    weight: 'Peso (kg)',
    bodyFat: 'Grasa corporal',
    battery: 'Batería del reloj',
    lastSync: 'Última sincronización',
  },
};

// Connection status shown in the Configuration screen (multi-language objects).
export const STATUS = {
  notConfigured: {
    en: 'Enter the client ID and secret of your Google Cloud OAuth client, save, then press Connect.',
    fr: 'Saisissez l’ID client et le secret de votre client OAuth Google Cloud, enregistrez, puis cliquez sur Connecter.',
    de: 'Gib die Client-ID und das Secret deines Google-Cloud-OAuth-Clients ein, speichere und klicke dann auf Verbinden.',
    es: 'Introduzca el ID de cliente y el secreto de su cliente OAuth de Google Cloud, guarde y pulse Conectar.',
  },
  notConnected: {
    en: 'Press Connect to link your Google account (the one your Fitbit is linked to).',
    fr: 'Cliquez sur Connecter pour lier votre compte Google (celui de votre Fitbit).',
    de: 'Klicke auf Verbinden, um dein Google-Konto (das deiner Fitbit) zu verknüpfen.',
    es: 'Pulse Conectar para vincular su cuenta de Google (la de su Fitbit).',
  },
  revoked: {
    en: 'Google withdrew the authorization: press Connect again. An OAuth app left in “Testing” loses it every 7 days.',
    fr: 'Google a retiré l’autorisation : cliquez à nouveau sur Connecter. Une application OAuth restée « en test » la perd tous les 7 jours.',
    de: 'Google hat die Berechtigung entzogen: Klicke erneut auf Verbinden. Eine OAuth-App im Status „Test“ verliert sie alle 7 Tage.',
    es: 'Google ha retirado la autorización: pulse Conectar de nuevo. Una aplicación OAuth en «Prueba» la pierde cada 7 días.',
  },
  client: {
    en: 'Google refused the client ID or secret: check them in the configuration.',
    fr: 'Google a refusé l’ID client ou le secret : vérifiez-les dans la configuration.',
    de: 'Google hat die Client-ID oder das Secret abgelehnt: Prüfe sie in der Konfiguration.',
    es: 'Google ha rechazado el ID de cliente o el secreto: compruébelos en la configuración.',
  },
  apiDisabled: {
    en: 'The Google Health API is not enabled in your Google Cloud project: enable it, then wait a few minutes.',
    fr: 'L’API Google Health n’est pas activée dans votre projet Google Cloud : activez-la, puis patientez quelques minutes.',
    de: 'Die Google Health API ist in deinem Google-Cloud-Projekt nicht aktiviert: Aktiviere sie und warte ein paar Minuten.',
    es: 'La API de Google Health no está activada en su proyecto de Google Cloud: actívela y espere unos minutos.',
  },
  notLinked: {
    en: 'This Google account has no Fitbit data: move your Fitbit account to Google in the Fitbit app first.',
    fr: 'Ce compte Google n’a pas de données Fitbit : migrez d’abord votre compte Fitbit vers Google dans l’application Fitbit.',
    de: 'Dieses Google-Konto hat keine Fitbit-Daten: Übertrage zuerst dein Fitbit-Konto in der Fitbit-App zu Google.',
    es: 'Esta cuenta de Google no tiene datos de Fitbit: primero migre su cuenta de Fitbit a Google en la aplicación Fitbit.',
  },
  unreachable: {
    en: 'Google Health does not answer for now, the integration tries again at each refresh.',
    fr: 'Google Health ne répond pas pour l’instant, l’intégration réessaie à chaque rafraîchissement.',
    de: 'Google Health antwortet gerade nicht, die Integration versucht es bei jeder Aktualisierung erneut.',
    es: 'Google Health no responde por ahora, la integración lo vuelve a intentar en cada actualización.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: 'L’initialisation a échoué, consultez les journaux de l’intégration.',
    de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
};

// Messages of the configuration actions and of the Connect button.
export const MESSAGES = {
  refreshed: {
    en: (summary) => `Data read again. ${summary}`,
    fr: (summary) => `Données relues. ${summary}`,
    de: (summary) => `Daten neu gelesen. ${summary}`,
    es: (summary) => `Datos leídos de nuevo. ${summary}`,
  },
  summary: {
    en: (steps, sync) => `Steps today: ${steps}. Last sync of the watch: ${sync}.`,
    fr: (steps, sync) => `Pas du jour : ${steps}. Dernière synchronisation de la montre : ${sync}.`,
    de: (steps, sync) => `Schritte heute: ${steps}. Letzte Synchronisierung der Uhr: ${sync}.`,
    es: (steps, sync) => `Pasos de hoy: ${steps}. Última sincronización del reloj: ${sync}.`,
  },
  unknown: { en: 'unknown', fr: 'inconnue', de: 'unbekannt', es: 'desconocida' },
  failed: {
    en: (reason) => `Reading failed: ${reason}`,
    fr: (reason) => `La lecture a échoué : ${reason}`,
    de: (reason) => `Lesen fehlgeschlagen: ${reason}`,
    es: (reason) => `La lectura ha fallado: ${reason}`,
  },
};

/** "07:05" in the given UTC offset (minutes), or in a time zone. */
export function formatClock(iso, { offsetMinutes = null, timeZone = 'UTC' } = {}) {
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) {
    return null;
  }
  const shifted = offsetMinutes === null ? instant : instant + offsetMinutes * 60000;
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: offsetMinutes === null ? timeZone : 'UTC',
  }).format(new Date(shifted));
}

/** "15 Oct, 07:42" in the language and time zone given. */
export function formatDateTime(iso, language, timeZone) {
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) {
    return null;
  }
  return new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.fr, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(instant));
}

/** 8432 → "8 432" / "8,432" / "8.432". */
export function formatInteger(value, language) {
  return new Intl.NumberFormat(LOCALES[language] ?? LOCALES.fr, {
    maximumFractionDigits: 0,
  }).format(value);
}

/** 7.25 → "7,3" / "7.3". */
export function formatDecimal(value, language, digits = 1) {
  return new Intl.NumberFormat(LOCALES[language] ?? LOCALES.fr, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
