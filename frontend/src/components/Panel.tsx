import type { ReactNode } from "react";

interface PanelProps {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
}

/** A framed terminal pane: thin title strip, then content. */
export default function Panel({ title, right, children, className = "", bodyClassName = "", testId }: PanelProps) {
  return (
    <section data-testid={testId} className={`flex min-h-0 min-w-0 flex-col border border-line bg-panel ${className}`}>
      <header className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-line px-2.5">
        <h2 className="truncate text-[13px] font-semibold text-ink">{title}</h2>
        {right ? <div className="flex items-center gap-2 text-xs text-muted">{right}</div> : null}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
