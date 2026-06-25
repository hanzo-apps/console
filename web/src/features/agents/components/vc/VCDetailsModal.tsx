import { useState } from "react";
import {
  useVCVerification,
  useWorkflowVCChain,
} from "../../hooks/useVCVerification";
import { copyVCToClipboard, downloadVCDocument } from "../../services/vcApi";
import type {
  ExecutionVC,
  VCDocument,
  WorkflowVCChainResponse,
} from "../../types/did";
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
import { VCStatusIndicator } from "./VCStatusIndicator";
import { normalizeExecutionStatus } from "../../utils/status";
import { Skeleton } from "../ui/skeleton";

interface VCDetailsModalProps {
  workflowId?: string;
  executionVC?: ExecutionVC;
  isOpen: boolean;
  onClose: () => void;
}

export function VCDetailsModal({
  workflowId,
  executionVC,
  isOpen,
  onClose,
}: VCDetailsModalProps) {
  const {
    vcChain,
    loading: chainLoading,
    error: chainError,
  } = useWorkflowVCChain(workflowId || "");
  const {
    verifyVCDocument,
    loading: verifyLoading,
    verificationResult,
  } = useVCVerification();
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);

  // Determine which VC to show
  const targetVC = executionVC || vcChain?.component_vcs?.[0];
  const showChain = !!workflowId && !executionVC;
  const normalizedTargetStatus = targetVC
    ? normalizeExecutionStatus(targetVC.status)
    : null;

  const handleCopyVC = async (vc: ExecutionVC) => {
    try {
      const success = await copyVCToClipboard(vc);
      if (success) {
        setCopyFeedback("VC document copied to clipboard!");
        setTimeout(() => setCopyFeedback(null), 3000);
      }
    } catch (error) {
      setCopyFeedback("Failed to copy VC document");
      setTimeout(() => setCopyFeedback(null), 3000);
    }
  };

  const handleDownloadVC = async (vc: ExecutionVC) => {
    try {
      await downloadVCDocument(vc);
      setDownloadFeedback("VC document downloaded successfully!");
      setTimeout(() => setDownloadFeedback(null), 3000);
    } catch (error) {
      setDownloadFeedback("Failed to download VC document");
      setTimeout(() => setDownloadFeedback(null), 3000);
    }
  };

  const handleVerifyVC = async (vc: ExecutionVC) => {
    try {
      const vcDocument =
        typeof vc.vc_document === "string"
          ? JSON.parse(vc.vc_document)
          : vc.vc_document;
      await verifyVCDocument(vcDocument);
    } catch (error) {
      console.error("Verification failed:", error);
    }
  };

  if (chainLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>VC Details</DialogTitle>
            <DialogDescription>
              Loading verification credentials...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (chainError || (!targetVC && !chainLoading)) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>VC Details</DialogTitle>
            <DialogDescription>
              Failed to load verification credentials
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="py-8 text-center">
              <p className="mb-4 text-red-600">
                {chainError || "No verification credentials found"}
              </p>
              <Button onClick={onClose} variant="outline">
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>🔒</span>
            <span>Verifiable Credential Details</span>
            {targetVC && (
              <VCStatusIndicator
                status={{
                  has_vcs: true,
                  vc_count: 1,
                  verified_count:
                    normalizedTargetStatus === "succeeded" ? 1 : 0,
                  failed_count: normalizedTargetStatus === "failed" ? 1 : 0,
                  last_vc_created: targetVC.created_at,
                  verification_status:
                    normalizedTargetStatus === "succeeded"
                      ? "verified"
                      : normalizedTargetStatus === "failed"
                        ? "failed"
                        : "pending",
                }}
                showDetails={false}
              />
            )}
          </DialogTitle>
          <DialogDescription>
            {showChain
              ? `Verification credential chain for workflow ${workflowId}`
              : `Verification credential for execution ${targetVC?.execution_id}`}
          </DialogDescription>
        </DialogHeader>

        {/* Feedback Messages */}
        {(copyFeedback || downloadFeedback) && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            ✅ {copyFeedback || downloadFeedback}
          </div>
        )}

        {showChain ? (
          <VCChainView
            vcChain={vcChain!}
            onCopyVC={handleCopyVC}
            onDownloadVC={handleDownloadVC}
          />
        ) : (
          <SingleVCView
            vc={targetVC!}
            onCopyVC={handleCopyVC}
            onDownloadVC={handleDownloadVC}
            onVerifyVC={handleVerifyVC}
            verificationResult={verificationResult}
            verifyLoading={verifyLoading}
          />
        )}

        <div className="flex justify-end border-t pt-4">
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface VCChainViewProps {
  vcChain: WorkflowVCChainResponse;
  onCopyVC: (vc: ExecutionVC) => void;
  onDownloadVC: (vc: ExecutionVC) => void;
}

