import { useQuery } from "@tanstack/react-query";
import { useHasEntitlement } from "@/src/features/entitlements/hooks";
import { zapUiCustomization } from "@/src/utils/zapClient";

/**
 * UI customization config, now over native ZAP capability-RPC (was the
 * uiCustomization tRPC router). Same external contract: returns the config when
 * the instance is entitled, else null. The ZAP `get` returns `present: false`
 * when not entitled — we map that to null to preserve every existing caller.
 */
export const useUiCustomization = () => {
  const hasEntitlement = useHasEntitlement("self-host-ui-customization");
  const customization = useQuery({
    queryKey: ["zap", "ui-customization", "get"],
    queryFn: zapUiCustomization.get,
    enabled: hasEntitlement,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (!hasEntitlement) return null;
  const data = customization.data;
  if (!data || !data.present) return null;
  return data;
};

export type UiCustomizationOption = keyof NonNullable<
  ReturnType<typeof useUiCustomization>
>;
