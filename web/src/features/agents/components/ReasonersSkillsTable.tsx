import { useState } from "react";
import { useNavigate } from "../adapters";
import { Badge } from "@/src/features/agents/components/ui/badge";
import { Button } from "@/src/features/agents/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/src/features/agents/components/ui/card";
import { SearchBar } from "@/src/features/agents/components/ui/SearchBar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/features/agents/components/ui/table";
import {
  Function,
  Tools,
  Copy,
  Identification,
} from "@/src/features/agents/components/ui/icon-bridge";
import { cn } from "@/src/features/agents/lib/utils";
import type {
  ReasonerDefinition,
  SkillDefinition,
} from "@/src/features/agents/types/agents";
import type {
  ReasonerDIDInfo,
  SkillDIDInfo,
} from "@/src/features/agents/types/did";

interface ReasonersSkillsTableProps {
  reasoners: ReasonerDefinition[];
  skills: SkillDefinition[];
  reasonerDIDs?: Record<string, ReasonerDIDInfo>;
  skillDIDs?: Record<string, SkillDIDInfo>;
  agentDID?: string;
  agentStatus?: {
    health_status: string;
    lifecycle_status: string;
  };
  nodeId?: string;
  className?: string;
}

interface TableItem {
  id: string;
  name: string;
  type: "reasoner" | "skill" | "agent";
  did?: string;
  status: "active" | "inactive" | "error";
  exposure_level?: string;
  capabilities?: string[];
  tags?: string[];
  memory_retention?: string;
}

