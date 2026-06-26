import {
  CheckmarkFilled,
  CloseFilled,
  Copy,
  Download,
  Security,
  Time,
  WarningFilled,
} from "@/src/features/agents/components/ui/icon-bridge";
import { useState } from "react";
import { cn } from "../../lib/utils";
import {
  copyVCToClipboard,
  downloadVCDocument,
  exportWorkflowComplianceReport,
  verifyExecutionVCComprehensive,
  verifyWorkflowVCComprehensive,
} from "../../services/vcApi";
import type {
  ExecutionVC,
  WorkflowVC,
  ComprehensiveVCVerificationResult,
} from "../../types/did";

interface VerifiableCredentialBadgeProps {
  hasVC: boolean;
  status: string;
  vcData?: ExecutionVC | WorkflowVC;
  workflowId?: string; // For workflow-level VCs
  executionId?: string; // For execution-level VCs
  showCopyButton?: boolean; // Show copy button for detail pages
  showVerifyButton?: boolean; // Show verify button for detail pages
  variant?: "table" | "detail"; // New prop to control styling
  className?: string;
}

interface VerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  verificationResult: ComprehensiveVCVerificationResult | null;
  isLoading: boolean;
  error: string | null;
}

function VerificationModal({
  isOpen,
  onClose,
  verificationResult,
  isLoading,
  error,
}: VerificationModalProps) {
  if (!isOpen) return null;

  const getScoreColor = (score: number) => {
    if (score >= 90) return "text-green-600";
    if (score >= 70) return "text-yellow-600";
    return "text-red-600";
  };

  const getSeverityIcon = (severity: "critical" | "warning" | "info") => {
    switch (severity) {
      case "critical":
        return <CloseFilled size={16} className="text-red-500" />;
      case "warning":
        return <WarningFilled size={16} className="text-yellow-500" />;
      case "info":
        return <Security size={16} className="text-muted-foreground" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="bg-card border-border mx-4 max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-lg border shadow-2xl">
        <div className="border-border bg-muted flex items-center justify-between border-b p-6">
          <h2 className="text-heading-2">VC Verification Results</h2>
          <button
            onClick={onClose}
            className="hover:bg-muted-foreground/10 text-muted-foreground rounded-lg p-2 transition-colors"
          >
            <CloseFilled size={20} />
          </button>
        </div>

        <div className="bg-card max-h-[calc(90vh-120px)] overflow-y-auto p-6">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="border-primary h-8 w-8 animate-spin rounded-full border-b-2"></div>
              <span className="text-foreground ml-3">Verifying VC...</span>
            </div>
          )}

          {error && (
            <div className="status-error rounded-lg p-4">
              <div className="flex items-center">
                <CloseFilled size={20} className="mr-2 text-red-500" />
                <span className="font-medium">Verification Failed</span>
              </div>
              <p className="mt-2 text-sm">{error}</p>
            </div>
          )}

          {verificationResult && (
            <div className="space-y-6">
              {/* Overall Status */}
              <div className="bg-muted rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    {verificationResult.valid ? (
                      <CheckmarkFilled
                        size={24}
                        className="mr-3 text-green-500"
                      />
                    ) : (
                      <CloseFilled size={24} className="mr-3 text-red-500" />
                    )}
                    <div>
                      <h3 className="text-heading-3">
                        {verificationResult.valid ? "Valid VC" : "Invalid VC"}
                      </h3>
                      <p className="text-body-small">
                        Verified at{" "}
                        {new Date(
                          verificationResult.verification_timestamp,
                        ).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={cn(
                        "text-heading-1",
                        getScoreColor(verificationResult.overall_score),
                      )}
                    >
                      {verificationResult.overall_score}/100
                    </div>
                    <p className="text-body-small">Overall Score</p>
                  </div>
                </div>
              </div>

              {/* Critical Issues */}
              {verificationResult.critical_issues.length > 0 && (
                <div className="status-error rounded-lg p-4">
                  <h4 className="mb-3 font-medium">
                    Critical Issues ({verificationResult.critical_issues.length}
                    )
                  </h4>
                  <div className="space-y-2">
                    {verificationResult.critical_issues.map((issue, index) => (
                      <div key={index} className="flex items-start">
                        {getSeverityIcon(issue.severity)}
                        <div className="ml-2">
                          <p className="text-body text-text-primary font-medium">
                            {issue.type}
                          </p>
                          <p className="text-body-small">{issue.description}</p>
                          {issue.component && (
                            <p className="text-body-small">
                              Component: {issue.component}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {verificationResult.warnings.length > 0 && (
                <div className="status-warning rounded-lg p-4">
                  <h4 className="text-heading-3 mb-3">
                    Warnings ({verificationResult.warnings.length})
                  </h4>
                  <div className="space-y-2">
                    {verificationResult.warnings.map((issue, index) => (
                      <div key={index} className="flex items-start">
                        {getSeverityIcon(issue.severity)}
                        <div className="ml-2">
                          <p className="text-body text-text-primary font-medium">
                            {issue.type}
                          </p>
                          <p className="text-body-small">{issue.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Detailed Results */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {/* Integrity Checks */}
                <div className="bg-card border-border rounded-lg border p-4">
                  <h4 className="text-heading-3 text-foreground mb-3">
                    Integrity Checks
                  </h4>
                  <div className="text-body space-y-2">
                    <div className="flex justify-between">
                      <span>Metadata Consistency</span>
                      {verificationResult.integrity_checks
                        .metadata_consistency ? (
                        <CheckmarkFilled size={16} className="text-green-500" />
                      ) : (
                        <CloseFilled size={16} className="text-red-500" />
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span>Field Consistency</span>
                      {verificationResult.integrity_checks.field_consistency ? (
                        <CheckmarkFilled size={16} className="text-green-500" />
                      ) : (
                        <CloseFilled size={16} className="text-red-500" />
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span>Timestamp Validation</span>
                      {verificationResult.integrity_checks
                        .timestamp_validation ? (
                        <CheckmarkFilled size={16} className="text-green-500" />
                      ) : (
                        <CloseFilled size={16} className="text-red-500" />
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span>Hash Validation</span>
                      {verificationResult.integrity_checks.hash_validation ? (
                        <CheckmarkFilled size={16} className="text-green-500" />
                      ) : (
                        <CloseFilled size={16} className="text-red-500" />
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span>Structural Integrity</span>
                      {verificationResult.integrity_checks
                        .structural_integrity ? (
                        <CheckmarkFilled size={16} className="text-green-500" />
                      ) : (
                        <CloseFilled size={16} className="text-red-500" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Security Analysis */}
                <div className="bg-card border-border rounded-lg border p-4">
                  <h4 className="text-heading-3 text-foreground mb-3">
                    Security Analysis
                  </h4>
                  <div className="text-body space-y-2">
                    <div className="flex justify-between">
                      <span>Signature Strength</span>
                      <span className="text-body-small bg-muted rounded px-2 py-1">
                        {
                          verificationResult.security_analysis
                            .signature_strength
                        }
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Key Validation</span>
                      {verificationResult.security_analysis.key_validation ? (
                        <CheckmarkFilled size={16} className="text-green-500" />
                      ) : (
                        <CloseFilled size={16} className="text-red-500" />
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span>DID Authenticity</span>
                      {verificationResult.security_analysis.did_authenticity ? (
                        <CheckmarkFilled size={16} className="text-green-500" />
                      ) : (
                        <CloseFilled size={16} className="text-red-500" />
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span>Replay Protection</span>
                      {verificationResult.security_analysis
                        .replay_protection ? (
                        <CheckmarkFilled size={16} className="text-green-500" />
                      ) : (
                        <CloseFilled size={16} className="text-red-500" />
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span>Security Score</span>
                      <span
                        className={cn(
                          "font-medium",
                          getScoreColor(
                            verificationResult.security_analysis.security_score,
                          ),
                        )}
                      >
                        {verificationResult.security_analysis.security_score}
                        /100
                      </span>
                    </div>
                  </div>
                </div>

                {/* Compliance Checks */}
                <div className="bg-card border-border rounded-lg border p-4">
                  <h4 className="text-foreground mb-3 font-medium">
                    Compliance Checks
                  </h4>
                  <div className="text-body-small space-y-2">
                    <div className="flex justify-between">
                      <span>W3C Compliance</span>
                      {verificationResult.compliance_checks.w3c_compliance ? (
                        <CheckmarkFilled size={16} className="text-green-500" />
                      ) : (
                        <CloseFilled size={16} className="text-red-500" />
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span>Hanzo Agents Standard</span>
                      {verificationResult.compliance_checks
                        .agents_standard_compliance ? (
                        <CheckmarkFilled size={16} className="text-green-500" />
                      ) : (
                        <CloseFilled size={16} className="text-red-500" />
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span>Audit Trail</span>
                      {verificationResult.compliance_checks
                        .audit_trail_integrity ? (
                        <CheckmarkFilled size={16} className="text-green-500" />
                      ) : (
                        <CloseFilled size={16} className="text-red-500" />
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span>Data Integrity</span>
                      {verificationResult.compliance_checks
                        .data_integrity_checks ? (
                        <CheckmarkFilled size={16} className="text-green-500" />
                      ) : (
                        <CloseFilled size={16} className="text-red-500" />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Tamper Evidence */}
              {verificationResult.security_analysis.tamper_evidence.length >
                0 && (
                <div className="status-error rounded-lg p-4">
                  <h4 className="mb-3 font-medium">Tamper Evidence Detected</h4>
                  <ul className="list-inside list-disc space-y-1 text-sm">
                    {verificationResult.security_analysis.tamper_evidence.map(
                      (evidence, index) => (
                        <li key={index}>{evidence}</li>
                      ),
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function VerifiableCredentialBadge({
  hasVC,
  status,
  vcData,
  workflowId,
  executionId,
  showCopyButton = false,
  showVerifyButton = false,
  variant = "table",
  className = "",
}: VerifiableCredentialBadgeProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [verificationResult, setVerificationResult] =
    useState<ComprehensiveVCVerificationResult | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(
    null,
  );

  const handleVerify = async () => {
    if (!executionId && !workflowId) return;

    setIsVerifying(true);
    setVerificationError(null);
    setVerificationResult(null);
    setShowVerificationModal(true);

    try {
      if (executionId) {
        const result = await verifyExecutionVCComprehensive(executionId);
        setVerificationResult(result);
      } else if (workflowId) {
        const result = await verifyWorkflowVCComprehensive(workflowId);
        setVerificationResult(result);
      }
    } catch (error) {
      console.error("Failed to verify VC:", error);
      setVerificationError(
        error instanceof Error ? error.message : "Verification failed",
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDownload = async () => {
    if (!vcData && !workflowId && !executionId) return;

    setIsDownloading(true);
    try {
      if (workflowId) {
        await exportWorkflowComplianceReport(workflowId, "json");
      } else if (executionId) {
        const { getExecutionVCDocumentEnhanced } =
          await import("../../services/vcApi");
        const enhancedChain = await getExecutionVCDocumentEnhanced(executionId);

        const blob = new Blob([JSON.stringify(enhancedChain, null, 2)], {
          type: "application/json",
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `execution-vc-${executionId}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else if (vcData && "vc_document" in vcData && vcData.vc_document) {
        const vcId = "vc_id" in vcData ? (vcData.vc_id as string) : "";
        const statusValue = "status" in vcData ? (vcData.status as string) : "";
        const createdAt =
          "created_at" in vcData
            ? (vcData.created_at as string)
            : "start_time" in vcData
              ? (vcData.start_time as string)
              : "";

        const executionVC: ExecutionVC = {
          vc_id: vcId,
          execution_id: "",
          workflow_id: "",
          session_id: "",
          issuer_did: "",
          target_did: "",
          caller_did: "",
          vc_document: vcData.vc_document,
          signature: "",
          input_hash: "",
          output_hash: "",
          status: statusValue,
          created_at: createdAt,
        };
        await downloadVCDocument(executionVC);
      }
    } catch (error) {
      console.error("Failed to download:", error);
      alert(
        `Download failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopy = async () => {
    if (!vcData) return;

    setIsCopying(true);
    try {
      const success = await copyVCToClipboard(vcData as ExecutionVC);
      if (success) {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      }
    } catch (error) {
      console.error("Failed to copy:", error);
    } finally {
      setIsCopying(false);
    }
  };

  // Table variant - minimal, just icon
  if (variant === "table") {
    if (!hasVC || !status || status === "none") {
      return (
        <div
          className={cn("flex items-center justify-center", className)}
          title="No VC available"
        >
          <CloseFilled size={14} className="text-red-400/70" />
        </div>
      );
    }

    return (
      <div
        className={cn("flex items-center justify-center", className)}
        title="VC available"
      >
        <CheckmarkFilled
          size={14}
          className="text-gray-600 dark:text-gray-400"
        />
      </div>
    );
  }

  // Detail variant - full featured with buttons
  const showActions = hasVC && status && status !== "none";

  return (
    <>
      <div className={cn("flex items-center gap-2", className)}>
        {/* VC Status Indicator */}
        <div className="flex items-center gap-2">
          {!hasVC || !status || status === "none" ? (
            <>
              <CloseFilled size={16} className="text-gray-400" />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                No VC
              </span>
            </>
          ) : (
            <>
              <CheckmarkFilled size={16} className="text-green-600" />
              <span className="text-sm text-gray-900 dark:text-gray-100">
                VC Available
              </span>
            </>
          )}
        </div>

        {/* Action Buttons */}
        {showActions && (
          <div className="flex items-center gap-1">
            {/* Verify Button - primary action for detail pages */}
            {showVerifyButton && (executionId || workflowId) && (
              <button
                onClick={handleVerify}
                disabled={isVerifying}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  "bg-muted text-muted-foreground border-border hover:bg-muted-foreground/10 border",
                  isVerifying && "cursor-not-allowed opacity-50",
                )}
                title="Verify VC"
              >
                {isVerifying ? (
                  <Time size={12} className="animate-spin" />
                ) : (
                  <Security size={12} />
                )}
                {isVerifying ? "Verifying..." : "Verify"}
              </button>
            )}

            {/* Download Button */}
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="rounded-md p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Download VC"
            >
              <Download
                size={14}
                className={isDownloading ? "animate-pulse" : ""}
              />
            </button>

            {/* Copy Button - only show in detail pages */}
            {showCopyButton && vcData && (
              <button
                onClick={handleCopy}
                disabled={isCopying}
                className="rounded-md p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                title={copySuccess ? "Copied!" : "Copy to Clipboard"}
              >
                <Copy
                  size={14}
                  className={copySuccess ? "text-green-600" : ""}
                />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Verification Modal */}
      <VerificationModal
        isOpen={showVerificationModal}
        onClose={() => setShowVerificationModal(false)}
        verificationResult={verificationResult}
        isLoading={isVerifying}
        error={verificationError}
      />
    </>
  );
}
