import { useMemo } from "react";
import {
  type Brand,
  getBrandFromHost,
} from "@/src/features/branding/brandRegistry";

/**
 * Resolve the active white-label brand for the current request.
 *
 * On the client it reads `window.location.hostname`; on the server (SSR) there
 * is no window, so it resolves from NEXT_PUBLIC_BRAND / the default. Pages that
 * want a flash-free branded first paint should resolve the brand in
 * getServerSideProps (via getBrandFromHost with the request host) and pass it as
 * a prop; this hook is the client default for components that render only in the
 * browser (e.g. the sidebar).
 */
export function useBrand(): Brand {
  return useMemo(() => {
    const host =
      typeof window !== "undefined" ? window.location.hostname : undefined;
    return getBrandFromHost(host);
  }, []);
}

/** Render a brand's inline-SVG mark; `currentColor` adapts to the theme. */
export function BrandMark({
  brand,
  size = 32,
  className,
}: {
  brand: Brand;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox={brand.logoViewBox}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={className}
      aria-label={brand.brandName}
      role="img"
      // Brand marks are static, trusted, build-time SVG strings from the brand
      // registry (no user input) — inlined so currentColor themes them.
      dangerouslySetInnerHTML={{ __html: brand.logoContent }}
    />
  );
}
