import type { ReactNode } from "react";

export function Panel({
  label,
  meta,
  children,
  className = "",
}: {
  label?: string;
  /**
   * Optional trailing metric, e.g. "1.2M" in "Token mix · 1.2M". Separate from
   * `label` so the value stays markable — callers cannot smuggle a pre-formatted
   * number into the title and bypass `model/format.ts`, and the metric can be
   * styled or hidden independently of the heading text.
   */
  meta?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      {label && (
        <h3 className="panel-label">
          {label}
          {meta && <span className="panel-meta"> · {meta}</span>}
        </h3>
      )}
      {children}
    </section>
  );
}

export function Zone({ children }: { children: ReactNode }) {
  return <h2 className="zone">{children}</h2>;
}
