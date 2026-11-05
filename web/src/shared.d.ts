// Minimal types for the shared pure-JS catalogs reused from the agent.
declare module '*/clientstate.mjs' {
  export const QUEUES: { id: number; ko: string }[];
  export const POSITIONS: string[];
}
