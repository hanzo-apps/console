import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link, useNavigate } from "../adapters";
import { Badge } from "@/src/features/agents/components/ui/badge";
import { Button } from "@/src/features/agents/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/src/features/agents/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/src/features/agents/components/ui/dropdown-menu";
import { Input } from "@/src/features/agents/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/features/agents/components/ui/select";
import { Switch } from "@/src/features/agents/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/features/agents/components/ui/table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Plus,
  Search,
} from "@/src/features/agents/components/ui/icon-bridge";
import { ErrorState } from "@/src/features/agents/components/ui/ErrorState";
import { Skeleton } from "@/src/features/agents/components/ui/skeleton";
import { PageHeader } from "../components/PageHeader";
import { cn } from "../lib/utils";
import { useAgentsList } from "../hooks/useAgentsList";
import {
  type AgentListItem,
  SESSION_STATUSES,
  type SessionStatus,
} from "../types/agents-list";

type SortField = "name" | "model" | "ownerName" | "sessions" | "lastUsed";
type SortDir = "asc" | "desc";

const STATUS_COLORS: Record<SessionStatus, string> = {
  completed: "#10b981",
  active: "#a1a1aa",
  error: "#ef4444",
  cancelled: "#f97316",
  idle: "#6b7280",
};

const STATUS_LABELS: Record<SessionStatus, string> = {
  completed: "Completed",
  active: "Active",
  error: "Error",
  cancelled: "Cancelled",
  idle: "Idle",
};

const ALL_COLUMNS = [
  { id: "name", label: "Name" },
  { id: "model", label: "Model" },
  { id: "ownerName", label: "Owner" },
  { id: "sessions", label: "Sessions" },
  { id: "lastUsed", label: "Last Used" },
] as const;

type ColumnId = (typeof ALL_COLUMNS)[number]["id"];

const PRESET_OPTIONS = [
  { label: "Last hour", value: "1h" as const },
  { label: "Last 24 hours", value: "24h" as const },
  { label: "Last 7 days", value: "7d" as const },
  { label: "Last 30 days", value: "30d" as const },
];

const PAGE_SIZES = [10, 25, 50, 100];

const numberFormatter = new Intl.NumberFormat("en-US");

function formatLastUsed(iso?: string): string {
  if (!iso) return "—";
  const value = new Date(iso).getTime();
  if (Number.isNaN(value)) return "—";
  const diff = Date.now() - value;
  if (diff < 0) return "now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d`;
  return new Date(iso).toLocaleDateString();
}

