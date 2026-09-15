/**
 * Orchestration: plan the batch, ask the model, check what came back, ask again
 * for anything that failed, hand over what is good.
 *
 * THREE CHANGES FROM THE SUPPLIED PACKAGE
 *
 * 1. A SHORT BATCH IS NOT A FAILED BATCH. The package threw the whole batch
 *    away if a single email was still invalid after its repair attempts, so one
 *    stubborn email out of nine meant the operator got an error message and no
 *    drafts at all. It now returns the ones that passed and reports the ones
 *    that did not. Nothing invalid is ever saved, which was the point of the
 *    check; losing eight good emails was not.
 *
 * 2. COUNTS OF 1 TO 9, not only 3, 6 and 9. Those three are the buttons on the
 *    screen. The number the model is actually asked for is different whenever
 *    the operator has ticked some of their own subject lines: tick two lines in
 *    a batch of six and Studio asks for four. The package refused four.
 *
 * 3. A PATH FOR THE OPERATOR'S OWN SUBJECT LINES — writeFromSubject(). Studio
 *    has always been able to write a body under a line Billy typed himself. The
 *    package had no equivalent, and its nearest method would have refused the
 *    line for having an exclamation mark in it.
 */

import { CONTENT_PATTERNS, OPENING_MOVES, CTA_MODES } from './content-patterns.js';
import {
  buildSystemPrompt,
  buildBatchPrompt,
  buildRepairPrompt,
  buildSubjectRewritePrompt,
  buildBodyRewritePrompt,
  buildFromSubjectPrompt,
} from './prompts.js';
import { parseJsonOnly, validateBatch, validateEmail, validateSubject } from './validator.js';

