import { cn } from "@/src/utils/tailwind";

interface MentionBadgeProps {
  userId: string;
  displayName: string;
  className?: string;
}

export function MentionBadge({
  userId,
  displayName,
  className,
}: MentionBadgeProps) {
  return (
    <span
      className={cn(
        "bg-muted text-foreground inline-flex items-center rounded px-1.5 py-0.5 text-sm font-medium",
        className,
      )}
      data-user-id={userId}
    >
      @{displayName}
    </span>
  );
}
