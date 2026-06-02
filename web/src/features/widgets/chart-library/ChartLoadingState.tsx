import { useEffect, useState } from "react";
import { cn } from "@/src/utils/tailwind";
import { SLOW_QUERY_HINT_TEXT } from "@hanzo/console-core";

const DEFAULT_HINT_DELAY_MS = 2000;
const PROGRESS_REVEAL_DELAY_MS = 1000;

type ChartLoadingStateProps = {
  isLoading: boolean;
  className?: string;
  hintClassName?: string;
  spinnerLabel?: string;
  hintText?: string;
  hintDelayMs?: number;
  showSpinner?: boolean;
  showHintImmediately?: boolean;
  progress?: QueryProgress | null;
  layout?: "default" | "compact" | "tight";
  onRetry?: () => void;
  retryLabel?: string;
};

export function ChartLoadingState({
  isLoading,
  className,
  hintClassName,
  spinnerLabel = "Loading chart data",
  hintText = SLOW_QUERY_HINT_TEXT,
  hintDelayMs = DEFAULT_HINT_DELAY_MS,
  showSpinner = true,
  showHintImmediately = false,
  progress,
  layout = "default",
  onRetry,
  retryLabel = "Retry",
}: ChartLoadingStateProps) {
  const [showHint, setShowHint] = useState(false);
  const [showProgressPhase, setShowProgressPhase] = useState(false);
  const shouldShowProgress = progress !== undefined;
  const isPendingProgressState = isLoading && showSpinner && shouldShowProgress;

  useEffect(() => {
    if (!isLoading) {
      setShowHint(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowHint(true);
    }, hintDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hintDelayMs, isLoading]);

  useEffect(() => {
    if (!isPendingProgressState) {
      setShowProgressPhase(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowProgressPhase(true);
    }, PROGRESS_REVEAL_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isPendingProgressState]);

  if (!isLoading) {
    return null;
  }

  const shouldShowHint = showHintImmediately || showHint;
  const isCompact = layout !== "default";
  const isTight = layout === "tight";
  const isLegacySpinnerOnlyState = showSpinner && !shouldShowProgress;
  const isTightProgressState = isTight && shouldShowProgress;
  const shouldRenderStatusTitle = !isTightProgressState;
  const shouldRenderHint = shouldShowHint && !isTightProgressState;
  const shouldRenderRetry = Boolean(onRetry) && shouldShowHint && !showSpinner;

  if (
    isLegacySpinnerOnlyState ||
    (isPendingProgressState && !showProgressPhase)
  ) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={spinnerLabel}
        className={cn(
          "text-muted-foreground flex h-full w-full items-center justify-center",
          className,
        )}
      >
        <div className="flex h-4 w-4 items-center justify-center">
          <Spinner size="sm" />
        </div>
      </div>
    );
  }

  const statusTitle =
    isPendingProgressState || shouldShowProgress
      ? "Running query"
      : showSpinner
        ? "Loading widget"
        : "Query needs attention";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={spinnerLabel}
      className={cn("flex flex-col items-center justify-center gap-2 text-muted-foreground", className)}
    >
      <div
        className={cn(
          "m-auto w-full",
          isTightProgressState
            ? "max-w-[12rem] px-3 py-2"
            : "max-w-sm px-4 py-4",
        )}
      </div>
      {shouldShowHint ? (
        <p className={cn("max-w-xs text-center text-xs duration-300 animate-in fade-in-0", hintClassName)}>
          {hintText}
        </p>
      ) : null}
    </div>
  );
}
