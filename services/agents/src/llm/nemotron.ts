import OpenAI from "openai";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

export type NemotronConfig = {
  apiKey: string | undefined;
  plannerModel: string | undefined;
  workerModel: string | undefined;
  baseURL: string;
};

export interface LlmClient {
  listModels(): Promise<string[]>;
}

export interface ReplayLlm {
  listModels(): Promise<string[]>;
}

export function readNemotronConfig(): NemotronConfig {
  return {
    apiKey: process.env.NVIDIA_API_KEY,
    plannerModel: process.env.NEMOTRON_PLANNER_MODEL,
    workerModel: process.env.NEMOTRON_WORKER_MODEL,
    baseURL: NVIDIA_BASE_URL,
  };
}

export function createNemotronClient(config: NemotronConfig = readNemotronConfig()): LlmClient {
  if (process.env.LLM_REPLAY === "true") {
    return new ReplayLlmClient();
  }
  return new NvidiaLlmClient(config);
}

class NvidiaLlmClient implements LlmClient {
  private readonly client: OpenAI;

  constructor(config: NemotronConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async listModels(): Promise<string[]> {
    const page = await this.client.models.list();
    return page.data.map((model) => model.id);
  }
}

class ReplayLlmClient implements ReplayLlm, LlmClient {
  async listModels(): Promise<string[]> {
    return [];
  }
}
