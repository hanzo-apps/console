import React from "react";
import {
  ArrowsOutSimple,
  CornersIn,
  X,
} from "@/src/features/agents/components/ui/icon-bridge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { AdvancedJsonViewer } from "./AdvancedJsonViewer";

interface EnhancedModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  maxWidth?: string;
  maxHeight?: string;
  resizable?: boolean;
}

interface DataModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  data: any;
}

function EnhancedModal({
  isOpen,
  onClose,
  title,
  icon: Icon,
  children,
  maxWidth = "90vw",
  maxHeight = "90vh",
  resizable = true,
}: EnhancedModalProps) {
  const [isMaximized, setIsMaximized] = React.useState(false);

  const modalWidth = isMaximized ? "100vw" : maxWidth;
  const modalHeight = isMaximized ? "100vh" : maxHeight;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="flex flex-col overflow-hidden p-0"
        style={{
          maxWidth: modalWidth,
          maxHeight: modalHeight,
          width: modalWidth,
          height: modalHeight,
        }}
      >
        {/* Header - Fixed */}
        <DialogHeader className="border-border bg-background/95 flex-shrink-0 border-b backdrop-blur-sm">
          <div className="flex items-center justify-between p-4">
            <DialogTitle className="text-heading-3 flex items-center gap-3">
              {Icon && <Icon className="h-5 w-5" />}
              {title}
            </DialogTitle>

            <div className="flex items-center gap-2">
              {resizable && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsMaximized(!isMaximized)}
                  className="h-8 w-8 p-0"
                  title={isMaximized ? "Restore" : "Maximize"}
                >
                  {isMaximized ? (
                    <CornersIn className="h-4 w-4" />
                  ) : (
                    <ArrowsOutSimple className="h-4 w-4" />
                  )}
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-8 w-8 p-0"
                title="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Content - Scrollable */}
        <div className="scrollbar-thumb-border flex-1 scrollbar-thin scrollbar-track-transparent overflow-auto">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DataModal({
  isOpen,
  onClose,
  title,
  icon,
  data,
}: DataModalProps) {
  const [viewMode, setViewMode] = React.useState<
    "formatted" | "raw" | "markdown"
  >("formatted");

  const jsonString = React.useMemo(() => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }, [data]);

  // Detect if data might contain markdown
  const hasMarkdownLikeContent = React.useMemo(() => {
    if (typeof data === "string") {
      return (
        data.includes("**") ||
        data.includes("*") ||
        data.includes("`") ||
        data.includes("#")
      );
    }
    return false;
  }, [data]);

  const MarkdownRenderer = ({ content }: { content: string }) => {
    const formattedContent = React.useMemo(() => {
      return content
        .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>')
        .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
        .replace(
          /`(.*?)`/g,
          '<code class="bg-muted px-1 rounded text-sm font-mono">$1</code>',
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
        className="prose prose-sm text-foreground max-w-none"
        dangerouslySetInnerHTML={{ __html: `<p>${formattedContent}</p>` }}
      />
    );
  };

  return (
    <EnhancedModal
      isOpen={isOpen}
      onClose={onClose}
      title={`${title} - Full View`}
      icon={icon}
      maxWidth="90vw"
      maxHeight="90vh"
    >
      <div className="flex h-full flex-col">
        {/* Tab Navigation - Fixed */}
        <div className="border-border bg-background/95 flex-shrink-0 border-b">
          <Tabs
            value={viewMode}
            onValueChange={(value) => setViewMode(value as any)}
            className="w-full"
          >
            <TabsList
              variant="underline"
              className="grid h-12 w-full grid-cols-3"
            >
              <TabsTrigger
                value="formatted"
                variant="underline"
                className="justify-center"
              >
                Formatted View
              </TabsTrigger>
              <TabsTrigger
                value="raw"
                variant="underline"
                className="justify-center"
              >
                Raw JSON
              </TabsTrigger>
              {hasMarkdownLikeContent && (
                <TabsTrigger
                  value="markdown"
                  variant="underline"
                  className="justify-center"
                >
                  Markdown Preview
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        </div>

        {/* Tab Content - Scrollable */}
        <div className="scrollbar-thumb-border flex-1 scrollbar-thin scrollbar-track-transparent overflow-auto">
          <Tabs value={viewMode} className="h-full">
            <TabsContent
              value="formatted"
              className="scrollbar-thumb-border m-0 h-full scrollbar-thin scrollbar-track-transparent overflow-auto p-4"
            >
              <div className="scrollbar-thumb-border h-full scrollbar-thin scrollbar-track-transparent overflow-auto">
                <AdvancedJsonViewer
                  data={data}
                  maxHeight="100%"
                  searchable={true}
                  className="h-full border-0"
                />
              </div>
            </TabsContent>

            <TabsContent
              value="raw"
              className="scrollbar-thumb-border m-0 h-full scrollbar-thin scrollbar-track-transparent overflow-auto p-4"
            >
              <div className="border-border bg-background scrollbar-thumb-border h-full scrollbar-thin scrollbar-track-transparent overflow-auto rounded-lg border">
                <div className="scrollbar-thumb-border hover:scrollbar-thumb-muted-foreground h-full scrollbar-thin scrollbar-track-transparent overflow-auto p-4">
                  <pre className="text-foreground font-mono text-sm leading-relaxed whitespace-pre-wrap">
                    {jsonString}
                  </pre>
                </div>
              </div>
            </TabsContent>

            {hasMarkdownLikeContent && (
              <TabsContent
                value="markdown"
                className="scrollbar-thumb-border m-0 h-full scrollbar-thin scrollbar-track-transparent overflow-auto p-4"
              >
                <div className="border-border bg-background scrollbar-thumb-border h-full scrollbar-thin scrollbar-track-transparent overflow-auto rounded-lg border">
                  <div className="scrollbar-thumb-border hover:scrollbar-thumb-muted-foreground h-full scrollbar-thin scrollbar-track-transparent overflow-auto p-4">
                    <MarkdownRenderer
                      content={typeof data === "string" ? data : jsonString}
                    />
                  </div>
                </div>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </div>
    </EnhancedModal>
  );
}

export { EnhancedModal };
