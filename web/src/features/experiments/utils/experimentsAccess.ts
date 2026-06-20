export type ExperimentsAccessInput = {
  isConsoleCloud: boolean;
  isV4BetaEnabled: boolean;
};

export function getExperimentsAccess({
  isConsoleCloud,
  isV4BetaEnabled,
}: ExperimentsAccessInput) {
  return {
    isEnabled: isConsoleCloud && isV4BetaEnabled,
  };
}
