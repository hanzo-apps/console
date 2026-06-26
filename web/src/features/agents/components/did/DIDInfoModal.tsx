import {
  Analytics,
  Bot,
  CheckmarkFilled,
  Function,
  Tools,
  Reset,
  Security,
  View,
} from "@/src/features/agents/components/ui/icon-bridge";
import { useState } from "react";
import { useDIDInfo } from "../../hooks/useDIDInfo";
import { copyDIDToClipboard, getDIDDocument } from "../../services/didApi";
import type { ReasonerDIDInfo, SkillDIDInfo } from "../../types/did";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { DIDIdentityBadge, DIDStatusBadge } from "./DIDStatusBadge";
import { Skeleton } from "../ui/skeleton";
import { ResponsiveGrid } from "../layout/ResponsiveGrid";

interface DIDInfoModalProps {
  nodeId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function DIDInfoModal({ nodeId, isOpen, onClose }: DIDInfoModalProps) {
  const { didInfo, loading, error, refetch } = useDIDInfo(nodeId);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [loadingDocument, setLoadingDocument] = useState<string | null>(null);

  const handleCopyDID = async (did: string, type: string) => {
    const success = await copyDIDToClipboard(did);
    if (success) {
      setCopyFeedback(`${type} DID copied to clipboard!`);
      setTimeout(() => setCopyFeedback(null), 3000);
    }
  };

  const handleViewDIDDocument = async (did: string) => {
    try {
      setLoadingDocument(did);
      const document = await getDIDDocument(did);

      // Open in new window for viewing
      const newWindow = window.open("", "_blank");
      if (newWindow) {
        newWindow.document.write(`
          <html>
            <head>
              <title>DID Document - ${did}</title>
              <style>
                body { font-family: monospace; padding: 20px; background: #f5f5f5; }
                pre { background: white; padding: 20px; border-radius: 8px; overflow: auto; }
              </style>
            </head>
            <body>
              <h1>DID Document</h1>
              <p><strong>DID:</strong> ${did}</p>
              <pre>${JSON.stringify(document, null, 2)}</pre>
            </body>
          </html>
        `);
        newWindow.document.close();
      }
    } catch (err) {
      console.error("Failed to fetch DID document:", err);
    } finally {
      setLoadingDocument(null);
    }
  };

  if (loading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="bg-popover border-border max-h-[80vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-3">
              <div className="bg-accent-primary/10 border-accent-primary/20 flex h-8 w-8 items-center justify-center rounded-lg border">
                <Security size={16} className="text-accent-primary" />
              </div>
              DID Information
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Loading DID details...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <ResponsiveGrid columns={{ base: 1, sm: 2 }} gap="sm">
                <Skeleton className="h-20 rounded-lg" />
                <Skeleton className="h-20 rounded-lg" />
              </ResponsiveGrid>
              <Skeleton className="h-32 rounded-lg" />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (error || !didInfo) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="bg-popover border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-3">
              <div className="bg-status-error/10 border-status-error/20 flex h-8 w-8 items-center justify-center rounded-lg border">
                <Security size={16} className="text-status-error" />
              </div>
              DID Information
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Failed to load DID information
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-6">
            <div className="py-8 text-center">
              <div className="bg-status-error/10 border-status-error/20 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-lg border">
                <Security size={24} className="text-status-error" />
              </div>
              <p className="text-status-error mb-4 font-medium">
                {error || "No DID information available"}
              </p>
              <Button
                onClick={refetch}
                variant="outline"
                className="flex items-center gap-2"
              >
                <Reset size={14} />
                Retry
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const reasoners =
    didInfo.reasoners &&
    typeof didInfo.reasoners === "object" &&
    didInfo.reasoners !== null
      ? Object.entries(didInfo.reasoners)
      : [];
  const skills =
    didInfo.skills &&
    typeof didInfo.skills === "object" &&
    didInfo.skills !== null
      ? Object.entries(didInfo.skills)
      : [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-popover border-border max-h-[90vh] max-w-6xl overflow-y-auto shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-3">
            <div className="bg-accent-primary/10 border-accent-primary/20 flex h-8 w-8 items-center justify-center rounded-lg border">
              <Security size={16} className="text-accent-primary" />
            </div>
            <span>DID Identity Information</span>
            <DIDStatusBadge status={didInfo.status} />
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Comprehensive DID identity details for agent node {nodeId}
          </DialogDescription>
        </DialogHeader>

        {/* Enhanced Copy Feedback */}
        {copyFeedback && (
          <div className="bg-status-success-bg border-status-success-border text-status-success animate-fade-in mb-6 rounded-xl border p-4 text-sm shadow-sm">
            <div className="flex items-center gap-3">
              <div className="bg-status-success/10 flex h-6 w-6 items-center justify-center rounded-full">
                <CheckmarkFilled size={14} className="text-status-success" />
              </div>
              <span className="font-medium">{copyFeedback}</span>
            </div>
          </div>
        )}

        <Tabs defaultValue="overview" className="w-full">
          <TabsList variant="underline" className="grid w-full grid-cols-4">
            <TabsTrigger value="overview" variant="underline">
              Overview
            </TabsTrigger>
            <TabsTrigger value="reasoners" variant="underline">
              Reasoners ({reasoners.length})
            </TabsTrigger>
            <TabsTrigger value="skills" variant="underline">
              Skills ({skills.length})
            </TabsTrigger>
            <TabsTrigger value="technical" variant="underline">
              Technical
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* Agent DID Card */}
              <Card className="bg-card border-card-border shadow-sm transition-shadow duration-200 hover:shadow-md">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-3">
                    <div className="bg-muted border-border flex h-8 w-8 items-center justify-center rounded-lg border">
                      <Bot size={16} className="text-muted-foreground" />
                    </div>
                    Agent DID
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <DIDIdentityBadge
                    did={didInfo.did}
                    maxLength={50}
                    onCopy={(did) => handleCopyDID(did, "Agent")}
                  />
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground font-medium">
                        Registered:
                      </span>
                      <span className="text-foreground">
                        {new Date(didInfo.registered_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground font-medium">
                        Hanzo Agents Server:
                      </span>
                      <span className="text-foreground font-mono text-xs">
                        {didInfo.agents_server_id}
                      </span>
                    </div>
                    <div className="flex items-start justify-between">
                      <span className="text-muted-foreground font-medium">
                        Derivation Path:
                      </span>
                      <span className="text-foreground max-w-[60%] text-right font-mono text-xs break-all">
                        {didInfo.derivation_path}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleViewDIDDocument(didInfo.did)}
                      disabled={loadingDocument === didInfo.did}
                      className="flex items-center gap-2"
                    >
                      <View size={14} />
                      {loadingDocument === didInfo.did
                        ? "Loading..."
                        : "View Document"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Summary Stats */}
              <Card className="bg-card border-card-border shadow-sm transition-shadow duration-200 hover:shadow-md">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-3">
                    <div className="bg-accent-primary/10 border-accent-primary/20 flex h-8 w-8 items-center justify-center rounded-lg border">
                      <Analytics size={16} className="text-accent-primary" />
                    </div>
                    Identity Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-muted border-border rounded-xl border p-4 text-center">
                      <div className="text-heading-1">{reasoners.length}</div>
                      <div className="text-body-small font-medium">
                        Reasoners
                      </div>
                    </div>
                    <div className="bg-muted border-border rounded-xl border p-4 text-center">
                      <div className="text-heading-1">{skills.length}</div>
                      <div className="text-body-small font-medium">Skills</div>
                    </div>
                  </div>
                  <div className="bg-muted border-border rounded-xl border p-4 text-center">
                    <div className="text-heading-3">
                      Total Components: {reasoners.length + skills.length + 1}
                    </div>
                    <div className="text-body-small">Including agent DID</div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Reasoners Tab */}
          <TabsContent value="reasoners" className="space-y-4">
            {reasoners.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {reasoners.map(([functionName, reasoner]) => (
                  <ReasonerDIDCard
                    key={functionName}
                    functionName={functionName}
                    reasoner={reasoner}
                    onCopyDID={(did) => handleCopyDID(did, "Reasoner")}
                    onViewDocument={() => handleViewDIDDocument(reasoner.did)}
                    loadingDocument={loadingDocument === reasoner.did}
                  />
                ))}
              </div>
            ) : (
              <div className="py-16 text-center">
                <div className="bg-muted border-border mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-lg border">
                  <Function size={32} className="text-muted-foreground" />
                </div>
                <h3 className="text-heading-3 text-foreground mb-2">
                  No Reasoners
                </h3>
                <p className="text-muted-foreground">
                  This agent has no reasoners with DID identities.
                </p>
              </div>
            )}
          </TabsContent>

          {/* Skills Tab */}
          <TabsContent value="skills" className="space-y-4">
            {skills.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {skills.map(([functionName, skill]) => (
                  <SkillDIDCard
                    key={functionName}
                    functionName={functionName}
                    skill={skill}
                    onCopyDID={(did) => handleCopyDID(did, "Skill")}
                    onViewDocument={() => handleViewDIDDocument(skill.did)}
                    loadingDocument={loadingDocument === skill.did}
                  />
                ))}
              </div>
            ) : (
              <div className="py-16 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-lg border border-purple-500/20 bg-purple-500/10">
                  <Tools size={32} className="text-purple-500" />
                </div>
                <h3 className="text-heading-3 text-foreground mb-2">
                  No Skills
                </h3>
                <p className="text-muted-foreground">
                  This agent has no skills with DID identities.
                </p>
              </div>
            )}
          </TabsContent>

