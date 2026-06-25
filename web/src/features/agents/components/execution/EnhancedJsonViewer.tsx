import React, { useState } from "react";
import {
  Maximize2,
  Minimize2,
} from "@/src/features/agents/components/ui/icon-bridge";
import { CopyButton } from "../ui/copy-button";
import { cn } from "../../lib/utils";

interface EnhancedJsonViewerProps {
  data: any;
  title?: string;
  className?: string;
  maxHeight?: string;
  collapsible?: boolean;
  showCopyButton?: boolean;
}

function JsonFormatter({ data }: { data: any }) {
  const formatValue = (value: any, depth: number = 0): React.ReactNode => {
    if (value === null) {
      return <span className="text-slate-500">null</span>;
    }

    if (typeof value === "boolean") {
      return <span className="text-foreground">{String(value)}</span>;
    }

    if (typeof value === "number") {
      return <span className="text-purple-600">{value}</span>;
    }

    if (typeof value === "string") {
      return <span className="text-green-600">"{value}"</span>;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return <span className="text-muted-foreground">[]</span>;
      }

      return (
        <>
          <span className="text-muted-foreground">[</span>
          <div className="ml-4">
            {value.map((item, index) => (
              <div key={index}>
                {formatValue(item, depth + 1)}
                {index < value.length - 1 && (
                  <span className="text-muted-foreground">,</span>
                )}
              </div>
            ))}
          </div>
          <span className="text-muted-foreground">]</span>
        </>
      );
    }

    if (typeof value === "object") {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return <span className="text-muted-foreground">{"{}"}</span>;
      }

      return (
        <>
          <span className="text-muted-foreground">{"{"}</span>
          <div className="ml-4">
            {keys.map((key, index) => (
              <div key={key}>
                <span className="text-muted-foreground">"{key}"</span>
                <span className="text-muted-foreground">: </span>
                {formatValue(value[key], depth + 1)}
                {index < keys.length - 1 && (
                  <span className="text-muted-foreground">,</span>
                )}
              </div>
            ))}
          </div>
          <span className="text-muted-foreground">{"}"}</span>
        </>
      );
    }

    return <span className="text-foreground">{String(value)}</span>;
  };

  return (
    <pre className="text-foreground font-mono text-sm leading-relaxed whitespace-pre-wrap">
      {formatValue(data)}
    </pre>
  );
}

export function EnhancedJsonViewer({
  data,
  title,
  className,
  maxHeight = "400px",
  collapsible = true,
  showCopyButton = true,
}: EnhancedJsonViewerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const jsonString = JSON.stringify(data, null, 2);

  const isEmpty =
    !data || (typeof data === "object" && Object.keys(data).length === 0);

  return (
    <div
      className={cn(
        "border-border overflow-hidden rounded-lg border",
        className,
      )}
    >
      {/* Header */}
      {(title || showCopyButton) && (
        <div className="border-border bg-muted/30 flex items-center justify-between border-b p-3">
          {title && (
            <h4 className="text-foreground text-sm font-medium">{title}</h4>
          )}
          <div className="flex items-center gap-2">
            {showCopyButton && !isEmpty && (
              <CopyButton
                value={jsonString}
                variant="ghost"
                size="icon"
                className="hover:bg-muted/80 h-6 w-6 p-0 [&_svg]:h-3 [&_svg]:w-3"
                tooltip="Copy JSON"
              />
            )}
            {collapsible && !isEmpty && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="hover:bg-muted/80 inline-flex h-6 w-6 items-center justify-center rounded-sm transition-colors duration-150"
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? (
                  <Minimize2 className="text-muted-foreground h-3 w-3" />
                ) : (
                  <Maximize2 className="text-muted-foreground h-3 w-3" />
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div
        className={cn("bg-background overflow-auto p-4")}
        style={!isExpanded ? { maxHeight } : undefined}
      >
        {isEmpty ? (
          <div className="text-muted-foreground py-8 text-center">
            <p className="text-sm">No data available</p>
          </div>
        ) : (
          <JsonFormatter data={data} />
        )}
      </div>
    </div>
  );
}
