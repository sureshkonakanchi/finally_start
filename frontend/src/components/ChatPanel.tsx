"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { fmtPrice, fmtQty } from "@/lib/format";
import type { ChatActions, ChatTradeAction, ChatWatchlistAction } from "@/lib/types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  actions: ChatActions | null;
}

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  /** Called after an assistant reply that executed trades or watchlist changes. */
  onActions?: (actions: ChatActions) => void;
}

let seq = 0;
const nextId = () => `m${Date.now()}-${seq++}`;

function TradeLine({ t }: { t: ChatTradeAction }) {
  const ok = t.status === "executed";
  return (
    <li
      data-testid="chat-action"
      data-kind="trade"
      data-status={t.status}
      className={`border-l-2 px-2 py-0.5 text-xs leading-snug ${ok ? "border-up text-ink" : "border-down text-down"}`}
    >
      <span className={`font-semibold ${ok ? (t.side === "buy" ? "text-up" : "text-down") : ""}`}>
        {t.side === "buy" ? "Bought" : "Sold"}{" "}
      </span>
      <span className="num">
        {fmtQty(t.quantity)} {t.ticker}
        {ok && t.price !== undefined ? ` @ ${fmtPrice(t.price)}` : ""}
      </span>
      {!ok ? <span> — not executed{t.error ? `: ${t.error}` : ""}</span> : null}
    </li>
  );
}

function WatchLine({ w }: { w: ChatWatchlistAction }) {
  const ok = w.status !== "failed" && !w.error;
  return (
    <li
      data-testid="chat-action"
      data-kind="watchlist"
      data-status={w.status}
      className={`border-l-2 px-2 py-0.5 text-xs leading-snug ${ok ? "border-blue text-ink" : "border-down text-down"}`}
    >
      <span className="font-semibold text-blue">{w.action === "add" ? "Watching" : "Unwatched"}</span>{" "}
      <span>{w.ticker}</span>
      {!ok ? <span> — not changed{w.error ? `: ${w.error}` : ""}</span> : null}
    </li>
  );
}

export function ChatBubble({ m }: { m: ChatMessage }) {
  const trades = m.actions?.trades ?? [];
  const changes = m.actions?.watchlist_changes ?? [];
  const isUser = m.role === "user";
  return (
    <div data-testid="chat-message" data-role={m.role} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[92%] whitespace-pre-wrap px-2.5 py-1.5 text-[13px] leading-snug ${
          isUser
            ? "bg-blue/15 text-ink"
            : m.role === "error"
              ? "border border-down/50 text-down"
              : "border-l-2 border-accent bg-raised text-ink"
        }`}
      >
        {m.content}
      </div>
      {trades.length || changes.length ? (
        <ul className="mt-1 flex w-[92%] flex-col gap-0.5">
          {trades.map((t, i) => (
            <TradeLine key={`t${i}`} t={t} />
          ))}
          {changes.map((w, i) => (
            <WatchLine key={`w${i}`} w={w} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const SUGGESTIONS = ["How is my portfolio doing?", "Buy 5 shares of NVDA", "Add PYPL to my watchlist"];

export default function ChatPanel({ collapsed, onToggle, onActions }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getChatHistory()
      .then((items) => {
        if (cancelled || !Array.isArray(items)) return;
        setMessages((cur) => [
          ...items.map((h) => ({
            id: nextId(),
            role: (h.role === "user" ? "user" : "assistant") as ChatMessage["role"],
            content: h.content,
            actions: h.actions ?? null,
          })),
          ...cur,
        ]);
      })
      .catch(() => {
        /* history is optional; start fresh */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // Re-pin after layout settles (web font swap can change message heights).
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [messages, loading, collapsed]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || loading) return;
    setInput("");
    setMessages((m) => [...m, { id: nextId(), role: "user", content: msg, actions: null }]);
    setLoading(true);
    try {
      const res = await api.chat(msg);
      const actions: ChatActions = { trades: res.trades ?? [], watchlist_changes: res.watchlist_changes ?? [] };
      setMessages((m) => [...m, { id: nextId(), role: "assistant", content: res.message, actions }]);
      if (actions.trades!.length || actions.watchlist_changes!.length) onActions?.(actions);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: nextId(),
          role: "error",
          content: err instanceof Error ? `Message not answered: ${err.message}` : "Message not answered. Try again.",
          actions: null,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  if (collapsed) {
    return (
      <aside data-testid="chat-panel" data-collapsed="true" className="flex w-10 shrink-0 flex-col items-center border-l border-line bg-panel">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Open AI assistant"
          className="mt-2 flex h-8 w-8 items-center justify-center text-accent hover:bg-raised"
        >
          ‹
        </button>
        <span className="mt-3 text-xs text-muted [writing-mode:vertical-rl]">AI assistant</span>
      </aside>
    );
  }

  return (
    <aside data-testid="chat-panel" data-collapsed="false" className="flex w-[360px] shrink-0 flex-col border-l border-line bg-panel">
      <header className="flex h-7 shrink-0 items-center justify-between border-b border-line px-2.5">
        <h2 className="text-[13px] font-semibold">
          AI assistant <span className="font-normal text-muted">trades and watchlist on request</span>
        </h2>
        <button type="button" onClick={onToggle} aria-label="Collapse AI assistant" className="px-1 text-muted hover:text-ink">
          ›
        </button>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
        {messages.length === 0 && !loading ? (
          <div className="space-y-2 text-[13px] text-muted">
            <p>Ask about your positions, or tell me what to trade. Orders fill instantly at market.</p>
            <div className="flex flex-col items-start gap-1">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="border border-line px-2 py-0.5 text-xs text-ink hover:border-blue">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((m) => (
          <ChatBubble key={m.id} m={m} />
        ))}
        {loading ? (
          <div data-testid="chat-loading" role="status" aria-label="Assistant is thinking" className="flex items-center gap-1.5 text-xs text-muted">
            <span className="dot-pulse inline-block h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="dot-pulse inline-block h-1.5 w-1.5 rounded-full bg-accent [animation-delay:200ms]" />
            <span className="dot-pulse inline-block h-1.5 w-1.5 rounded-full bg-accent [animation-delay:400ms]" />
            <span className="ml-1">Thinking…</span>
          </div>
        ) : null}
      </div>
      <form onSubmit={onSubmit} className="flex shrink-0 gap-1.5 border-t border-line p-2">
        <input
          data-testid="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask or instruct, e.g. sell half my TSLA"
          aria-label="Message the AI assistant"
          className="min-w-0 flex-1 border border-line bg-canvas px-2 py-1.5 text-sm placeholder:text-faint focus:border-blue focus:outline-none"
        />
        <button
          type="submit"
          data-testid="chat-send-button"
          disabled={loading || !input.trim()}
          className="bg-purple px-3 py-1.5 text-sm font-semibold text-white hover:bg-purple-hover disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </aside>
  );
}
