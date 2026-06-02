import { TablePeekView } from "@/src/components/table/peek";
import { usePeekData } from "@/src/components/table/peek/hooks/usePeekData";
import { Trace } from "@/src/components/trace2/Trace";
import { Skeleton } from "@hanzo/ui";
import { StringParam, useQueryParam, withDefault } from "use-query-params";

export const PeekViewObservationDetail = ({ projectId }: { projectId: string }) => {
  const router = useRouter();
  const peekId = router.query.peek as string | undefined;
  const timestamp = router.query.timestamp ? new Date(router.query.timestamp as string) : undefined;
  const traceId = router.query.traceId as string | undefined;

  const trace = usePeekData({
    projectId,
    traceId,
    timestamp,
  });

  const [selectedTab, setSelectedTab] = useQueryParam("display", withDefault(StringParam, "details"));

  if (!peekId || !trace.data) {
    return <Skeleton className="h-full w-full rounded-none" />;
  }

  return (
    <Trace
      key={`${trace.data.id}-${peekId}`}
      trace={trace.data}
      scores={trace.data.scores}
      corrections={trace.data.corrections}
      projectId={trace.data.projectId}
      observations={trace.data.observations}
      context="peek"
    />
  );
};

export const TablePeekViewObservationDetail = (
  props: Omit<
    React.ComponentProps<typeof TablePeekView>,
    "children" | "title"
  > & {
    projectId: string;
  },
) => {
  const router = useRouter();

  const { projectId } = props;
  const peekId = router.query.peek as string | undefined;
  const timestampParam = router.query.timestamp as string | undefined;

  // Decode the timestamp parameter before parsing as Date
  // This handles cases where the timestamp might be URL-encoded
  const timestamp = timestampParam
    ? new Date(decodeURIComponent(timestampParam))
    : undefined;

  const traceId = router.query.traceId as string | undefined;

  const trace = usePeekData({
    projectId,
    traceId,
    timestamp,
  });

  return (
    <TablePeekView
      {...props}
      title={
        trace.data
          ? trace.data.name
            ? `${trace.data.name}: ${trace.data.id}`
            : trace.data.id
          : traceId
      }
    >
      <PeekViewObservationDetail trace={trace} peekId={peekId} />
    </TablePeekView>
  );
};
