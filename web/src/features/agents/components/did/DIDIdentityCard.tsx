import { useState } from "react";
import { useDIDInfo } from "../../hooks/useDIDInfo";
import { copyDIDToClipboard } from "../../services/didApi";
import type { ReasonerDIDInfo, SkillDIDInfo } from "../../types/did";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import {
  DIDCountBadge,
  DIDIdentityBadge,
  DIDStatusBadge,
} from "./DIDStatusBadge";

interface DIDIdentityCardProps {
  nodeId: string;
  compact?: boolean;
  showHierarchy?: boolean;
  className?: string;
}

export function DIDIdentityCard({
  nodeId,
  compact = false,
  showHierarchy = true,
  className = "",
}: DIDIdentityCardProps) {
  const { didInfo, loading, error, refetch } = useDIDInfo(nodeId);
  const [expanded, setExpanded] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const handleCopyDID = async (did: string, type: string) => {
    const success = await copyDIDToClipboard(did);
    if (success) {
      setCopyFeedback(`${type} DID copied!`);
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  };

  if (loading) {
    return (
      <Card className={`p-4 ${className}`}>
        <div className="space-y-2">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </Card>
    );
  }

  if (error || !didInfo) {
    return (
      <Card className={`border-red-200 p-4 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-red-600">❌</span>
            <span className="text-sm text-red-700">
              {error || "No DID information available"}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refetch}
            className="text-xs"
          >
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (compact) {
    return (
      <Card className={`p-3 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DIDStatusBadge status={didInfo.status} size="sm" />
            <DIDCountBadge
              count={Object.keys(didInfo.reasoners).length}
              type="reasoners"
            />
            <DIDCountBadge
              count={Object.keys(didInfo.skills).length}
              type="skills"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="text-xs"
          >
            {expanded ? "Less" : "More"}
          </Button>
        </div>

        {expanded && (
          <div className="mt-3 border-t pt-3">
            <DIDIdentityBadge
              did={didInfo.did}
              onCopy={(did) => handleCopyDID(did, "Agent")}
            />
          </div>
        )}
      </Card>
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
    <Card className={`p-4 ${className}`}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-heading-3">DID Identity</h3>
          <DIDStatusBadge status={didInfo.status} />
        </div>
        <div className="flex items-center gap-2">
          <DIDCountBadge count={reasoners.length} type="reasoners" />
          <DIDCountBadge count={skills.length} type="skills" />
        </div>
      </div>

      {/* Copy Feedback */}
      {copyFeedback && (
        <div className="mb-3 rounded border border-green-200 bg-green-50 p-2 text-sm text-green-700">
          {copyFeedback}
        </div>
      )}

      {/* Agent DID */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Agent DID</span>
          <span className="text-xs text-gray-500">
            Registered: {new Date(didInfo.registered_at).toLocaleDateString()}
          </span>
        </div>
        <DIDIdentityBadge
          did={didInfo.did}
          maxLength={40}
          onCopy={(did) => handleCopyDID(did, "Agent")}
        />
      </div>

      {/* Hierarchy */}
      {showHierarchy && (reasoners.length > 0 || skills.length > 0) && (
        <div className="space-y-4">
          {/* Reasoners */}
          {reasoners.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                <span>🧠</span>
                Reasoners ({reasoners.length})
              </h4>
              <div className="border-border space-y-2 border-l-2 pl-4">
                {reasoners.map(([functionName, reasoner]) => (
                  <ReasonerDIDItem
                    key={functionName}
                    functionName={functionName}
                    reasoner={reasoner}
                    onCopyDID={(did) => handleCopyDID(did, "Reasoner")}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Skills */}
          {skills.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                <span>⚡</span>
                Skills ({skills.length})
              </h4>
              <div className="space-y-2 border-l-2 border-purple-100 pl-4">
                {skills.map(([functionName, skill]) => (
                  <SkillDIDItem
                    key={functionName}
                    functionName={functionName}
                    skill={skill}
                    onCopyDID={(did) => handleCopyDID(did, "Skill")}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center justify-between border-t pt-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refetch}
            className="text-xs"
          >
            <svg
              className="mr-1 h-3 w-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </Button>
        </div>
        <span className="text-xs text-gray-500">
          Hanzo Agents Server: {didInfo.agents_server_id}
        </span>
      </div>
    </Card>
  );
}

interface ReasonerDIDItemProps {
  functionName: string;
  reasoner: ReasonerDIDInfo;
  onCopyDID: (did: string) => void;
}

function ReasonerDIDItem({
  functionName,
  reasoner,
  onCopyDID,
}: ReasonerDIDItemProps) {
  return (
    <div className="bg-muted border-border rounded border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-foreground text-sm font-medium">
          {functionName}
        </span>
        <Badge
          variant="outline"
          className="bg-muted text-muted-foreground border-border text-xs"
        >
          {reasoner.exposure_level}
        </Badge>
      </div>

      <DIDIdentityBadge
        did={reasoner.did}
        maxLength={35}
        onCopy={onCopyDID}
        className="mb-2"
      />

      {reasoner.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {reasoner.capabilities.map((capability, index) => (
            <Badge
              key={index}
              variant="outline"
              className="text-foreground border-border bg-white text-xs"
            >
              {capability}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

interface SkillDIDItemProps {
  functionName: string;
  skill: SkillDIDInfo;
  onCopyDID: (did: string) => void;
}

function SkillDIDItem({ functionName, skill, onCopyDID }: SkillDIDItemProps) {
  return (
    <div className="rounded border border-purple-100 bg-purple-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-purple-900">
          {functionName}
        </span>
        <Badge
          variant="outline"
          className="border-purple-200 bg-purple-100 text-xs text-purple-700"
        >
          {skill.exposure_level}
        </Badge>
      </div>

      <DIDIdentityBadge
        did={skill.did}
        maxLength={35}
        onCopy={onCopyDID}
        className="mb-2"
      />

      {skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skill.tags.map((tag, index) => (
            <Badge
              key={index}
              variant="outline"
              className="border-purple-200 bg-white text-xs text-purple-600"
            >
              #{tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export { ReasonerDIDItem, SkillDIDItem };
