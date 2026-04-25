import type { Source } from "./fetchSources.js";

export type EvidencePack = {
  query: string;
  sources: Source[];
};

export function buildEvidencePack(query: string, sources: Source[]): EvidencePack {
  return {
    query,
    sources,
  };
}