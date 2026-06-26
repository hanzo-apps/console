import { useState, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Hash,
  Type,
  List,
  Braces,
  Quote,
  Eye,
  EyeOff,
  Search,
  Maximize2,
  Minimize2,
} from "@/src/features/agents/components/ui/icon-bridge";
import { Button } from "./button";
import { Input } from "./input";
import { CopyButton } from "./copy-button";
import { cn } from "../../lib/utils";

interface UnifiedJsonViewerProps {
  data: any;
  title?: string;
  className?: string;
  maxHeight?: string;
  collapsible?: boolean;
  showCopyButton?: boolean;
  searchable?: boolean;
  showHeader?: boolean;
}

interface JsonNodeProps {
  data: any;
  keyName?: string;
  level: number;
  path: string[];
  searchTerm?: string;
  onCopy?: (value: string, path: string[]) => void;
}

function detectContentType(
  value: any,
):
  | "markdown"
  | "json"
  | "url"
  | "email"
  | "code"
  | "args"
  | "kwargs"
  | "string"
  | "number"
  | "boolean"
  | "null" {
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";

  if (typeof value === "string") {
    // Check for URLs
    if (/^https?:\/\//.test(value)) return "url";

    // Check for email
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "email";

    // Check for markdown patterns
    if (
      value.includes("**") ||
      value.includes("*") ||
      value.includes("`") ||
      value.includes("#") ||
      value.includes("[") ||
      value.includes("](")
    ) {
      return "markdown";
    }

    // Check for code-like content
    if (
      value.includes("function") ||
      value.includes("def ") ||
      value.includes("class ") ||
      value.includes("import ") ||
      value.includes("from ")
    ) {
      return "code";
    }

    return "string";
  }

  if (typeof value === "object") {
    // Check for args/kwargs patterns
    if (Array.isArray(value)) return "args";
    if (value && typeof value === "object") {
      const keys = Object.keys(value);
      if (
        keys.some(
          (key) =>
            key.startsWith("_") || key.includes("arg") || key.includes("param"),
        )
      ) {
        return "kwargs";
      }
    }
    return "json";
  }

  return "string";
}

function getTypeIcon(type: string) {
  const iconClass = "w-3 h-3";
  switch (type) {
    case "markdown":
      return <FileText className={cn(iconClass, "text-muted-foreground")} />;
    case "json":
      return <Braces className={cn(iconClass, "text-purple-500")} />;
    case "args":
      return <List className={cn(iconClass, "text-green-500")} />;
    case "kwargs":
      return <Hash className={cn(iconClass, "text-orange-500")} />;
    case "string":
      return <Quote className={cn(iconClass, "text-green-600")} />;
    case "number":
      return <Type className={cn(iconClass, "text-muted-foreground")} />;
    case "code":
      return <FileText className={cn(iconClass, "text-red-500")} />;
    case "url":
      return <FileText className={cn(iconClass, "text-muted-foreground")} />;
    case "email":
      return <Type className={cn(iconClass, "text-purple-500")} />;
    default:
      return null;
  }
}

function MarkdownPreview({ content }: { content: string }) {
  const formattedContent = useMemo(() => {
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
      .replace(
        /`(.*?)`/g,
        '<code class="bg-muted px-1 rounded text-sm font-mono text-foreground">$1</code>',
      )
      .replace(/\n\n/g, '</p><p class="mt-2">')
      .replace(/\n/g, "<br>")
      .replace(
        /\[(.*?)\]\((.*?)\)/g,
        '<a href="$2" class="text-primary hover:underline" target="_blank" rel="noopener">$1</a>',
      );
  }, [content]);

  return (
    <div
      className="prose prose-sm text-foreground bg-muted/30 border-border mt-2 max-w-none rounded-md border p-3"
      dangerouslySetInnerHTML={{ __html: `<p>${formattedContent}</p>` }}
    />
  );
}

function JsonNode({
  data,
  keyName,
  level,
  path,
  searchTerm,
  onCopy,
}: JsonNodeProps) {
  const [isExpanded, setIsExpanded] = useState(level < 2); // Auto-expand first 2 levels
  const [showPreview, setShowPreview] = useState(false);

  const contentType = detectContentType(data);
  const isExpandable = typeof data === "object" && data !== null;
  const currentPath = keyName ? [...path, keyName] : path;

  // Search functionality
  const matchesSearch = useMemo(() => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    const keyMatches = keyName?.toLowerCase().includes(searchLower);
    const valueMatches =
      typeof data === "string" && data.toLowerCase().includes(searchLower);
    return keyMatches || valueMatches;
  }, [searchTerm, keyName, data]);

  if (!matchesSearch && typeof data !== "object") return null;

  const renderValue = () => {
    if (data === null) {
      return (
        <span className="text-slate-500 italic dark:text-slate-400">null</span>
      );
    }

    if (typeof data === "boolean") {
      return (
        <span className="text-foreground font-medium">{String(data)}</span>
      );
    }

    if (typeof data === "number") {
      return (
        <span className="font-medium text-purple-600 dark:text-purple-400">
          {data}
        </span>
      );
    }

    if (typeof data === "string") {
      const typeIcon = getTypeIcon(contentType);
      const isLongString = data.length > 100;
      const displayValue =
        isLongString && !showPreview ? `${data.slice(0, 100)}...` : data;

      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {typeIcon}
            <span className="break-all text-green-600 dark:text-green-400">
              "{displayValue}"
            </span>
            {isLongString && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowPreview(!showPreview);
                }}
                className="ml-1 h-5 w-5 p-0"
                title={showPreview ? "Hide preview" : "Show preview"}
              >
                {showPreview ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
              </Button>
            )}
            {contentType === "url" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(data, "_blank", "noopener,noreferrer");
                }}
                className="ml-1 h-5 w-5 p-0"
                title="Open URL"
              >
                <FileText className="h-3 w-3" />
              </Button>
            )}
          </div>

          {showPreview && contentType === "markdown" && (
            <MarkdownPreview content={data} />
          )}

          {showPreview && contentType === "code" && (
            <pre className="bg-muted mt-2 overflow-x-auto rounded-md border p-3 font-mono text-sm">
              <code>{data}</code>
            </pre>
          )}

          {showPreview &&
            isLongString &&
            !["markdown", "code"].includes(contentType) && (
              <div className="bg-muted mt-2 rounded-md border p-3 text-sm break-all">
                {data}
              </div>
            )}
        </div>
      );
    }

    return null;
  };

  const getCollectionInfo = () => {
    if (Array.isArray(data)) {
      return `Array(${data.length})`;
    }
    if (typeof data === "object" && data !== null) {
      const keys = Object.keys(data);
      return `Object(${keys.length})`;
    }
    return "";
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  if (!isExpandable) {
    return (
      <div
        className="group hover:bg-muted/20 flex items-start gap-2 rounded px-1 py-1"
        style={{ paddingLeft: `${level * 16}px` }}
      >
        <div className="w-4" /> {/* Spacer for alignment */}
        {keyName && (
          <span className="text-foreground shrink-0 font-medium">
            "{keyName}":
          </span>
        )}
        <div className="min-w-0 flex-1">{renderValue()}</div>
        <CopyButton
          value={String(data)}
          variant="ghost"
          size="icon"
          className="h-5 w-5 p-0 opacity-0 transition-opacity group-hover:opacity-100 [&_svg]:h-3 [&_svg]:w-3"
          tooltip={`Copy ${currentPath.length > 0 ? currentPath.join(".") : "value"}`}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    );
  }

  const entries = Array.isArray(data)
    ? data.map((item, index) => [index.toString(), item])
    : Object.entries(data);

  return (
    <div className="space-y-1">
      <div
        className="group hover:bg-muted/30 flex cursor-pointer items-center gap-2 rounded px-1 py-1"
        style={{ paddingLeft: `${level * 16}px` }}
        onClick={toggleExpanded}
      >
        <button className="hover:bg-muted flex h-4 w-4 items-center justify-center rounded transition-colors">
          {isExpanded ? (
            <ChevronDown className="text-muted-foreground h-3 w-3" />
          ) : (
            <ChevronRight className="text-muted-foreground h-3 w-3" />
          )}
        </button>

        {keyName && (
          <span className="text-foreground font-medium">"{keyName}":</span>
        )}

        <div className="flex items-center gap-2">
          {getTypeIcon(contentType)}
          <span className="text-muted-foreground">
            {Array.isArray(data) ? "[" : "{"}
          </span>

          {!isExpanded && (
            <>
              <span className="text-body-small italic">
                {getCollectionInfo()}
              </span>
              <span className="text-muted-foreground">
                {Array.isArray(data) ? "]" : "}"}
              </span>
            </>
          )}
        </div>

        <CopyButton
          value={JSON.stringify(data, null, 2)}
          variant="ghost"
          size="icon"
          className="h-5 w-5 p-0 opacity-0 transition-opacity group-hover:opacity-100 [&_svg]:h-3 [&_svg]:w-3"
          tooltip={`Copy ${currentPath.length > 0 ? currentPath.join(".") : "JSON"}`}
          onClick={(event) => event.stopPropagation()}
        />
      </div>

      {isExpanded && (
        <div className="space-y-1">
          {entries.map(([key, value]) => (
            <JsonNode
              key={key}
              data={value}
              keyName={Array.isArray(data) ? undefined : key}
              level={level + 1}
              path={currentPath}
              searchTerm={searchTerm}
              onCopy={onCopy}
            />
          ))}

          <div
            className="flex items-center"
            style={{ paddingLeft: `${(level + 1) * 16}px` }}
          >
            <div className="w-4" />
            <span className="text-muted-foreground">
              {Array.isArray(data) ? "]" : "}"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function UnifiedJsonViewer({
  data,
  title,
  className,
  maxHeight = "400px",
  collapsible = true,
  showCopyButton = true,
  searchable = true,
  showHeader = true,
}: UnifiedJsonViewerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const jsonString = JSON.stringify(data, null, 2);

  const isEmpty =
    !data || (typeof data === "object" && Object.keys(data).length === 0);

  const isFlexibleHeight = maxHeight === "none";

  const handleCopy = (value: string, path: string[]) => {
    console.log(`Copied ${path.join(".")}:`, value);
  };

  return (
    <div
      className={cn(
        "border-border bg-background flex flex-col overflow-hidden rounded-lg border",
        isFlexibleHeight && "h-full",
        className,
      )}
    >
      {/* Header */}
      {showHeader && (title || showCopyButton || (searchable && !isEmpty)) && (
        <div className="border-border bg-muted/20 flex-shrink-0 border-b">
          {(title || showCopyButton) && (
            <div className="flex items-center justify-between p-3">
              {title && (
                <h4 className="text-foreground flex items-center gap-2 text-sm font-medium">
                  {getTypeIcon(detectContentType(data))}
                  {title}
                </h4>
              )}
              <div className="flex items-center gap-2">
                {showCopyButton && !isEmpty && (
                  <CopyButton
                    value={jsonString}
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 p-0 opacity-100 [&_svg]:h-3 [&_svg]:w-3"
                    tooltip="Copy JSON"
                    onClick={(event) => event.stopPropagation()}
                  />
                )}
                {collapsible && !isEmpty && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="h-5 w-5 p-0"
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    {isExpanded ? (
                      <Minimize2 className="text-muted-foreground h-3 w-3" />
                    ) : (
                      <Maximize2 className="text-muted-foreground h-3 w-3" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}

          {searchable && !isEmpty && (
            <div className="px-3 pb-3">
              <div className="relative">
                <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
                <Input
                  placeholder="Search keys and values..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-8 pl-10"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div
        className={cn(
          "bg-background scrollbar-thumb-border hover:scrollbar-thumb-muted-foreground scrollbar-thin scrollbar-track-transparent",
          isEmpty ? "p-6" : "p-4",
          isFlexibleHeight ? "min-h-0 flex-1 overflow-auto" : "overflow-auto",
        )}
        style={!isExpanded && !isFlexibleHeight ? { maxHeight } : undefined}
      >
        {isEmpty ? (
          <div className="text-muted-foreground text-center">
            <div className="flex flex-col items-center gap-3">
              <Braces className="text-muted-foreground/50 h-8 w-8" />
              <p className="text-sm">No data available</p>
            </div>
          </div>
        ) : (
          <div className="font-mono text-sm">
            <JsonNode
              data={data}
              level={0}
              path={[]}
              searchTerm={searchTerm}
              onCopy={handleCopy}
            />
          </div>
        )}
      </div>
    </div>
  );
}
