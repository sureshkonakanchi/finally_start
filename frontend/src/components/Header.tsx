import { fmtPct, fmtSignedUsd, fmtUsd, toneClass } from "@/lib/format";
import type { ConnectionStatus } from "@/lib/types";

interface HeaderProps {
  totalValue: number | null;
  cash: number | null;
  unrealizedPnl: number | null;
  costBasis: number;
  status: ConnectionStatus;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Live",
  reconnecting: "Reconnecting",
  disconnected: "Offline",
};

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connected: "bg-up",
  reconnecting: "bg-accent dot-pulse",
  disconnected: "bg-down",
};

export default function Header({ totalValue, cash, unrealizedPnl, costBasis, status }: HeaderProps) {
  const pnlPct = unrealizedPnl !== null && costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : null;
  return (
    <header className="flex h-14 shrink-0 items-stretch border-b border-line bg-panel">
      <div className="flex items-center gap-2 border-r border-line px-4">
        <span aria-hidden className="block h-5 w-1.5 bg-accent" />
        <span className="text-xl font-bold tracking-tight">
          Fin<span className="text-accent">A</span>lly
        </span>
      </div>

      <dl className="flex items-stretch">
        <div className="flex flex-col justify-center border-r border-line px-5">
          <dt className="text-[11px] text-muted">Portfolio value</dt>
          <dd data-testid="header-total-value" className="num text-2xl font-semibold leading-tight text-accent">
            {fmtUsd(totalValue)}
          </dd>
        </div>
        <div className="flex flex-col justify-center border-r border-line px-5">
          <dt className="text-[11px] text-muted">Cash</dt>
          <dd data-testid="header-cash" className="num text-lg font-medium leading-tight">
            {fmtUsd(cash)}
          </dd>
        </div>
        <div className="hidden flex-col justify-center border-r border-line px-5 md:flex">
          <dt className="text-[11px] text-muted">Unrealized P&amp;L</dt>
          <dd className={`num text-lg font-medium leading-tight ${toneClass(unrealizedPnl)}`}>
            {fmtSignedUsd(unrealizedPnl)}
            <span className="ml-1.5 text-sm">{pnlPct !== null ? `(${fmtPct(pnlPct)})` : ""}</span>
          </dd>
        </div>
      </dl>

      <div className="ml-auto flex items-center gap-2 px-4 text-xs text-muted">
        <span
          data-testid="connection-status"
          data-status={status}
          role="status"
          aria-label={`Price stream: ${STATUS_LABEL[status]}`}
          title={`Price stream: ${STATUS_LABEL[status]}`}
          className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_COLOR[status]}`}
        />
        <span>{STATUS_LABEL[status]}</span>
      </div>
    </header>
  );
}
