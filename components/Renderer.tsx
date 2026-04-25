import React from 'react';
import type { UIBlock } from '../lib/runModels.js';

interface RendererProps {
  ui: UIBlock;
}

export function Renderer({ ui }: RendererProps) {
  switch (ui.type) {
    case "chart":
      return <Chart data={ui.data} />;
    case "table":
      return <Table data={ui.data} />;
    case "timeline":
      return <Timeline data={ui.data} />;
    case "scenario":
      return <ScenarioChart data={ui.data} />;
    default:
      return <div>Unknown UI type</div>;
  }
}

function Chart({ data }: { data: any }) {
  // Placeholder chart component
  return <div>Chart: {JSON.stringify(data)}</div>;
}

function Table({ data }: { data: any }) {
  // Placeholder table component
  return <div>Table: {JSON.stringify(data)}</div>;
}

function Timeline({ data }: { data: any }) {
  // Placeholder timeline component
  return <div>Timeline: {JSON.stringify(data)}</div>;
}

function ScenarioChart({ data }: { data: any }) {
  // Placeholder scenario chart
  return <div>Scenario: {JSON.stringify(data)}</div>;
}