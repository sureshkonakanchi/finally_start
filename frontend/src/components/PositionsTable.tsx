import { fmtPct, fmtPrice, fmtQty, fmtSignedUsd, fmtUsd, toneClass } from "@/lib/format";
import type { Position } from "@/lib/types";

interface Props {
  positions: Position[];
  onSelect?: (ticker: string) => void;
}

export default function PositionsTable({ positions, onSelect }: Props) {
  return (
    <div className="h-full overflow-auto">
      <table data-testid="positions-table" className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 bg-panel text-[11px] text-muted">
          <tr className="border-b border-line">
            <th className="px-2.5 py-1 text-left font-normal">Symbol</th>
            <th className="px-2 py-1 text-right font-normal">Qty</th>
            <th className="px-2 py-1 text-right font-normal">Avg cost</th>
            <th className="px-2 py-1 text-right font-normal">Last</th>
            <th className="px-2 py-1 text-right font-normal">Value</th>
            <th className="px-2 py-1 text-right font-normal">Unrealized P&amp;L</th>
            <th className="px-2.5 py-1 text-right font-normal">%</th>
          </tr>
        </thead>
        <tbody>
          {positions.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-2.5 py-4 text-sm text-muted">
                No open positions. Enter a symbol and quantity above, then Buy.
              </td>
            </tr>
          ) : (
            positions.map((p) => (
              <tr
                key={p.ticker}
                data-testid={`position-row-${p.ticker}`}
                onClick={() => onSelect?.(p.ticker)}
                className="num cursor-pointer border-b border-line/60 hover:bg-raised"
              >
                <td className="px-2.5 py-1 text-left font-semibold">{p.ticker}</td>
                <td className="px-2 py-1 text-right">{fmtQty(p.quantity)}</td>
                <td className="px-2 py-1 text-right text-muted">{fmtPrice(p.avg_cost)}</td>
                <td className="px-2 py-1 text-right">{fmtPrice(p.current_price)}</td>
                <td className="px-2 py-1 text-right">{fmtUsd(p.market_value)}</td>
                <td className={`px-2 py-1 text-right ${toneClass(p.unrealized_pnl)}`}>{fmtSignedUsd(p.unrealized_pnl)}</td>
                <td className={`px-2.5 py-1 text-right ${toneClass(p.unrealized_pnl_percent)}`}>
                  {fmtPct(p.unrealized_pnl_percent)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
