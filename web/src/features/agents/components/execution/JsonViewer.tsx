import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
} from "@/src/features/agents/components/ui/icon-bridge";
import { cn } from "../../lib/utils";

interface JsonViewerProps {
  data: any;
  collapsed?: number;
  className?: string;
}

interface JsonNodeProps {
  data: any;
  keyName?: string;
  level: number;
  collapsed: number;
  isLast?: boolean;
}

function JsonNode({
  data,
  keyName,
  level,
  collapsed,
  isLast = false,
}: JsonNodeProps) {
  const [isCollapsed, setIsCollapsed] = useState(level >= collapsed);

  const getDataType = (value: any): string => {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  };

  const getValueColor = (type: string): string => {
    switch (type) {
      case "string":
        return "text-green-600 dark:text-green-400";
      case "number":
        return "text-foreground";
      case "boolean":
        return "text-purple-600 dark:text-purple-400";
      case "null":
        return "text-gray-500 dark:text-gray-400";
      default:
        return "text-foreground";
    }
  };

  const renderValue = (value: any): React.ReactNode => {
    const type = getDataType(value);
    const colorClass = getValueColor(type);

    if (type === "string") {
      return <span className={colorClass}>"{value}"</span>;
    } else if (type === "null") {
      return <span className={colorClass}>null</span>;
    } else {
      return <span className={colorClass}>{String(value)}</span>;
    }
  };

  const isExpandable = (value: any): boolean => {
    return (
      (typeof value === "object" && value !== null) || Array.isArray(value)
    );
  };

  const getPreview = (value: any): string => {
    if (Array.isArray(value)) {
      return `Array(${value.length})`;
    } else if (typeof value === "object" && value !== null) {
      const keys = Object.keys(value);
      return `Object(${keys.length})`;
    }
    return "";
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  if (!isExpandable(data)) {
    return (
      <div className="flex items-center gap-1">
        {keyName && (
          <>
            <span className="text-muted-foreground">"{keyName}"</span>
            <span className="text-muted-foreground">:</span>
          </>
        )}
        {renderValue(data)}
        {!isLast && <span className="text-muted-foreground">,</span>}
      </div>
    );
  }

  const entries = Array.isArray(data)
    ? data.map((item, index) => [index.toString(), item])
    : Object.entries(data);

  return (
    <div>
      <div
        className="hover:bg-muted/50 flex cursor-pointer items-center gap-1 rounded px-1"
        onClick={toggleCollapse}
      >
        {isCollapsed ? (
          <ChevronRight className="text-muted-foreground h-3 w-3" />
        ) : (
          <ChevronDown className="text-muted-foreground h-3 w-3" />
        )}
        {keyName && (
          <>
            <span className="text-muted-foreground">"{keyName}"</span>
            <span className="text-muted-foreground">:</span>
          </>
        )}
        <span className="text-muted-foreground">
          {Array.isArray(data) ? "[" : "{"}
        </span>
        {isCollapsed && (
          <>
            <span className="text-body-small italic">{getPreview(data)}</span>
            <span className="text-muted-foreground">
              {Array.isArray(data) ? "]" : "}"}
            </span>
          </>
        )}
        {!isLast && isCollapsed && (
          <span className="text-muted-foreground">,</span>
        )}
      </div>

      {!isCollapsed && (
        <div className="border-border/30 ml-4 border-l pl-2">
          {entries.map(([key, value], index) => (
            <JsonNode
              key={key}
              data={value}
              keyName={Array.isArray(data) ? undefined : key}
              level={level + 1}
              collapsed={collapsed}
              isLast={index === entries.length - 1}
            />
          ))}
          <div className="flex items-center">
            <span className="text-muted-foreground">
              {Array.isArray(data) ? "]" : "}"}
            </span>
            {!isLast && <span className="text-muted-foreground">,</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function JsonViewer({
  data,
  collapsed = 2,
  className,
}: JsonViewerProps) {
  return (
    <div className={cn("overflow-auto font-mono text-sm", className)}>
      <JsonNode data={data} level={0} collapsed={collapsed} />
    </div>
  );
}