function downloadCsv(rows: AgentListItem[]) {
  const header = ["Name", "Model", "Owner", "Sessions", "Last Used"];
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        JSON.stringify(row.name),
        JSON.stringify(row.model),
        JSON.stringify(row.ownerName),
        row.sessions,
        JSON.stringify(row.lastUsedIso ?? ""),
      ].join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `agents-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function AgentsListPage() {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<"1h" | "24h" | "7d" | "30d">("24h");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "default" | "custom">("all");
  const [pageSize, setPageSize] = useState<number>(10);
  const [sortField, setSortField] = useState<SortField>("sessions");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showInferenceMetrics, setShowInferenceMetrics] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnId>>(
    new Set(ALL_COLUMNS.map((col) => col.id)),
  );

  const { summary, loading, error, refresh, isRefreshing } = useAgentsList({
    preset,
  });

  const filteredAgents = useMemo(() => {
    if (!summary) return [];
    const query = search.trim().toLowerCase();
    return summary.agents.filter((agent) => {
      if (filter === "default" && !agent.isDefault) return false;
      if (filter === "custom" && agent.isDefault) return false;
      if (!query) return true;
      return (
        agent.name.toLowerCase().includes(query) ||
        agent.model.toLowerCase().includes(query) ||
        agent.ownerName.toLowerCase().includes(query)
      );
    });
  }, [summary, search, filter]);

  const sortedAgents = useMemo(() => {
    const sorted = [...filteredAgents];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sortField === "sessions") cmp = a.sessions - b.sessions;
      else if (sortField === "lastUsed") {
        const av = a.lastUsedIso ? new Date(a.lastUsedIso).getTime() : 0;
        const bv = b.lastUsedIso ? new Date(b.lastUsedIso).getTime() : 0;
        cmp = av - bv;
      } else {
        const av = String(a[sortField] ?? "").toLowerCase();
        const bv = String(b[sortField] ?? "").toLowerCase();
        cmp = av < bv ? -1 : av > bv ? 1 : 0;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filteredAgents, sortField, sortDir]);

  const visibleAgents = useMemo(
    () => sortedAgents.slice(0, pageSize),
    [sortedAgents, pageSize],
  );

  const chartData = useMemo(
    () =>
      sortedAgents.slice(0, 12).map((agent) => ({
        agent: agent.name,
        ...agent.statusBreakdown,
      })),
    [sortedAgents],
  );

  const totalSessions = useMemo(
    () => sortedAgents.reduce((sum, agent) => sum + agent.sessions, 0),
    [sortedAgents],
  );

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "sessions" || field === "lastUsed" ? "desc" : "asc");
    }
  };

  const sortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
    }
    return sortDir === "asc" ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Manage your AI agents and their configurations."
        aside={
          <Button onClick={() => navigate("/nodes")} size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            New agent
          </Button>
        }
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle className="text-base font-semibold">
            Sessions by Agent
          </CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <Switch
                checked={showInferenceMetrics}
                onCheckedChange={setShowInferenceMetrics}
                disabled={!summary?.inferenceMetricsAvailable}
              />
              Inference Metrics
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCsv(sortedAgents)}
              disabled={sortedAgents.length === 0}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export Data
            </Button>
            <Select value={"sessions"} onValueChange={() => undefined}>
              <SelectTrigger className="h-9 w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sessions">Sessions</SelectItem>
                <SelectItem value="cost" disabled>
                  Cost (soon)
                </SelectItem>
                <SelectItem value="latency" disabled>
                  Latency (soon)
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={preset}
              onValueChange={(value) =>
                setPreset(value as "1h" | "24h" | "7d" | "30d")
              }
            >
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESET_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {error && !summary ? (
            <ErrorState
              title="Unable to load agent activity"
              description={error.message}
              onRetry={refresh}
              retrying={isRefreshing}
              variant="card"
              severity="error"
            />
          ) : loading ? (
            <Skeleton className="h-[280px] w-full rounded-lg" />
          ) : chartData.length === 0 ? (
            <div className="text-muted-foreground flex h-[280px] items-center justify-center text-sm">
              No agent activity in this range.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  vertical={false}
                />
                <XAxis
                  dataKey="agent"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  interval={0}
                  height={40}
                  tickFormatter={(value: string) =>
                    value.length > 10 ? `${value.slice(0, 10)}…` : value
                  }
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={32}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                {SESSION_STATUSES.map((status, index) => (
                  <Bar
                    key={status}
                    dataKey={status}
                    stackId="status"
                    fill={STATUS_COLORS[status]}
                    radius={
                      index === SESSION_STATUSES.length - 1
                        ? [4, 4, 0, 0]
                        : [0, 0, 0, 0]
                    }
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            {SESSION_STATUSES.map((status) => (
              <div key={status} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: STATUS_COLORS[status] }}
                />
                <span>{STATUS_LABELS[status]}</span>
              </div>
            ))}
            <span className="ml-auto font-mono">
              {numberFormatter.format(totalSessions)} sessions
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by agent name..."
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={filter}
                onValueChange={(value) =>
                  setFilter(value as "all" | "default" | "custom")
                }
              >
                <SelectTrigger className="h-9 w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All agents</SelectItem>
                  <SelectItem value="default">Default only</SelectItem>
                  <SelectItem value="custom">Custom only</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => setPageSize(Number(value))}
              >
                <SelectTrigger className="h-9 w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size} rows
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9">
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {ALL_COLUMNS.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={visibleColumns.has(column.id)}
                      onCheckedChange={(checked) => {
                        setVisibleColumns((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(column.id);
                          else next.delete(column.id);
                          if (next.size === 0) next.add(column.id);
                          return next;
                        });
                      }}
                    >
                      {column.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="border-border/60 overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {visibleColumns.has("name") && (
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort("name")}
                        className="inline-flex items-center"
                      >
                        Name {sortIcon("name")}
                      </button>
                    </TableHead>
                  )}
                  {visibleColumns.has("model") && (
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort("model")}
                        className="inline-flex items-center"
                      >
                        Model {sortIcon("model")}
                      </button>
                    </TableHead>
                  )}
                  {visibleColumns.has("ownerName") && (
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort("ownerName")}
                        className="inline-flex items-center"
                      >
                        Owner {sortIcon("ownerName")}
                      </button>
                    </TableHead>
                  )}
                  {visibleColumns.has("sessions") && (
                    <TableHead className="text-right">
                      <button
                        type="button"
                        onClick={() => toggleSort("sessions")}
                        className="inline-flex items-center"
                      >
                        Sessions {sortIcon("sessions")}
                      </button>
                    </TableHead>
                  )}
                  {visibleColumns.has("lastUsed") && (
                    <TableHead className="text-right">
                      <button
                        type="button"
                        onClick={() => toggleSort("lastUsed")}
                        className="inline-flex items-center"
                      >
                        Last Used {sortIcon("lastUsed")}
                      </button>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && visibleAgents.length === 0
                  ? Array.from({ length: 5 }).map((_, idx) => (
                      <TableRow key={`sk-${idx}`}>
                        {Array.from(visibleColumns).map((col) => (
                          <TableCell key={col}>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : visibleAgents.map((agent) => (
                      <TableRow key={agent.id} className="cursor-pointer">
                        {visibleColumns.has("name") && (
                          <TableCell>
                            <Link
                              to={`/nodes/${encodeURIComponent(agent.id)}`}
                              className="text-foreground inline-flex items-center gap-2 font-medium hover:underline"
                            >
                              <span>{agent.name}</span>
                              {agent.isDefault && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] uppercase"
                                >
                                  Default
                                </Badge>
                              )}
                            </Link>
                          </TableCell>
                        )}
                        {visibleColumns.has("model") && (
                          <TableCell className="text-muted-foreground font-mono text-xs">
                            {agent.model}
                          </TableCell>
                        )}
                        {visibleColumns.has("ownerName") && (
                          <TableCell className="text-muted-foreground text-sm">
                            {agent.ownerName}
                          </TableCell>
                        )}
                        {visibleColumns.has("sessions") && (
                          <TableCell className="text-right font-mono text-sm">
                            {numberFormatter.format(agent.sessions)}
                          </TableCell>
                        )}
                        {visibleColumns.has("lastUsed") && (
                          <TableCell className="text-muted-foreground text-right text-sm">
                            {formatLastUsed(agent.lastUsedIso)}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                {!loading && visibleAgents.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={visibleColumns.size}
                      className="text-muted-foreground h-32 text-center text-sm"
                    >
                      No agents match the current filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div
            className={cn(
              "text-muted-foreground mt-3 flex items-center justify-between text-xs",
              loading && "opacity-60",
            )}
          >
            <span>
              Showing {visibleAgents.length} of {sortedAgents.length}
            </span>
            <span>{summary?.rangeLabel ?? preset}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
