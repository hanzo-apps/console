import { cn } from "@/src/utils/tailwind";
import Link from "next/link";
import { VersionLabel } from "./VersionLabel";
import { useUiCustomization } from "@/src/features/ui-customization/useUiCustomization";
import { PlusIcon } from "lucide-react";
import { useBrand, BrandMark } from "@/src/features/branding/useBrand";

/**
 * The real Hanzo monochrome "blocky-H" mark (canonical @hanzo/logo, 67x67,
 * 7 paths). Rendered inline so `fill="currentColor"` adapts to the surrounding
 * theme (e.g. white on the dark sidebar, dark on light surfaces). This is the
 * one true mark — do not reintroduce the made-up red H or any hand-drawn H.
 */
export const HanzoCloudIcon = ({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) => (
  <svg
    viewBox="0 0 67 67"
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    className={cn("fill-current", className)}
    aria-label="Hanzo"
    role="img"
  >
    <path d="M22.21 67V44.6369H0V67H22.21Z" />
    <path d="M0 44.6369L22.21 46.8285V44.6369H0Z" opacity="0.8" />
    <path d="M66.7038 22.3184H22.2534L0.0878906 44.6367H44.4634L66.7038 22.3184Z" />
    <path d="M22.21 0H0V22.3184H22.21V0Z" />
    <path d="M66.7198 0H44.5098V22.3184H66.7198V0Z" />
    <path d="M66.6753 22.3185L44.5098 20.0822V22.3185H66.6753Z" opacity="0.8" />
    <path d="M66.7198 67V44.6369H44.5098V67H66.7198Z" />
  </svg>
);

// Alias for backwards compatibility with HanzoIcon imports
export const HanzoIcon = HanzoCloudIcon;

const HanzoCloudLogotypeOrCustomized = ({ size }: { size: "sm" | "xl" }) => {
  const uiCustomization = useUiCustomization();
  // Host-driven white-label brand (default Hanzo). The per-org image override
  // below sits ON TOP of this brand default — two orthogonal layers.
  const brand = useBrand();
  const markSize = size === "sm" ? 16 : 20;

  if (uiCustomization?.logoLightModeHref && uiCustomization?.logoDarkModeHref) {
    // logo is a url, maximum aspect ratio of 1:3 needs to be supported according to docs
    return (
      <div className="flex items-center gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={uiCustomization.logoLightModeHref}
          alt={`${brand.brandName} Logo`}
          className={cn(
            "group-data-[collapsible=icon]:hidden dark:hidden",
            "max-h-4 max-w-14",
          )}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={uiCustomization.logoDarkModeHref}
          alt={`${brand.brandName} Logo`}
          className={cn(
            "hidden group-data-[collapsible=icon]:hidden dark:block",
            "max-h-4 max-w-14",
          )}
        />
        <PlusIcon
          size={size === "sm" ? 8 : 12}
          className="group-data-[collapsible=icon]:hidden"
        />
        <BrandMark brand={brand} size={markSize} className="fill-current" />
      </div>
    );
  }

  return (
    <div className="flex items-center">
      <BrandMark brand={brand} size={markSize} className="fill-current" />
      <span
        className={cn(
          "ml-2 font-mono leading-none font-semibold group-data-[collapsible=icon]:hidden",
          size === "sm" ? "text-sm" : "text-xl",
        )}
      >
        {brand.brandName}
      </span>
    </div>
  );
};

export const HanzoCloudLogo = ({
  className,
  size = "sm",
  version = false,
}: {
  size?: "sm" | "xl";
  className?: string;
  version?: boolean;
}) => {
  return (
    <div
      className={cn(
        "-mt-2 ml-1 flex flex-wrap gap-4 lg:flex-col lg:items-start",
        className,
      )}
    >
      {/* Hanzo Cloud Logo */}
      <div className="flex items-center">
        <Link href="/" className="flex items-center">
          <HanzoCloudLogotypeOrCustomized size={size} />
        </Link>
        {version && (
          <VersionLabel className="ml-2 group-data-[collapsible=icon]:hidden" />
        )}
      </div>
    </div>
  );
};

// Alias for backwards compatibility
export const HanzoLogo = HanzoCloudLogo;
