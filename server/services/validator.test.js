/**
 * Run with:  node --test server/services/keepwarm-engine/
 *
 * The first five tests are the ones supplied with the engine package, with only
 * their import paths changed. The rest cover the changes made during
 * integration, each written from a failure found by running the package against
 * real Sweetbyte copy.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PARAGRAPH_STYLE } from './prompts.js';
import { parseJsonOnly, validateEmail, validateSubject } from './validator.js';
import { planSlots, KeepWarmEngine } from './engine.js';
import { unwrapJsonText } from './validator.js';

const knowledgeBase = `${'Sweetbyte provides managed IT support, websites, apps, cyber security, backups and Microsoft 365. '.repeat(10)} 25 years 99.9%`;

const paragraphs = [
  'Passwords are difficult to manage when every account needs a different strong password. Storing them in browsers, documents or messages can also make access harder to control when responsibilities change.',
  'A business password manager gives authorised people one protected place to create, store and share credentials. It can make everyday access simpler while reducing the temptation to reuse memorable passwords across several services.',
  'The same approach can make staff changes easier because access can be updated centrally. It also gives the business a clearer process than relying on informal notes or knowledge held by one person.',
  'If password handling is an area you are reviewing, reply with the part that causes the most uncertainty and we can offer an informal view.',
];

function html(paras) {
  return paras.map(p => `<p style="${PARAGRAPH_STYLE}">${p}</p>`).join('');
}

const valid = {
  angle: 'safer everyday password management',
  subject: 'Sweetbyte IT - Safer Passwords',
  plain: paragraphs.join('\n\n'),
  html: html(paragraphs),
};

// ── Supplied with the package ───────────────────────────────────────────────

test('accepts a valid email', () => {
  assert.deepEqual(validateEmail(valid, { knowledgeBase }), []);
});

test('rejects markup, sign-offs and invented numbers', () => {
  const broken = {
    ...valid,
    plain: `${valid.plain}\n\nKind regards, call 01702 000000`,
    html: `<strong>${valid.html}</strong>`,
  };
  const errors = validateEmail(broken, { knowledgeBase });
  assert.ok(errors.some(x => x.includes('sign-off')));
  assert.ok(errors.some(x => x.includes('Numeric claim')));
  assert.ok(errors.some(x => x.includes('invalid markup')));
});

test('rejects similar or spam-like subjects', () => {
  assert.ok(validateSubject('FREE offer!', []).length > 0);
  assert.ok(validateSubject('Sweetbyte IT - Better Wi-Fi', ['Sweetbyte IT - Better Business Wi-Fi']).length > 0);
});

test('requires JSON only', () => {
  assert.throws(() => parseJsonOnly('```json\n{}\n```'));
  assert.deepEqual(parseJsonOnly('{"emails":[]}'), { emails: [] });
});

test('plans distinct slots deterministically', () => {
  const first = planSlots({ count: 9, seed: '2026-09-15' });
  const second = planSlots({ count: 9, seed: '2026-09-15' });
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(x => x.serviceId)).size, 9);
  assert.equal(new Set(first.map(x => x.openingMove)).size, 5);
});

// ── The paragraph style is Studio's, not the package's Arial ────────────────

test('the paragraph style is the one Studio sets its email bodies in', () => {
  assert.ok(PARAGRAPH_STYLE.includes('Aptos'), 'must use the Aptos stack');
  assert.ok(PARAGRAPH_STYLE.includes('11pt'), 'must be sized in points, not pixels');
  assert.ok(!PARAGRAPH_STYLE.includes('15px'));
});

test('a body in any other paragraph style is refused', () => {
  const wrongStyle = {
    ...valid,
    html: paragraphs.map(p => `<p style="font-family:Arial;font-size:15px;">${p}</p>`).join(''),
  };
  const errors = validateEmail(wrongStyle, { knowledgeBase });
  assert.ok(errors.some(x => x.includes('invalid markup')));
});

// ── An email about telephones is allowed to mention a telephone call ────────

const voipParagraphs = [
  'A phone system that lives on one desk made sense when everybody was at that desk. It fits less well now that the same people are in the office some days and working elsewhere on others.',
  'When a call comes in to a fixed handset, it rings in one place and nowhere else. Anybody at home or out on site is simply unreachable on the main number, and the usual workaround is somebody handing out a mobile number instead.',
  'Modern telephony can follow a person across a desk phone, a mobile and a computer, so the same number reaches them wherever they happen to be working that day.',
  'If your current system no longer fits how your team actually works, reply and tell us how it is set up now.',
];

test('a body about phone calls is not mistaken for asking the reader to phone', () => {
  const voip = {
    angle: 'phones for flexible working',
    subject: 'Does your phone system follow your team?',
    plain: voipParagraphs.join('\n\n'),
    html: html(voipParagraphs),
  };
  assert.deepEqual(validateEmail(voip, { knowledgeBase }), []);
});

test('a body with no call to action at all is refused', () => {
  const noCta = [...voipParagraphs.slice(0, 3), 'Most systems can be changed over without any interruption to the working day, and the numbers themselves move across unchanged.'];
  const errors = validateEmail(
    { angle: 'phones for flexible working', subject: 'Phones that follow your team', plain: noCta.join('\n\n'), html: html(noCta) },
    { knowledgeBase },
  );
  assert.ok(errors.some(x => x.includes('call to action')));
});

test('a body asking for both a reply and a call is refused', () => {
  const both = [...voipParagraphs.slice(0, 3), 'If that sounds familiar, reply to this email or give us a call and we can talk it through with you at whatever length suits.'];
  const errors = validateEmail(
    { angle: 'phones for flexible working', subject: 'Phones that follow your team', plain: both.join('\n\n'), html: html(both) },
    { knowledgeBase },
  );
  assert.ok(errors.some(x => x.includes('both a reply and a call')));
});

// ── The operator's own subject line is not the model's to judge ─────────────

test("a hand-written subject line survives checks that would refuse a generated one", () => {
  const ownLine = 'Fed up with IT support that only shows up when something breaks?!';
  assert.ok(ownLine.length > 64, 'this fixture must be over the generated-subject limit');
  assert.ok(validateSubject(ownLine, []).length > 0, 'as a generated subject it would be refused');

  const email = { ...valid, subject: ownLine };
  assert.deepEqual(validateEmail(email, { knowledgeBase, fixedSubject: ownLine }), []);
});

test('a changed fixed subject is caught', () => {
  const email = { ...valid, subject: 'Something the model preferred' };
  const errors = validateEmail(email, { knowledgeBase, fixedSubject: 'The line Billy typed' });
  assert.ok(errors.some(x => x.includes('had to stay exactly as written')));
});

// ── Batch sizes ─────────────────────────────────────────────────────────────

test('any batch size from one to nine is planned, not only three six and nine', () => {
  for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    assert.equal(planSlots({ count, seed: 'x' }).length, count);
  }
  assert.throws(() => planSlots({ count: 0, seed: 'x' }));
  assert.throws(() => planSlots({ count: 10, seed: 'x' }));
});

// ── One bad email does not lose the batch ──────────────────────────────────

function fakeModel(responses) {
  let i = 0;
  return {
    calls: [],
    complete(request) {
      this.calls.push(request);
      const next = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return Promise.resolve(typeof next === 'string' ? next : JSON.stringify(next));
    },
  };
}

function goodEmail(subject, angle, paras) {
  return { angle, subject, plain: paras.join('\n\n'), html: html(paras) };
}

test('a batch keeps the emails that passed and reports the one that did not', async () => {
  const tooShort = { angle: 'backup restore confidence gap', subject: 'Is your backup tested?', plain: 'Far too short to be a keep-warm email.', html: html(['Far too short to be a keep-warm email.']) };
  const batch = {
    emails: [
      goodEmail('Safer passwords across the team', 'safer everyday password management', paragraphs),
      goodEmail('Does your phone system follow your team?', 'phones for flexible working', voipParagraphs),
      tooShort,
    ],
  };
  // Every repair attempt hands back the same unusable email.
  const model = fakeModel([batch, tooShort, tooShort, tooShort, tooShort]);
  const engine = new KeepWarmEngine(model);

  const result = await engine.generateBatch({ count: 3, knowledgeBase });
  assert.equal(result.emails.length, 2);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].position, 3);
  assert.ok(result.rejected[0].errors.some(x => x.includes('120 to 200')));
});

test('a batch where everything fails is refused rather than half-saved', async () => {
  const rubbish = { emails: [{ angle: 'a', subject: '', plain: '', html: '' }] };
  const engine = new KeepWarmEngine(fakeModel([rubbish]));
  await assert.rejects(
    engine.generateBatch({ count: 1, knowledgeBase }),
    /failed its checks/,
  );
});

test('generation refuses to run without a knowledge base', async () => {
  const engine = new KeepWarmEngine(fakeModel([{ emails: [] }]));
  await assert.rejects(
    engine.generateBatch({ count: 3, knowledgeBase: '' }),
    /knowledge base is missing/i,
  );
  assert.equal(engine.model.calls.length, 0, 'the model must not be called at all');
});

test("a body is written under the operator's own line and the line comes back untouched", async () => {
  const ownLine = 'Fed up with IT support that only shows up when something breaks?!';
  const written = { ...valid, subject: ownLine };
  const engine = new KeepWarmEngine(fakeModel([written]));
  const result = await engine.writeFromSubject({ knowledgeBase, subject: ownLine });
  assert.equal(result.subject, ownLine);
});

test('a subject-only rewrite leaves the body alone', async () => {
  const engine = new KeepWarmEngine(fakeModel([{ subject: 'When did you last test a restore?' }]));
  const result = await engine.rewriteSubject({ knowledgeBase, body: valid.plain, currentSubject: 'Old line', rejectedSubjects: [] });
  assert.equal(result.subject, 'When did you last test a restore?');
  assert.equal(Object.keys(result).length, 1, 'nothing but the subject comes back');
});

test('a body-only rewrite keeps the subject exactly', async () => {
  const subject = 'Sweetbyte IT - Safer Passwords';
  const engine = new KeepWarmEngine(fakeModel([{ ...valid, subject }]));
  const result = await engine.rewriteBody({ knowledgeBase, subject, plainBody: 'an older body' });
  assert.equal(result.subject, subject);
});

// ── The adapter tidies a stray fence so the checker can stay strict ─────────

test('a markdown fence is stripped before the strict parse', () => {
  assert.equal(unwrapJsonText('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(unwrapJsonText('Here you go:\n{"a":1}\nHope that helps.'), '{"a":1}');
  assert.equal(unwrapJsonText('{"a":1}'), '{"a":1}');
  assert.deepEqual(parseJsonOnly(unwrapJsonText('```\n{"a":1}\n```')), { a: 1 });
});
