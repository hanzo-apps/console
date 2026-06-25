import { cn } from "@/src/utils/tailwind";

type BarListItem = {
  name: string;
  value: number;
};

export function BarList(props: {
  data: BarListItem[];
  valueFormatter?: (value: number) => string;
  className?: string;
  color?: string;
}) {
  const maxValue = Math.max(...props.data.map((d) => d.value), 1);
  const formatter = props.valueFormatter ?? ((v: number) => String(v));
  // Default bar color tracks the neutral (non-blue) chart token.
  const barColor = props.color ?? "hsl(var(--chart-1))";

  return (
    <div className={cn("space-y-2", props.className)}>
      {props.data.map((item) => (
        <div key={item.name} className="group flex items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <div
              className="absolute inset-y-0 left-0 rounded-sm opacity-20 transition-opacity group-hover:opacity-30"
              style={{
                width: `${(item.value / maxValue) * 100}%`,
                backgroundColor: barColor,
              }}
            />
            <p className="text-muted-foreground relative truncate py-0.5 pl-2 text-sm">
              {item.name}
            </p>
          </div>
          <span className="text-muted-foreground flex-shrink-0 text-sm font-medium">
            {formatter(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
