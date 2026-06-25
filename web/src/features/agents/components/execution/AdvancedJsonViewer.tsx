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
  Search,
} from "@/src/features/agents/components/ui/icon-bridge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CopyButton } from "../ui/copy-button";

interface AdvancedJsonViewerProps {
  data: any;
  maxHeight?: string;
  className?: string;
  searchable?: boolean;
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
  switch (type) {
    case "markdown":
      return <FileText className="text-foreground h-3 w-3" />;
    case "json":
      return <Braces className="h-3 w-3 text-purple-500" />;
    case "args":
      return <List className="h-3 w-3 text-green-500" />;
    case "kwargs":
      return <Hash className="h-3 w-3 text-orange-500" />;
    case "string":
      return <Quote className="h-3 w-3 text-green-600" />;
    case "number":
      return <Type className="text-foreground h-3 w-3" />;
    case "code":
      return <FileText className="h-3 w-3 text-red-500" />;
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
      className="prose prose-sm text-foreground bg-muted/30 border-border/50 max-w-none rounded border p-2"
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
      return <span className="text-slate-500 italic">null</span>;
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
          <div className="flex items-center gap-2">
            {typeIcon}
            <span className="text-green-600 dark:text-green-400">
              "{displayValue}"
            </span>
            {isLongString && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
                className="h-5 w-5 p-0"
                title={showPreview ? "Hide preview" : "Show preview"}
              >
                <Eye className="h-3 w-3" />
              </Button>
            )}
          </div>

          {showPreview && contentType === "markdown" && (
            <MarkdownPreview content={data} />
          )}

          {showPreview && contentType === "code" && (
            <pre className="overflow-x-auto rounded bg-gray-100 p-2 font-mono text-sm dark:bg-gray-800">
              <code>{data}</code>
            </pre>
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
        className="group flex items-start gap-2 py-0.5"
        style={{ paddingLeft: `${level * 16}px` }}
      >
        <div className="w-4" /> {/* Spacer for alignment */}
        {keyName && (
          <span className="text-muted-foreground shrink-0 font-medium">
            "{keyName}":
          </span>
        )}
        <div className="min-w-0 flex-1">{renderValue()}</div>
        <CopyButton
          value={String(data)}
          variant="ghost"
          size="icon"
          className="h-5 w-5 p-0 opacity-0 transition-opacity group-hover:opacity-100 [&_svg]:h-3 [&_svg]:w-3"
          tooltip={`Copy ${currentPath.join(".")}`}
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
        className="group hover:bg-muted/30 flex cursor-pointer items-center gap-2 rounded px-1 py-0.5"
        style={{ paddingLeft: `${level * 16}px` }}
        onClick={toggleExpanded}
      >
        <button className="hover:bg-muted flex h-4 w-4 items-center justify-center rounded">
          {isExpanded ? (
            <ChevronDown className="text-muted-foreground h-3 w-3" />
          ) : (
            <ChevronRight className="text-muted-foreground h-3 w-3" />
          )}
        </button>

        {keyName && (
          <span className="text-muted-foreground font-medium">
            "{keyName}":
          </span>
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
          tooltip={`Copy ${currentPath.join(".") || "JSON"}`}
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

export function AdvancedJsonViewer({
  data,
  maxHeight = "600px",
  className = "",
  searchable = true,
}: AdvancedJsonViewerProps) {
  const [searchTerm, setSearchTerm] = useState("");

  const handleCopy = (value: string, path: string[]) => {
    console.log(`Copied ${path.join(".")}:`, value);
  };

  return (
    <div
      className={`border-border bg-background rounded-lg border ${className}`}
    >
      {searchable && (
        <div className="border-border border-b p-3">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
            <Input
              placeholder="Search keys and values..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
      )}

      <div
        className="scrollbar-thumb-border hover:scrollbar-thumb-muted-foreground scrollbar-thin scrollbar-track-transparent overflow-auto p-4 font-mono text-sm"
        style={{ maxHeight }}
      >
        <JsonNode
          data={data}
          level={0}
          path={[]}
          searchTerm={searchTerm}
          onCopy={handleCopy}
        />
      </div>
    </div>
  );
}
