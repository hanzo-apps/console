"use client";

import { useState } from "react";
import { ArrowLeft, Plus, Pencil, Trash2 } from "lucide-react";
import { useDnsZone, useDnsRecords, useDeleteDnsRecord } from "../hooks";
import { DnsRecordForm } from "./DnsRecordForm";

export function DnsRecordTable({
  orgId,
  zoneId,
  onBack,
}: {
  orgId: string;
  zoneId: string;
  onBack: () => void;
}) {
  const zoneQuery = useDnsZone(orgId, zoneId);
  const recordsQuery = useDnsRecords(orgId, zoneId);
  const deleteRecord = useDeleteDnsRecord();
  const [showForm, setShowForm] = useState(false);
  const [editRecordId, setEditRecordId] = useState<string | null>(null);

  const recordToEdit = editRecordId
    ? recordsQuery.data?.find((r) => r.id === editRecordId)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="hover:bg-muted inline-flex items-center rounded p-1"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h2 className="text-lg font-semibold">
            {zoneQuery.data?.name ?? "Loading..."}
          </h2>
          <p className="text-muted-foreground text-sm">
            {recordsQuery.data?.length ?? 0} records
          </p>
        </div>
        <div className="ml-auto">
          <button
            onClick={() => {
              setEditRecordId(null);
              setShowForm(true);
            }}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Add Record
          </button>
        </div>
      </div>

      {recordsQuery.isLoading && (
        <p className="text-muted-foreground text-sm">Loading records...</p>
      )}

      {recordsQuery.data && recordsQuery.data.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            No records yet. Add your first DNS record.
          </p>
        </div>
      )}

      {recordsQuery.data && recordsQuery.data.length > 0 && (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="px-4 py-2 text-left font-medium">Type</th>
                <th className="px-4 py-2 text-left font-medium">Name</th>
                <th className="px-4 py-2 text-left font-medium">Content</th>
                <th className="px-4 py-2 text-left font-medium">TTL</th>
                <th className="px-4 py-2 text-left font-medium">CF Sync</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recordsQuery.data.map((record) => (
                <tr key={record.id} className="hover:bg-muted/30 border-b">
                  <td className="px-4 py-2">
                    <span className="bg-muted text-foreground inline-flex items-center rounded px-1.5 py-0.5 font-mono text-xs font-medium">
                      {record.type}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono">{record.name}</td>
                  <td className="text-muted-foreground max-w-xs truncate px-4 py-2 font-mono">
                    {record.content}
                  </td>
                  <td className="text-muted-foreground px-4 py-2">
                    {record.ttl}
                  </td>
                  <td className="px-4 py-2">
                    {record.syncToCloudflare ? (
                      <span className="text-green-600 dark:text-green-400">
                        Yes
                      </span>
                    ) : (
                      <span className="text-muted-foreground">No</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => {
                          setEditRecordId(record.id);
                          setShowForm(true);
                        }}
                        className="text-muted-foreground hover:text-foreground rounded p-1"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `Delete ${record.type} record "${record.name}"?`,
                            )
                          ) {
                            deleteRecord.mutate({
                              orgId,
                              zoneId,
                              recordId: record.id,
                            });
                          }
                        }}
                        className="text-muted-foreground hover:text-destructive rounded p-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <DnsRecordForm
          orgId={orgId}
          zoneId={zoneId}
          record={recordToEdit ?? undefined}
          open={showForm}
          onOpenChange={(open) => {
            setShowForm(open);
            if (!open) setEditRecordId(null);
          }}
        />
      )}
    </div>
  );
}
