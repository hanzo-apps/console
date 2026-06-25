import { useState, useEffect, useCallback } from "react";
import {
  getMachines,
  deleteMachine,
  type CasvisorMachine,
  type ProviderType,
} from "../../services/casvisorApi";
import { useNavigate } from "../../adapters";
import { Badge } from "@/src/features/agents/components/ui/badge";
import { Button } from "@/src/features/agents/components/ui/button";
import { PageHeader } from "../../components/PageHeader";

const PROVIDER_COLORS: Record<ProviderType, string> = {
  AWS: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  Azure: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  GCP: "bg-red-500/10 text-red-400 border-red-500/20",
  Aliyun: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  KVM: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  PVE: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  VMware: "bg-green-500/10 text-green-400 border-green-500/20",
  DigitalOcean: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

const STATE_COLORS: Record<string, string> = {
  Running: "bg-emerald-500/10 text-emerald-400",
  Stopped: "bg-zinc-500/10 text-zinc-400",
  Pending: "bg-amber-500/10 text-amber-400",
  Terminated: "bg-red-500/10 text-red-400",
};

export function ComputePage() {
  const navigate = useNavigate();
  const [machines, setMachines] = useState<CasvisorMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProviderType | "all">("all");

  const fetchMachines = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getMachines();
      setMachines(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load machines");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMachines();
  }, [fetchMachines]);

  const filtered =
    filter === "all"
      ? machines
      : machines.filter((m) => {
          // Match on provider type or provider name
          return m.provider?.includes(filter);
        });

  const providerCounts = machines.reduce<Record<string, number>>((acc, m) => {
    const p = m.provider || "Unknown";
    acc[p] = (acc[p] ?? 0) + 1;
    return acc;
  }, {});

  const handleDelete = async (machine: CasvisorMachine) => {
    if (!confirm(`Delete machine "${machine.displayName || machine.name}"?`))
      return;
    try {
      await deleteMachine({ owner: machine.owner, name: machine.name });
      await fetchMachines();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compute"
        description={`${machines.length} machine${machines.length !== 1 ? "s" : ""} across ${Object.keys(providerCounts).length} provider${Object.keys(providerCounts).length !== 1 ? "s" : ""}`}
        actions={[
          {
            label: "Providers",
            onClick: () => navigate("/compute/providers"),
            variant: "outline" as const,
          },
          {
            label: "New Machine",
            onClick: () => navigate("/compute/new"),
            variant: "default" as const,
          },
        ]}
      />

      {/* Provider filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            filter === "all"
              ? "border-white/20 bg-white/10 text-white"
              : "border-zinc-700 bg-transparent text-zinc-400 hover:border-zinc-500"
          }`}
        >
          All ({machines.length})
        </button>
        {(
          [
            "AWS",
            "Azure",
            "GCP",
            "DigitalOcean",
            "Aliyun",
            "KVM",
            "PVE",
            "VMware",
          ] as ProviderType[]
        ).map((p) => {
          const count = providerCounts[p] ?? 0;
          if (count === 0 && filter !== p) return null;
          return (
            <button
              key={p}
              onClick={() => setFilter(filter === p ? "all" : p)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === p
                  ? PROVIDER_COLORS[p]
                  : "border-zinc-700 bg-transparent text-zinc-400 hover:border-zinc-500"
              }`}
            >
              {p} ({count})
            </button>
          );
        })}
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-400">
          {error}
          <Button
            variant="ghost"
            size="sm"
            className="ml-2"
            onClick={fetchMachines}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-zinc-500">
          <div className="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
          Loading machines...
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <div className="py-12 text-center text-zinc-500">
          <p className="mb-2 text-lg">No machines found</p>
          <p className="text-sm">
            {machines.length === 0
              ? "Create your first cloud machine to get started."
              : `No machines match the "${filter}" filter.`}
          </p>
        </div>
      )}

      {/* Machine list */}
      {!loading && filtered.length > 0 && (
        <div className="grid gap-3">
          {filtered.map((machine) => (
            <div
              key={`${machine.owner}/${machine.name}`}
              onClick={() =>
                navigate(`/compute/${machine.owner}/${machine.name}`)
              }
              className="group cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-600"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div>
                    <h3 className="font-medium text-white transition-colors group-hover:text-zinc-300">
                      {machine.displayName || machine.name}
                    </h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {machine.publicIp ||
                        machine.privateIp ||
                        "No IP assigned"}
                      {machine.region && ` · ${machine.region}`}
                      {machine.zone && `/${machine.zone}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {machine.cpuSize && (
                    <span className="text-xs text-zinc-500">
                      {machine.cpuSize} vCPU
                    </span>
                  )}
                  {machine.memSize && (
                    <span className="text-xs text-zinc-500">
                      {machine.memSize} RAM
                    </span>
                  )}
                  <Badge
                    className={
                      PROVIDER_COLORS[machine.provider as ProviderType] ??
                      "bg-zinc-500/10 text-zinc-400"
                    }
                  >
                    {machine.provider || "Unknown"}
                  </Badge>
                  <Badge
                    className={
                      STATE_COLORS[machine.state] ??
                      "bg-zinc-500/10 text-zinc-400"
                    }
                  >
                    {machine.state || "Unknown"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(machine);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              {/* OS / Image info */}
              {(machine.os || machine.image) && (
                <div className="mt-2 text-xs text-zinc-600">
                  {machine.os}
                  {machine.os && machine.image && " · "}
                  {machine.image}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
