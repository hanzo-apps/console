import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";

export type MatchedModelCardProps = {
  model: {
    modelName: string;
    matchPattern: string;
    projectId: string | null;
  };
};

export function MatchedModelCard({ model }: MatchedModelCardProps) {
  const isHanzoModel = !model.projectId;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Matched Model
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-base font-semibold">{model.modelName}</span>
          {isHanzoModel && (
            <Badge variant="secondary" className="text-xs">
              Hanzo
            </Badge>
          )}
        </div>
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Pattern:</div>
          <code className="block break-all rounded bg-muted/50 p-2 text-xs">{model.matchPattern}</code>
        </div>
      </CardContent>
    </Card>
  );
}
