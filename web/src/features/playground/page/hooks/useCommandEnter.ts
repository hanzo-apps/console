import { useEffect } from "react";

export default function useCommandEnter(isEnabled: boolean, callback: () => Promise<void>) {
  useEffect(() => {
    const isMac = window.navigator.userAgent.includes("Mac");

    function handleKeyDown(event: KeyboardEvent) {
      if (isEnabled && (event.metaKey || event.ctrlKey) && event.code === "Enter") {
        callback().catch((err) => console.error(err));
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);

    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isEnabled, callback]);
}
