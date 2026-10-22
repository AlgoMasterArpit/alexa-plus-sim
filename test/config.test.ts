import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConfigError, loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('defaults to Claude on Bedrock with low effort on loopback', () => {
    const config = loadConfig({});

    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 8788);
    assert.deepEqual(config.llm, {
      provider: 'bedrock',
      model: 'anthropic.claude-opus-5-5',
      effort: 'low',
      region: 'us-east-1',
    });
  });

  it('picks the matching default model for the Anthropic API', () => {
    assert.equal(loadConfig({ SIM_LLM_PROVIDER: 'anthropic' }).llm.model, 'claude-opus-5-5');
  });

  it('honours an explicit model override', () => {
    assert.equal(
      loadConfig({ SIM_MODEL: 'anthropic.claude-sonnet-5-5' }).llm.model,
      'anthropic.claude-sonnet-5-5',
    );
  });

  it('refuses to bind beyond loopback', () => {
    assert.throws(() => loadConfig({ HOST: '0.0.0.0' }), ConfigError);
  });

  it('rejects unknown providers', () => {
    assert.throws(() => loadConfig({ SIM_LLM_PROVIDER: 'other' }), ConfigError);
  });
});