export function ReasonersSkillsTable({
  reasoners,
  skills,
  reasonerDIDs = {},
  skillDIDs = {},
  agentDID,
  agentStatus,
  nodeId,
  className,
}: ReasonersSkillsTableProps) {
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const navigate = useNavigate();

  // Determine if agent is active based on health and lifecycle status
  const isAgentActive = agentStatus
    ? agentStatus.health_status === "active" &&
      (agentStatus.lifecycle_status === "ready" ||
        agentStatus.lifecycle_status === "degraded")
    : false;

  const componentStatus: "active" | "inactive" = isAgentActive
    ? "active"
    : "inactive";

  // Combine agent DID, reasoners and skills into a unified table format
  const tableItems: TableItem[] = [
    // Add agent DID as first row if available
    ...(agentDID
      ? [
          {
            id: "agent",
            name: "Agent Identity",
            type: "agent" as const,
            did: agentDID,
            status: componentStatus,
          },
        ]
      : []),
    ...reasoners.map(
      (reasoner): TableItem => ({
        id: reasoner.id,
        name: reasoner.id,
        type: "reasoner",
        did: reasonerDIDs[reasoner.id]?.did,
        status: componentStatus,
        exposure_level: reasonerDIDs[reasoner.id]?.exposure_level,
        capabilities: reasonerDIDs[reasoner.id]?.capabilities,
        memory_retention: reasoner.memory_config?.memory_retention,
        tags: reasoner.tags,
      }),
    ),
    ...skills.map(
      (skill): TableItem => ({
        id: skill.id,
        name: skill.id,
        type: "skill",
        did: skillDIDs[skill.id]?.did,
        status: componentStatus,
        exposure_level: skillDIDs[skill.id]?.exposure_level,
        tags: skillDIDs[skill.id]?.tags,
      }),
    ),
  ];

  const handleCopyDID = async (did: string, name: string) => {
    try {
      await navigator.clipboard.writeText(did);
      setCopyFeedback(`${name} DID copied!`);
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch (error) {
      console.error("Failed to copy DID:", error);
    }
  };

  const handleReasonerClick = (reasonerId: string) => {
    if (nodeId) {
      const fullReasonerId = `${nodeId}.${reasonerId}`;
      navigate(`/reasoners/${fullReasonerId}`);
    }
  };

  const handleRowClick = (item: TableItem, event: React.MouseEvent) => {
    // Prevent navigation if clicking on interactive elements like buttons
    if ((event.target as HTMLElement).closest("button")) {
      return;
    }

    if (item.type === "reasoner" && nodeId) {
      handleReasonerClick(item.id);
    }
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case "active":
        return <div className="h-2 w-2 rounded-full bg-green-500" />;
      case "inactive":
        return <div className="h-2 w-2 rounded-full bg-gray-400" />;
      case "error":
        return <div className="h-2 w-2 rounded-full bg-red-500" />;
      default:
        return <div className="h-2 w-2 rounded-full bg-gray-400" />;
    }
  };

  const getTypeIcon = (type: "reasoner" | "skill" | "agent") => {
    switch (type) {
      case "reasoner":
        return <Function className="text-accent-primary h-4 w-4" />;
      case "skill":
        return <Tools className="text-accent-secondary h-4 w-4" />;
      case "agent":
        return <Identification className="text-foreground h-4 w-4" />;
      default:
        return <Function className="text-accent-primary h-4 w-4" />;
    }
  };

  const formatDID = (did: string, maxLength = 20) => {
    if (did.length <= maxLength) {
      return did;
    }
    const start = did.substring(0, Math.floor(maxLength / 2) - 2);
    const end = did.substring(did.length - Math.floor(maxLength / 2) + 2);
    return `${start}...${end}`;
  };

  const filteredItems = tableItems.filter(
    (item) =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.id.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  if (filteredItems.length === 0 && searchTerm === "") {
    return (
      <Card className={cn("w-full", className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Function className="text-muted-foreground h-5 w-5" />
            Reasoners & Skills
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground py-8 text-center">
            <div className="mb-2 flex items-center justify-center gap-2">
              <Function className="h-8 w-8 opacity-50" />
              <Tools className="h-8 w-8 opacity-50" />
            </div>
            <p className="text-sm">No reasoners or skills available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Function className="text-muted-foreground h-5 w-5" />
            Reasoners & Skills
            <Badge variant="outline" className="ml-2 text-xs">
              {filteredItems.length}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-3">
            <SearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search reasoners and skills..."
              size="sm"
              wrapperClassName="w-64"
              inputClassName="border border-border bg-background focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring"
              clearButtonAriaLabel="Clear reasoner and skill search"
            />
            {copyFeedback && (
              <div className="text-status-success bg-status-success-bg border-status-success-border rounded-md border px-3 py-1 text-sm">
                {copyFeedback}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-border-secondary">
              <TableHead className="w-12">Type</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>DID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.map((item) => (
              <TableRow
                key={`${item.type}-${item.id}`}
                className={cn(
                  "border-border-secondary hover:bg-bg-hover transition-colors duration-150",
                  item.type === "reasoner" && nodeId && "cursor-pointer",
                )}
                onClick={(event) => handleRowClick(item, event)}
                title={
                  item.type === "reasoner" && nodeId
                    ? `Click to view ${item.name} details`
                    : undefined
                }
              >
                <TableCell>
                  <div className="flex items-center justify-center">
                    {getTypeIcon(item.type)}
                  </div>
                </TableCell>

                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="text-text-primary font-medium">
                      {item.name}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs",
                        item.type === "reasoner"
                          ? "bg-accent-primary/10 text-accent-primary border-accent-primary/20"
                          : item.type === "skill"
                            ? "bg-accent-secondary/10 text-accent-secondary border-accent-secondary/20"
                            : "bg-muted text-foreground border-border",
                      )}
                    >
                      {item.type}
                    </Badge>
                  </div>
                </TableCell>

                <TableCell>
                  {item.did ? (
                    <div className="group flex items-center gap-2">
                      <div className="bg-muted text-muted-foreground border-border flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs">
                        <Identification className="text-accent-primary h-3 w-3" />
                        <span title={item.did}>{formatDID(item.did, 16)}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyDID(item.did!, item.name)}
                        className="h-6 w-6 p-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                        title="Copy DID"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-text-quaternary text-xs">No DID</span>
                  )}
                </TableCell>

                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {getStatusDot(item.status)}
                    <span className="text-body capitalize">{item.status}</span>
                  </div>
                </TableCell>

                <TableCell>
                  <div className="space-y-1">
                    {item.exposure_level && (
                      <Badge
                        variant="outline"
                        className="bg-card text-text-tertiary border-border-secondary text-xs"
                      >
                        {item.exposure_level}
                      </Badge>
                    )}

                    {item.memory_retention && (
                      <div className="text-text-tertiary text-xs">
                        Memory: {item.memory_retention}
                      </div>
                    )}

                    {item.capabilities && item.capabilities.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.capabilities
                          .slice(0, 2)
                          .map((capability, index) => (
                            <Badge
                              key={index}
                              variant="outline"
                              className="bg-card text-text-tertiary border-border-secondary text-xs"
                            >
                              {capability}
                            </Badge>
                          ))}
                        {item.capabilities.length > 2 && (
                          <Badge
                            variant="outline"
                            className="bg-card text-text-quaternary border-border-secondary text-xs"
                          >
                            +{item.capabilities.length - 2}
                          </Badge>
                        )}
                      </div>
                    )}

                    {item.tags && item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.tags.slice(0, 2).map((tag, index) => (
                          <Badge
                            key={index}
                            variant="outline"
                            className="bg-card text-text-tertiary border-border-secondary text-xs"
                          >
                            #{tag}
                          </Badge>
                        ))}
                        {item.tags.length > 2 && (
                          <Badge
                            variant="outline"
                            className="bg-card text-text-quaternary border-border-secondary text-xs"
                          >
                            +{item.tags.length - 2}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
