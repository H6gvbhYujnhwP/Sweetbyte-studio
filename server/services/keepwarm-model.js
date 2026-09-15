/**
 * server/services/keepwarm-model.js — Studio's Claude call, wrapped in the one
 * small interface the keep-warm engine asks for.
 *
 * The engine knows nothing about Anthropic, API keys or content blocks. It
 * calls complete({ system, user, temperature }) and gets a string back. That is
 * the whole contract, and keeping it that narrow is what makes the engine
 * testable without a network connection.
 *
 * TWO THINGS THIS DOES BEYOND CALLING THE API
 *
 * 1. Joins the response's text blocks into one string.
 * 2. Strips a stray markdown fence, and, failing that, lifts out the outermost
 *    { ... }. The prompts all say "JSON only"; the checker downstream is strict
 *    about it on purpose, because tolerating prose around a JSON object is how
 *    half a response becomes a draft. But a stray fence is not a reason to cost
 *    the operator a whole generation run, so it is dealt with here rather than
 *    by loosening the checker.
 *
 * LOGGING
 * Which call it was, how big the answer was, and what it cost in tokens.
 * Never the prompt, never the knowledge base, never the generated copy, never
 * the key. A log line that contains 22KB of company knowledge base on every
 * generation is not a log line anybody reads.
 *
 * Env: ANTHROPIC_API_KEY (required).
 */

import Anthropic from '@anthropic-ai/sdk';
import { unwrapJsonText } from './keepwarm-engine-validator.js';

const MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 8000;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let counter = 0;

/**
 * @param {{ label?: string }} options — `label` names the call in the log:
 *        'batch', 'repair', 'subject', 'body', 'from-subject'.
 */
export function createKeepWarmModel({ label = 'model' } = {}) {
  return {
    async complete({ system, user, temperature }) {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY is not set on Studio.');
      }

      const id = `kw${++counter}`;
      const started = Date.now();

      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: typeof temperature === 'number' ? temperature : undefined,
        system,
        messages: [{ role: 'user', content: user }],
      });

      const text = (message.content || [])
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');

      const usage = message.usage || {};
      console.log(
        `[keepwarm] ${label} ${id}: ${text.length} chars in ${Date.now() - started}ms ` +
        `(in ${usage.input_tokens ?? '?'} / out ${usage.output_tokens ?? '?'} tokens, stop: ${message.stop_reason})`,
      );

      if (message.stop_reason === 'max_tokens') {
        throw new Error(
          'The model ran out of room mid-answer, so the last email came back unfinished. Ask for a smaller batch.',
        );
      }

      return unwrapJsonText(text);
    },
  };
}