function hashString(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rotate(values, offset) {
  const n = offset % values.length;
  return values.slice(n).concat(values.slice(0, n));
}

function assertKnowledgeBase(value) {
  if (typeof value !== 'string' || value.trim().length < 500) {
    throw new Error('Company knowledge base is missing from the server — cannot generate.');
  }
}

function assertCount(count) {
  if (!Number.isInteger(count) || count < 1 || count > 9) {
    throw new Error('Count must be a whole number between 1 and 9.');
  }
}

export function planSlots({ count, recentAngles = [], seed = new Date().toISOString().slice(0, 10) }) {
  assertCount(count);
  const recent = new Set(recentAngles.map(x => String(x).toLowerCase()));
  const preferred = CONTENT_PATTERNS.filter(x => !recent.has(x.id));
  const pool = preferred.length >= count ? preferred : CONTENT_PATTERNS;
  const offset = hashString(seed) % pool.length;
  return rotate(pool, offset).slice(0, count).map((pattern, index) => ({
    serviceId: pattern.id,
    angle: pattern.label,
    readerPain: pattern.readerPain,
    usefulPoint: pattern.usefulPoint,
    ctaPrompt: pattern.ctaPrompt,
    openingMove: OPENING_MOVES[(offset + index) % OPENING_MOVES.length],
    ctaMode: CTA_MODES[(offset + index) % CTA_MODES.length],
  }));
}

export class KeepWarmEngine {
  /**
   * @param {{ complete: (request: {system: string, user: string, temperature?: number}) => Promise<string> }} model
   * @param {{ maxRepairAttempts?: number }} options
   */
  constructor(model, { maxRepairAttempts = 2 } = {}) {
    if (!model || typeof model.complete !== 'function') throw new Error('A model.complete adapter is required');
    this.model = model;
    this.maxRepairAttempts = maxRepairAttempts;
  }

  /**
   * Returns { emails, rejected, requested }.
   *
   * `emails` are the ones that passed every check, in slot order. `rejected`
   * describes the ones that did not, so the screen can say what went wrong
   * rather than just showing a smaller number than was asked for.
   *
   * Throws only where there is nothing usable to hand over: no knowledge base,
   * a nonsense count, a response that is not JSON, or a batch in which every
   * single email failed.
   */
  async generateBatch({ count, knowledgeBase, doNotRepeat = [], recentAngles = [], seed }) {
    assertKnowledgeBase(knowledgeBase);
    assertCount(count);

    const slots = planSlots({ count, recentAngles, seed });
    const raw = await this.model.complete({
      system: buildSystemPrompt(),
      user: buildBatchPrompt({ count, knowledgeBase, slots, doNotRepeat }),
      temperature: 0.75,
    });

    const parsed = parseJsonOnly(raw);
    if (!parsed || !Array.isArray(parsed.emails) || parsed.emails.length === 0) {
      throw new Error(`The model did not return any emails when asked for ${count}.`);
    }

    // More than asked for is a model error, not a windfall. The extras are
    // dropped and said out loud rather than quietly kept.
    const extras = Math.max(0, parsed.emails.length - count);
    const items = parsed.emails.slice(0, count);

    for (let attempt = 0; attempt <= this.maxRepairAttempts; attempt += 1) {
      const report = validateBatch({ emails: items }, { count, knowledgeBase, doNotRepeat });
      if (report.global.length) throw new Error(report.global.join('; '));
      if (report.errors.size === 0) break;

      if (attempt === this.maxRepairAttempts) {
        // Out of attempts. Keep the good ones, describe the rest.
        const rejected = [...report.errors].map(([index, errors]) => ({
          position: index + 1,
          area: slots[index]?.angle || null,
          errors,
        }));
        const emails = items.filter((_, index) => !report.errors.has(index));
        if (emails.length === 0) {
          throw new Error(`Every email in the batch failed its checks. First problem: ${rejected[0].errors[0]}`);
        }
        return { emails, rejected, requested: count, extras };
      }

      for (const [index, errors] of report.errors) {
        const repairedRaw = await this.model.complete({
          system: buildSystemPrompt(),
          user: buildRepairPrompt({ knowledgeBase, slot: slots[index], candidate: items[index], errors }),
          temperature: 0.45,
        });
        try {
          items[index] = parseJsonOnly(repairedRaw);
        } catch {
          // Leave the original in place. It will fail again on the next pass
          // and be reported then, which is better than replacing a bad email
          // with nothing and losing the reason it was bad.
        }
      }
    }

    return { emails: items, rejected: [], requested: count, extras };
  }

  /**
   * Write the body for a subject line the operator typed.
   *
   * The line is returned exactly as given. Nothing the model says about the
   * subject is read back, and the subject checks do not run on it.
   */
  async writeFromSubject({ knowledgeBase, subject, doNotRepeat = [], slot = null }) {
    assertKnowledgeBase(knowledgeBase);
    const fixed = String(subject || '').trim();
    if (!fixed) throw new Error('No subject line given.');

    let candidate = parseJsonOnly(await this.model.complete({
      system: buildSystemPrompt(),
      user: buildFromSubjectPrompt({ knowledgeBase, subject: fixed, doNotRepeat }),
      temperature: 0.7,
    }));

    for (let attempt = 0; attempt <= this.maxRepairAttempts; attempt += 1) {
      const errors = validateEmail(candidate, { knowledgeBase, fixedSubject: fixed });
      if (!errors.length) return { ...candidate, subject: fixed };
      if (attempt === this.maxRepairAttempts) {
        throw new Error(`Could not write a usable email under "${fixed}": ${errors.join('; ')}`);
      }
      candidate = parseJsonOnly(await this.model.complete({
        system: buildSystemPrompt(),
        user: buildRepairPrompt({ knowledgeBase, slot, candidate, errors, fixedSubject: fixed }),
        temperature: 0.4,
      }));
    }
    throw new Error('Unreachable validation state');
  }

  async rewriteSubject({ knowledgeBase, body, currentSubject, rejectedSubjects = [] }) {
    assertKnowledgeBase(knowledgeBase);
    const raw = await this.model.complete({
      system: buildSystemPrompt(),
      user: buildSubjectRewritePrompt({ knowledgeBase, body, currentSubject, rejectedSubjects }),
      temperature: 0.8,
    });
    const result = parseJsonOnly(raw);
    const errors = validateSubject(result.subject, [currentSubject, ...rejectedSubjects].filter(Boolean));
    if (errors.length) throw new Error(`Invalid rewritten subject: ${errors.join('; ')}`);
    return result;
  }

  async rewriteBody({ knowledgeBase, subject, plainBody }) {
    assertKnowledgeBase(knowledgeBase);
    const fixed = String(subject || '').trim();
    let candidate = parseJsonOnly(await this.model.complete({
      system: buildSystemPrompt(),
      user: buildBodyRewritePrompt({ knowledgeBase, subject: fixed, plainBody }),
      temperature: 0.65,
    }));
    for (let attempt = 0; attempt <= this.maxRepairAttempts; attempt += 1) {
      const errors = validateEmail(candidate, { knowledgeBase, fixedSubject: fixed });
      if (!errors.length) return { ...candidate, subject: fixed };
      if (attempt === this.maxRepairAttempts) throw new Error(`Invalid rewritten body: ${errors.join('; ')}`);
      candidate = parseJsonOnly(await this.model.complete({
        system: buildSystemPrompt(),
        user: buildRepairPrompt({ knowledgeBase, slot: null, candidate, errors, fixedSubject: fixed }),
        temperature: 0.4,
      }));
    }
    throw new Error('Unreachable validation state');
  }
}