          {/* Technical Tab */}
          <TabsContent value="technical" className="space-y-6">
            <Card className="bg-card border-card-border shadow-sm transition-shadow duration-200 hover:shadow-md">
              <CardHeader>
                <CardTitle className="text-foreground flex items-center gap-3">
                  <div className="bg-accent-primary/10 border-accent-primary/20 flex h-8 w-8 items-center justify-center rounded-lg border">
                    <Security size={16} className="text-accent-primary" />
                  </div>
                  Technical Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div>
                    <h4 className="text-foreground mb-3 font-semibold">
                      Agent Public Key (JWK)
                    </h4>
                    <pre className="bg-muted border-border text-foreground max-h-40 overflow-auto rounded-lg border p-4 font-mono text-xs">
                      {JSON.stringify(didInfo.public_key_jwk, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <h4 className="text-foreground mb-3 font-semibold">
                      System Information
                    </h4>
                    <dl className="space-y-3 text-sm">
                      <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground font-medium">
                          Node ID:
                        </dt>
                        <dd className="text-foreground max-w-[60%] text-right font-mono break-all">
                          {didInfo.agent_node_id}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground font-medium">
                          Hanzo Agents Server:
                        </dt>
                        <dd className="text-foreground max-w-[60%] text-right font-mono break-all">
                          {didInfo.agents_server_id}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-muted-foreground font-medium">
                          Status:
                        </dt>
                        <dd>
                          <DIDStatusBadge status={didInfo.status} size="sm" />
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between border-t pt-4">
          <Button variant="outline" onClick={refetch}>
            Refresh Data
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ReasonerDIDCardProps {
  functionName: string;
  reasoner: ReasonerDIDInfo;
  onCopyDID: (did: string) => void;
  onViewDocument: () => void;
  loadingDocument: boolean;
}

function ReasonerDIDCard({
  functionName,
  reasoner,
  onCopyDID,
  onViewDocument,
  loadingDocument,
}: ReasonerDIDCardProps) {
  return (
    <Card className="bg-card border-card-border shadow-sm transition-shadow duration-200 hover:shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-foreground flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <div className="bg-muted border-border flex h-6 w-6 items-center justify-center rounded-md border">
              <Function size={14} className="text-muted-foreground" />
            </div>
            {functionName}
          </span>
          <Badge
            variant="outline"
            className="bg-muted text-muted-foreground border-border font-medium"
          >
            {reasoner.exposure_level}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <DIDIdentityBadge
          did={reasoner.did}
          maxLength={40}
          onCopy={onCopyDID}
        />

        {reasoner.capabilities.length > 0 && (
          <div>
            <div className="text-muted-foreground mb-2 text-sm font-medium">
              Capabilities:
            </div>
            <div className="flex flex-wrap gap-2">
              {reasoner.capabilities.map((capability, index) => (
                <Badge
                  key={index}
                  variant="secondary"
                  className="bg-muted text-muted-foreground border-border border text-xs"
                >
                  {capability}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onViewDocument}
            disabled={loadingDocument}
            className="flex items-center gap-2 text-xs"
          >
            <View size={12} />
            {loadingDocument ? "Loading..." : "View Document"}
          </Button>
        </div>

        <div className="text-body-small">
          Created: {new Date(reasoner.created_at).toLocaleDateString()}
        </div>
      </CardContent>
    </Card>
  );
}

interface SkillDIDCardProps {
  functionName: string;
  skill: SkillDIDInfo;
  onCopyDID: (did: string) => void;
  onViewDocument: () => void;
  loadingDocument: boolean;
}

function SkillDIDCard({
  functionName,
  skill,
  onCopyDID,
  onViewDocument,
  loadingDocument,
}: SkillDIDCardProps) {
  return (
    <Card className="bg-card border-card-border shadow-sm transition-shadow duration-200 hover:shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-foreground flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md border border-purple-500/20 bg-purple-500/10">
              <Tools size={14} className="text-purple-500" />
            </div>
            {functionName}
          </span>
          <Badge
            variant="outline"
            className="border-purple-500/20 bg-purple-500/10 font-medium text-purple-500"
          >
            {skill.exposure_level}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <DIDIdentityBadge did={skill.did} maxLength={40} onCopy={onCopyDID} />

        {skill.tags.length > 0 && (
          <div>
            <div className="text-muted-foreground mb-2 text-sm font-medium">
              Tags:
            </div>
            <div className="flex flex-wrap gap-2">
              {skill.tags.map((tag, index) => (
                <Badge
                  key={index}
                  variant="secondary"
                  className="border border-purple-500/20 bg-purple-500/10 text-xs text-purple-500"
                >
                  #{tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onViewDocument}
            disabled={loadingDocument}
            className="flex items-center gap-2 text-xs"
          >
            <View size={12} />
            {loadingDocument ? "Loading..." : "View Document"}
          </Button>
        </div>

        <div className="text-body-small">
          Created: {new Date(skill.created_at).toLocaleDateString()}
        </div>
      </CardContent>
    </Card>
  );
}
