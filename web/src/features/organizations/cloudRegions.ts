const cloudRegions = [
  {
    name: "DEV",
    flag: "🚧",
    hostname: null,
    rootUrl: null,
    isProduction: false,
  },
  {
    name: "STAGING",
    flag: "🇪🇺",
    hostname: "staging.hanzo.ai",
    rootUrl: "https://staging.hanzo.ai",
    isProduction: false,
  },
  {
    name: "EU",
    flag: "🇪🇺",
    hostname: "cloud.hanzo.ai",
    rootUrl: "https://cloud.hanzo.ai",
    isProduction: true,
  },
  {
    name: "US",
    flag: "🇺🇸",
    hostname: "us.cloud.hanzo.ai",
    rootUrl: "https://us.cloud.hanzo.ai",
    isProduction: true,
  },
  {
    name: "JP",
    flag: "🇯🇵",
    hostname: "jp.cloud.hanzo.ai",
    rootUrl: "https://jp.cloud.hanzo.ai",
    isProduction: true,
  },
  {
    name: "HIPAA",
    flag: "⚕️",
    hostname: "hipaa.cloud.hanzo.ai",
    rootUrl: "https://hipaa.cloud.hanzo.ai",
    isProduction: true,
  },
] as const;

const availableRegionsByCurrentRegion = {
  STAGING: ["STAGING"],
  DEV: ["DEV"],
  default: ["US", "EU", "JP", "HIPAA"],
} as const;

const getCloudRegion = (name: (typeof cloudRegions)[number]["name"]) => {
  const region = cloudRegions.find((region) => region.name === name);
  if (!region) {
    throw new Error(`Unknown cloud region: ${name}`);
  }

  return region;
};

export const getAvailableCloudRegionOptions = (currentRegion?: string) => {
  if (currentRegion === "STAGING") {
    return availableRegionsByCurrentRegion.STAGING.map(getCloudRegion);
  }

  if (currentRegion === "DEV") {
    return availableRegionsByCurrentRegion.DEV.map(getCloudRegion);
  }

  return availableRegionsByCurrentRegion.default.map(getCloudRegion);
};

export const getCloudRegionAuthUrl = (
  rootUrl: string,
  email?: string | null,
): string => {
  const authUrl = new URL("/auth/sign-in", rootUrl);

  if (email) {
    authUrl.searchParams.set("email", email);
  }

  return authUrl.toString();
};

export const isRegionProduction = (regionName: string): boolean => {
  const region = cloudRegions.find((r) => r.name === regionName);
  return region ? region.isProduction : false;
};
