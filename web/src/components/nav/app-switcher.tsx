"use client";

import { LayoutGrid } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";
import { DEFAULT_HANZO_APPS } from "@/src/components/nav/hanzo-header";

/**
 * Console-native Hanzo app/product switcher.
 *
 * The shared @hanzo/ui `AppSwitcher` hardcodes off-theme colors
 * (bg-[#0e0e13], text-white/40, raw white borders) that clash with the
 * console's dark theme. This renders the same app list (single source of
 * truth: DEFAULT_HANZO_APPS) through the console's own shadcn DropdownMenu
 * primitives so the trigger, surface, typography, and hover states inherit
 * the theme tokens used by the rest of the nav.
 */
export function AppSwitcher({
  apps = DEFAULT_HANZO_APPS,
  currentAppId = "console",
}: {
  apps?: Array<{
    id: string;
    label: string;
    href: string;
    description?: string;
  }>;
  currentAppId?: string;
}) {
  const items = apps.filter((app) => app.id !== currentAppId);
  if (items.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Switch app"
          title="Switch app"
          className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-ring flex h-8 w-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <LayoutGrid className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="w-64">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Hanzo Apps
        </DropdownMenuLabel>
        {items.map((app) => (
          <DropdownMenuItem key={app.id} asChild>
            <a
              href={app.href}
              className="flex cursor-pointer flex-col items-start gap-0.5"
            >
              <span className="text-sm font-medium">{app.label}</span>
              {app.description && (
                <span className="text-muted-foreground text-xs">
                  {app.description}
                </span>
              )}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
