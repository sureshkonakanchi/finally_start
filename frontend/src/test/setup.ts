import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Lightweight Charts needs a real canvas; replace it with a no-op chart in jsdom.
vi.mock("lightweight-charts", () => {
  const series = { setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn() };
  const chart = {
    addSeries: vi.fn(() => series),
    remove: vi.fn(),
    applyOptions: vi.fn(),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
  };
  return {
    createChart: vi.fn(() => chart),
    AreaSeries: "Area",
    LineSeries: "Line",
    ColorType: { Solid: "solid" },
  };
});

afterEach(() => {
  cleanup();
});
