import { demoProvider } from './demo.js';

export interface GenerateInput {
  prompt: string;
  durationSec: number;
  width: number;
  height: number;
  /** Where the provider must write the finished MP4. */
  outPath: string;
  signal: AbortSignal;
}

export interface GenerateResult {
  /** What the call cost, recorded on the generation row. */
  costUsd?: number;
  providerJobId?: string;
}

/**
 * A scene-generation backend. To add a real model (Runway, Kling, Veo, Luma…),
 * implement this interface: submit the job to the provider, poll until it is
 * done, download the video to `outPath`, and return the cost. Register it in
 * PROVIDERS and add its API key to the environment.
 */
export interface GenerationProvider {
  id: string;
  label: string;
  models: string[];
  generate(input: GenerateInput): Promise<GenerateResult>;
}

const PROVIDERS: GenerationProvider[] = [demoProvider];

export function findProvider(model: string): GenerationProvider | undefined {
  return PROVIDERS.find((p) => p.models.includes(model));
}

export function listModels() {
  return PROVIDERS.flatMap((p) => p.models.map((m) => ({ id: m, provider: p.id, label: p.label })));
}
