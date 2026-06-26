import { CalendarDays } from "lucide-react";
import { SidebarMenuButton } from "@/src/components/ui/sidebar";
import { useInsightsCapture } from "@/src/features/insights-analytics/useInsightsCapture";
import { useEffect } from "react";

declare global {
  interface Window {
    Cal?: (...args: unknown[]) => void;
  }
}

export const BookACallButton = () => {
  const capture = useInsightsCapture();

  useEffect(() => {
    if (window.Cal) return;
    // Cal.com official embed bootstrap: defines the window.Cal queue stub and
    // lazily injects embed.js (calls made before it loads are queued). Loading
    // embed.js directly without this stub throws "Cal is not defined" from
    // inside embed.js.
    /* eslint-disable */
    (function (C: any, A: any, L: any) {
      const p = function (a: any, ar: any) {
        a.q.push(ar);
      };
      const d = C.document;
      C.Cal =
        C.Cal ||
        function () {
          const cal = C.Cal;
          const ar = arguments;
          if (!cal.loaded) {
            cal.ns = {};
            cal.q = cal.q || [];
            d.head.appendChild(d.createElement("script")).src = A;
            cal.loaded = true;
          }
          if (ar[0] === L) {
            const api: any = function () {
              p(api, arguments);
            };
            const namespace = ar[1];
            api.q = api.q || [];
            if (typeof namespace === "string") {
              cal.ns[namespace] = cal.ns[namespace] || api;
              p(cal.ns[namespace], ar);
              p(cal, ["initNamespace", namespace]);
            } else p(cal, ar);
            return;
          }
          p(cal, ar);
        };
      (window as any).Cal("init", { origin: "https://cal.com" });
    })(window, "https://app.cal.com/embed/embed.js", "init");
    /* eslint-enable */
  }, []);

  return (
    <SidebarMenuButton
      onClick={() => {
        capture("sidebar:book_a_call_clicked");
        if (window.Cal) {
          window.Cal("modal", {
            calLink: "hanzo",
            config: { layout: "month_view", theme: "dark" },
          });
        } else {
          window.open("https://cal.com/hanzo", "_blank", "noopener,noreferrer");
        }
      }}
    >
      <CalendarDays className="h-4 w-4" />
      Book a call
    </SidebarMenuButton>
  );
};
