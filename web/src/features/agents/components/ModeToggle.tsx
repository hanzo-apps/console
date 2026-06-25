import { Code, User } from "@/src/features/agents/components/ui/icon-bridge";
import { useMode } from "../contexts/ModeContext";

export function ModeToggle() {
  const { mode, toggleMode } = useMode();

  return (
    <div className="flex items-center gap-2">
      <span className="text-body hidden sm:inline">Mode:</span>
      <button
        onClick={toggleMode}
        className="border-border-secondary bg-bg-tertiary hover:bg-bg-elevated flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors duration-200"
        title={`Switch to ${mode === "developer" ? "user" : "developer"} mode`}
      >
        {mode === "developer" ? (
          <>
            <Code className="text-foreground h-4 w-4" />
            <span className="text-foreground hidden text-sm font-medium sm:inline">
              Developer
            </span>
          </>
        ) : (
          <>
            <User className="h-4 w-4 text-green-400" />
            <span className="hidden text-sm font-medium text-green-400 sm:inline">
              User
            </span>
          </>
        )}
      </button>
    </div>
  );
}
