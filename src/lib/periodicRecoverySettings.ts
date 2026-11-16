export const RECOVERY_INTERVALS = [1, 2, 5, 10] as const;
export const RECOVERY_SETTINGS_KEY = 'armstruct.recovery-periodic.v1';
export type PeriodicRecoverySettings = {
  enabled: boolean;
  minutes: (typeof RECOVERY_INTERVALS)[number];
};
export const DEFAULT_PERIODIC_RECOVERY_SETTINGS: PeriodicRecoverySettings = {
  enabled: true,
  minutes: 5,
};

function validate(value: unknown): PeriodicRecoverySettings {
  if (typeof value === 'object' && value !== null) {
    const { enabled, minutes } = value as Partial<PeriodicRecoverySettings>;
    if (
      typeof enabled === 'boolean' &&
      minutes !== undefined &&
      RECOVERY_INTERVALS.includes(minutes)
    )
      return { enabled, minutes };
  }
  throw Error('Escolha um intervalo de 1, 2, 5 ou 10 minutos.');
}

export function loadPeriodicRecoverySettings(
  storage?: Pick<Storage, 'getItem'>,
): {
  settings: PeriodicRecoverySettings;
  warning?: string;
} {
  try {
    const raw = (storage ?? localStorage).getItem(RECOVERY_SETTINGS_KEY);
    return {
      settings:
        raw === null
          ? DEFAULT_PERIODIC_RECOVERY_SETTINGS
          : validate(JSON.parse(raw)),
    };
  } catch {
    return {
      settings: DEFAULT_PERIODIC_RECOVERY_SETTINGS,
      warning:
        'Preferência de recuperação indisponível ou inválida. Usando o padrão de 5 minutos.',
    };
  }
}

export function savePeriodicRecoverySettings(
  settings: PeriodicRecoverySettings,
  storage?: Pick<Storage, 'setItem'>,
) {
  (storage ?? localStorage).setItem(
    RECOVERY_SETTINGS_KEY,
    JSON.stringify(validate(settings)),
  );
}
