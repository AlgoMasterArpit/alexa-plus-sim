import { z } from 'zod';

export const LLM_PROVIDERS = ['bedrock', 'anthropic'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  bedrock: 'anthropic.claude-opus-5-5',
  anthropic: 'claude-opus-5-5',
};

const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SIM_LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('bedrock'),
  SIM_MODEL: z.string().min(1).optional(),
  SIM_EFFORT: z.enum(EFFORT_LEVELS).default('low'),
  BEDROCK_REGION: z.string().min(1).default('us-east-1'),
  SIM_DEFAULT_SERVER_URL: z.url().optional(),
});

export interface Config {
  readonly host: string;
  readonly port: number;
  readonly logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  readonly llm: {
    readonly provider: LlmProvider;
    readonly model: string;
    readonly effort: Effort;
    readonly region: string;
  };
  readonly defaultServerUrl: string | undefined;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

function withoutBlankValues(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(withoutBlankValues(env));
  if (!parsed.success) {
    throw new ConfigError(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const values = parsed.data;
  if (!['127.0.0.1', 'localhost', '::1'].includes(values.HOST)) {
    throw new ConfigError(
      'alexa-plus-sim is a local development tool and only binds to loopback addresses.',
    );
  }
  return {
    host: values.HOST,
    port: values.PORT,
    logLevel: values.LOG_LEVEL,
    llm: {
      provider: values.SIM_LLM_PROVIDER,
      model: values.SIM_MODEL ?? DEFAULT_MODELS[values.SIM_LLM_PROVIDER],
      effort: values.SIM_EFFORT,
      region: values.BEDROCK_REGION,
    },
    defaultServerUrl: values.SIM_DEFAULT_SERVER_URL,
  };
}