function VCChainView({ vcChain, onCopyVC, onDownloadVC }: VCChainViewProps) {
  const [selectedVC, setSelectedVC] = useState<ExecutionVC | null>(
    vcChain.component_vcs[0] || null,
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* VC List */}
      <div className="lg:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Execution VCs ({vcChain.component_vcs.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-96 space-y-2 overflow-y-auto">
            {vcChain.component_vcs.map((vc) => (
              <div
                key={vc.vc_id}
                className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                  selectedVC?.vc_id === vc.vc_id
                    ? "border-primary bg-muted"
                    : "border-gray-200 hover:border-gray-300"
                }`}
                onClick={() => setSelectedVC(vc)}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {vc.execution_id.substring(0, 8)}...
                  </span>
                  <Badge
                    variant={
                      normalizeExecutionStatus(vc.status) === "succeeded"
                        ? "default"
                        : "secondary"
                    }
                    className="text-xs"
                  >
                    {vc.status}
                  </Badge>
                </div>
                <div className="text-body-small">
                  {new Date(vc.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Selected VC Details */}
      <div className="lg:col-span-2">
        {selectedVC ? (
          <SingleVCView
            vc={selectedVC}
            onCopyVC={onCopyVC}
            onDownloadVC={onDownloadVC}
            compact
          />
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="text-muted-foreground/70 mb-4 text-4xl">🔒</div>
              <p className="text-muted-foreground">
                Select a VC to view details
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

interface SingleVCViewProps {
  vc: ExecutionVC;
  onCopyVC: (vc: ExecutionVC) => void;
  onDownloadVC: (vc: ExecutionVC) => void;
  onVerifyVC?: (vc: ExecutionVC) => void;
  verificationResult?: any;
  verifyLoading?: boolean;
  compact?: boolean;
}

function SingleVCView({
  vc,
  onCopyVC,
  onDownloadVC,
  onVerifyVC,
  verificationResult,
  verifyLoading,
}: SingleVCViewProps) {
  const vcDocument: VCDocument =
    typeof vc.vc_document === "string"
      ? JSON.parse(vc.vc_document)
      : vc.vc_document;

  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList variant="underline" className="grid w-full grid-cols-4">
        <TabsTrigger value="overview" variant="underline">
          Overview
        </TabsTrigger>
        <TabsTrigger value="credential" variant="underline">
          Credential
        </TabsTrigger>
        <TabsTrigger value="verification" variant="underline">
          Verification
        </TabsTrigger>
        <TabsTrigger value="raw" variant="underline">
          Raw Data
        </TabsTrigger>
      </TabsList>

      {/* Overview Tab */}
      <TabsContent value="overview" className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">VC Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground font-medium">
                    VC ID:
                  </span>
                  <span className="ml-2 font-mono text-xs">{vc.vc_id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium">
                    Execution ID:
                  </span>
                  <span className="ml-2 font-mono text-xs">
                    {vc.execution_id}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium">
                    Workflow ID:
                  </span>
                  <span className="ml-2 font-mono text-xs">
                    {vc.workflow_id}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium">
                    Status:
                  </span>
                  <Badge
                    variant={
                      normalizeExecutionStatus(vc.status) === "succeeded"
                        ? "default"
                        : "secondary"
                    }
                    className="ml-2 text-xs"
                  >
                    {vc.status}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium">
                    Created:
                  </span>
                  <span className="ml-2">
                    {new Date(vc.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Identity Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground font-medium">
                    Issuer DID:
                  </span>
                  <div className="mt-1 rounded bg-gray-50 p-2 font-mono text-xs break-all">
                    {vc.issuer_did}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium">
                    Target DID:
                  </span>
                  <div className="mt-1 rounded bg-gray-50 p-2 font-mono text-xs break-all">
                    {vc.target_did}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium">
                    Caller DID:
                  </span>
                  <div className="mt-1 rounded bg-gray-50 p-2 font-mono text-xs break-all">
                    {vc.caller_did}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onCopyVC(vc)}>
            📋 Copy VC
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDownloadVC(vc)}>
            💾 Download
          </Button>
          {onVerifyVC && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onVerifyVC(vc)}
              disabled={verifyLoading}
            >
              {verifyLoading ? "Verifying..." : "🔍 Verify"}
            </Button>
          )}
        </div>
      </TabsContent>

      {/* Credential Tab */}
      <TabsContent value="credential" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credential Subject</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <h4 className="mb-2 font-medium">Execution Details</h4>
                <dl className="space-y-1 text-sm">
                  <div>
                    <dt className="text-muted-foreground font-medium">
                      Input Hash:
                    </dt>
                    <dd className="font-mono text-xs">
                      {vcDocument.credentialSubject.execution.inputHash}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-medium">
                      Output Hash:
                    </dt>
                    <dd className="font-mono text-xs">
                      {vcDocument.credentialSubject.execution.outputHash}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-medium">
                      Duration:
                    </dt>
                    <dd>
                      {vcDocument.credentialSubject.execution.durationMs}ms
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-medium">
                      Status:
                    </dt>
                    <dd>{vcDocument.credentialSubject.execution.status}</dd>
                  </div>
                </dl>
              </div>
              <div>
                <h4 className="mb-2 font-medium">Audit Information</h4>
                <dl className="space-y-1 text-sm">
                  <div>
                    <dt className="text-muted-foreground font-medium">
                      Input Data Hash:
                    </dt>
                    <dd className="font-mono text-xs">
                      {vcDocument.credentialSubject.audit.inputDataHash}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-medium">
                      Output Data Hash:
                    </dt>
                    <dd className="font-mono text-xs">
                      {vcDocument.credentialSubject.audit.outputDataHash}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Verification Tab */}
      <TabsContent value="verification" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cryptographic Proof</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <h4 className="mb-2 font-medium">Proof Details</h4>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground font-medium">Type:</dt>
                    <dd>{vcDocument.proof.type}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-medium">
                      Created:
                    </dt>
                    <dd>
                      {new Date(vcDocument.proof.created).toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-medium">
                      Purpose:
                    </dt>
                    <dd>{vcDocument.proof.proofPurpose}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-medium">
                      Verification Method:
                    </dt>
                    <dd className="font-mono text-xs break-all">
                      {vcDocument.proof.verificationMethod}
                    </dd>
                  </div>
                </dl>
              </div>
              <div>
                <h4 className="mb-2 font-medium">Signature</h4>
                <div className="max-h-32 overflow-y-auto rounded bg-gray-50 p-3 font-mono text-xs break-all">
                  {vcDocument.proof.proofValue}
                </div>
              </div>
            </div>

            {verificationResult && (
              <div
                className={`rounded-lg p-3 ${
                  verificationResult.valid
                    ? "border border-green-200 bg-green-50"
                    : "border border-red-200 bg-red-50"
                }`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={
                      verificationResult.valid
                        ? "text-green-600"
                        : "text-red-600"
                    }
                  >
                    {verificationResult.valid ? "✅" : "❌"}
                  </span>
                  <span
                    className={`font-medium ${
                      verificationResult.valid
                        ? "text-green-700"
                        : "text-red-700"
                    }`}
                  >
                    {verificationResult.valid
                      ? "Verification Successful"
                      : "Verification Failed"}
                  </span>
                </div>
                {verificationResult.message && (
                  <p className="text-body-small">
                    {verificationResult.message}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Raw Data Tab */}
      <TabsContent value="raw" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Raw VC Document</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded border bg-gray-50 p-4 text-xs">
              {JSON.stringify(vcDocument, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
