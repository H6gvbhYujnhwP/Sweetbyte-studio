/**
 * Run with:  node --test server/services/keepwarm-engine-tests.js
 *
 * The first tests are the ones supplied with the engine package, with their
 * import paths changed and their fixtures brought up to the bulleted email
 * shape. The rest cover the changes made during integration, each written from
 * a failure found by running the package against real Sweetbyte copy.
 *
 * Nothing in here touches the network, the disk or the Anthropic SDK. The
 * engine takes a model adapter, so the model is a fake that hands back
 * prepared answers, and the conversion pair now lives in email-body-style.js,
 * which has no dependencies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PARAGRAPH_STYLE } from './keepwarm-engine-prompts.js';
import { parseJsonOnly, validateEmail, validateSubject, unwrapJsonText } from './keepwarm-engine-validator.js';
import { planSlots, planInterestSlot, KeepWarmEngine } from './keepwarm-engine-core.js';
import { CONTENT_PATTERNS, INTEREST_PATTERNS, patternForInterest, SUBJECT_PREFIX, withSubjectPrefix } from './keepwarm-engine-patterns.js';
import { htmlToText, textToHtml } from './email-body-style.js';

const knowledgeBase = `${'Sweetbyte provides managed IT support, websites, apps, cyber security and Microsoft 365. '.repeat(10)} 25 years 99.9%`;

const paragraphs = [
  'Passwords are difficult to manage when every account needs a different one. Storing them in browsers, documents or messages also makes access harder to control when responsibilities change.',
  'A business password manager gives authorised people one protected place to create, store and share credentials, without anybody having to remember every login.',
  'A password system usually earns its place on four counts:',
  '• **Shared safely:** credentials can be given to a colleague without being emailed',
  '• **Removed quickly:** access ends the day somebody leaves the business',
  '• **Stronger by default:** long random passwords stop being a memory problem',
  '• **Visible:** you can see which accounts exist and who reaches them',
  'If password handling is something you are reviewing, reply with the part that causes the most uncertainty and we can offer an informal view.',
];

/**
 * The HTML half of a body, built from the plain half. The bold markers the
 * operator sees in the editing box become the <strong> the message carries,
 * which is the same conversion textToHtml does, so a fixture cannot drift from
 * what the app would actually store.
 */
function html(paras) {
  return textToHtml(paras.join('\n\n'));
}

const valid = {
  angle: 'safer everyday password management',
  subject: `${SUBJECT_PREFIX}Safer passwords`,
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
    html: `<em>${valid.html}</em>`,
  };
  const errors = validateEmail(broken, { knowledgeBase });
  assert.ok(errors.some(x => x.includes('sign-off')));
  assert.ok(errors.some(x => x.includes('Numeric claim')));
  assert.ok(errors.some(x => x.includes('invalid markup')));
});

test('rejects similar or spam-like subjects', () => {
  assert.ok(validateSubject('FREE offer!', []).length > 0);
  assert.ok(validateSubject(`${SUBJECT_PREFIX}Better Wi-Fi`, [`${SUBJECT_PREFIX}Better Business Wi-Fi`]).length > 0);
});

test('requires JSON only', () => {
  assert.throws(() => parseJsonOnly('```json\n{}\n```'));
  assert.deepEqual(parseJsonOnly('{"emails":[]}'), { emails: [] });
});

test('plans distinct slots deterministically', () => {
  const count = CONTENT_PATTERNS.length;
  const first = planSlots({ count, seed: '2026-09-15' });
  const second = planSlots({ count, seed: '2026-09-15' });
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(x => x.serviceId)).size, count);
  assert.equal(new Set(first.map(x => x.openingMove)).size, 5);
});

// ── Backups is no longer one of the subject areas ───────────────────────────

test('there is no backups subject area for the planner to pick', () => {
  assert.equal(CONTENT_PATTERNS.some(p => p.id === 'backups'), false);
  const text = JSON.stringify(CONTENT_PATTERNS).toLowerCase();
  assert.equal(text.includes('backup'), false, 'no slot may nudge the model towards backups');
  assert.equal(text.includes('restore'), false);
});

test('a full batch still has one distinct area per email', () => {
  const slots = planSlots({ count: 9, seed: 'any' });
  assert.equal(new Set(slots.map(x => x.serviceId)).size, 9);
});

// ── Every subject carries the standing prefix ───────────────────────────────

test('a generated subject without the prefix is refused', () => {
  const errors = validateSubject('Safer passwords across the team', []);
  assert.ok(errors.some(x => x.includes(SUBJECT_PREFIX)));
});

test('the character limit is measured after the prefix, not on it', () => {
  const fortyEight = 'a'.repeat(48);
  assert.deepEqual(validateSubject(`${SUBJECT_PREFIX}${fortyEight}`, []), []);
  assert.ok(validateSubject(`${SUBJECT_PREFIX}${'a'.repeat(49)}`, []).some(x => x.includes('48-character')));
});

test('the prefix is put on once and never twice', () => {
  assert.equal(withSubjectPrefix('Safer passwords'), `${SUBJECT_PREFIX}Safer passwords`);
  assert.equal(withSubjectPrefix(`${SUBJECT_PREFIX}Safer passwords`), `${SUBJECT_PREFIX}Safer passwords`);
  assert.equal(withSubjectPrefix('  Safer passwords  '), `${SUBJECT_PREFIX}Safer passwords`);
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

// ── The bullet section ──────────────────────────────────────────────────────

test('a body with no bullet section is refused', () => {
  const noBullets = [
    paragraphs[0],
    paragraphs[1],
    'A password system can make sharing safer, remove access the day somebody leaves, keep long random passwords out of anybody memory and show which accounts exist in the first place.',
    'Most of the work is in the setting up rather than the running, and it tends to make the day to day simpler rather than more complicated for the people using it.',
    'The same approach makes staff changes easier because access is updated in one place instead of several.',
    'It also gives the business a clearer process than relying on notes held by one person.',
    paragraphs[7],
  ];
  const errors = validateEmail({ ...valid, plain: noBullets.join('\n\n'), html: html(noBullets) }, { knowledgeBase });
  assert.ok(errors.some(x => x.includes('bullet section')));
});

test('too many bullets is refused', () => {
  const many = [
    paragraphs[0], paragraphs[1], paragraphs[2],
    '• **Shared safely:** credentials can be given to a colleague without being emailed',
    '• **Removed quickly:** access ends the day somebody leaves the business',
    '• **Stronger by default:** long random passwords stop being a memory problem',
    '• **Visible:** you can see which accounts exist and who reaches them',
    '• **One place:** everything sits in a single protected system',
    '• **Simpler joining:** a new starter gets what they need on day one',
    paragraphs[7],
  ];
  const errors = validateEmail({ ...valid, plain: many.join('\n\n'), html: html(many) }, { knowledgeBase });
  assert.ok(errors.some(x => x.includes('bullet section')));
});

test('a bullet with no bold label is refused', () => {
  const unlabelled = paragraphs.map(p => (p.startsWith('•') ? p.replace(/\*\*/g, '') : p));
  const errors = validateEmail({ ...valid, plain: unlabelled.join('\n\n'), html: html(unlabelled) }, { knowledgeBase });
  assert.ok(errors.some(x => x.includes('bold label')));
});

test('bold anywhere outside a bullet label is refused', () => {
  const extraBold = [...paragraphs];
  extraBold[1] = extraBold[1].replace('password manager', '**password manager**');
  const errors = validateEmail({ ...valid, plain: extraBold.join('\n\n'), html: html(extraBold) }, { knowledgeBase });
  assert.ok(errors.some(x => x.includes('nowhere else')));
});

test('bullets split apart by an ordinary paragraph are refused', () => {
  const split = [
    paragraphs[0], paragraphs[1], paragraphs[2],
    paragraphs[3], paragraphs[4],
    'That last point is the one most businesses find hardest to keep on top of as people come and go.',
    paragraphs[5], paragraphs[6],
    paragraphs[7],
  ];
  const errors = validateEmail({ ...valid, plain: split.join('\n\n'), html: html(split) }, { knowledgeBase });
  assert.ok(errors.some(x => x.includes('sit together')));
});

test('hyphen bullets are refused rather than quietly accepted', () => {
  const hyphens = paragraphs.map(p => p.replace(/^• /, '- '));
  const errors = validateEmail({ ...valid, plain: hyphens.join('\n\n'), html: html(hyphens) }, { knowledgeBase });
  assert.ok(errors.some(x => x.includes('not hyphens')));
});

test('an email may not end on a bullet point', () => {
  // The call to action tucked into the last bullet, with no closing paragraph
  // after it, is the shape a model falls into when it runs out of room. The
  // email reads as a list that stops rather than as a message.
  const noClose = paragraphs.slice(0, 7).concat(['• **Just reply:** tell us how passwords are handled now and we will give you an informal view']);
  const errors = validateEmail({ ...valid, plain: noClose.join('\n\n'), html: html(noClose) }, { knowledgeBase });
  assert.ok(errors.some(x => x.includes('close with a paragraph')), errors.join(' | '));
});

// ── Bold survives the editing box ───────────────────────────────────────────

test('a bold label goes to the editing box as markers and comes back as a tag', () => {
  const editable = htmlToText(valid.html, { keepBold: true });
  assert.ok(editable.includes('• **Shared safely:** credentials'), editable);
  assert.equal(textToHtml(editable), valid.html, 'an untouched draft must save back byte for byte');
});

test('an edited draft keeps its bold and its paragraph style', () => {
  const edited = htmlToText(valid.html, { keepBold: true }).replace('colleague', 'coworker');
  const saved = textToHtml(edited);
  assert.ok(saved.includes('<strong>Shared safely:</strong>'));
  assert.ok(saved.includes('coworker'));
  assert.equal((saved.match(/<strong>/g) || []).length, 4);
  assert.equal(validateEmail({ ...valid, plain: edited, html: saved }, { knowledgeBase }).length, 0);
});

test('the plain-text half of a real email has no asterisks in it', () => {
  const sent = htmlToText(valid.html);
  assert.equal(sent.includes('*'), false, sent);
  assert.ok(sent.includes('• Shared safely: credentials'));
});

test('typed angle brackets are still escaped and a typed tag is not honoured', () => {
  const saved = textToHtml('A & B <script>alert(1)</script> and <strong>not bold</strong>');
  assert.ok(saved.includes('&amp;'));
  assert.ok(saved.includes('&lt;script&gt;'));
  assert.equal(saved.includes('<strong>'), false, 'only ** markers may produce bold');
});

// ── An email about telephones is allowed to mention a telephone call ────────

const voipParagraphs = [
  'A phone system that lives on one desk made sense when everybody was at that desk. It fits less well now that the same people work in the office some days and elsewhere on others.',
  'When a call comes in to a fixed handset, it rings in one place and nowhere else. Anybody working at home or out on site is unreachable on the main number.',
  'Modern telephony tends to help in a few practical ways:',
  '• **One number:** the same line reaches a desk phone, mobile or computer',
  '• **Easy changes:** users can be added or removed as the team changes',
  '• **Out of hours:** calls can follow a rule rather than a person',
  'If your current system no longer fits how your team works, reply and tell us how it is set up now.',
];

test('a body about phone calls is not mistaken for asking the reader to phone', () => {
  const voip = {
    angle: 'phones for flexible working',
    subject: `${SUBJECT_PREFIX}Does your phone system follow you?`,
    plain: voipParagraphs.join('\n\n'),
    html: html(voipParagraphs),
  };
  assert.deepEqual(validateEmail(voip, { knowledgeBase }), []);
});

test('a body with no call to action at all is refused', () => {
  const noCta = [...voipParagraphs.slice(0, 6), 'Most systems can be changed over without any interruption to the working day, and the existing numbers move across unchanged.'];
  const errors = validateEmail(
    { angle: 'phones for flexible working', subject: `${SUBJECT_PREFIX}Phones that follow you`, plain: noCta.join('\n\n'), html: html(noCta) },
    { knowledgeBase },
  );
  assert.ok(errors.some(x => x.includes('call to action')));
});

test('a body asking for both a reply and a call is refused', () => {
  const both = [...voipParagraphs.slice(0, 6), 'If that sounds familiar, reply to this email or give us a call and we can talk it through with you at whatever length suits.'];
  const errors = validateEmail(
    { angle: 'phones for flexible working', subject: `${SUBJECT_PREFIX}Phones that follow you`, plain: both.join('\n\n'), html: html(both) },
    { knowledgeBase },
  );
  assert.ok(errors.some(x => x.includes('both a reply and a call')));
});

// ── The operator's own subject line is not the model's to judge ─────────────

test("a hand-written subject line survives checks that would refuse a generated one", () => {
  const ownLine = withSubjectPrefix('Fed up with IT support that only shows up when something breaks?!');
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
  return { angle, subject: withSubjectPrefix(subject), plain: paras.join('\n\n'), html: html(paras) };
}

test('a batch keeps the emails that passed and reports the one that did not', async () => {
  const tooShort = {
    angle: 'one awkward repeated process',
    subject: `${SUBJECT_PREFIX}Is that job still manual?`,
    plain: 'Far too short to be a keep-warm email.',
    html: html(['Far too short to be a keep-warm email.']),
  };
  const batch = {
    emails: [
      goodEmail('Safer passwords across the team', 'safer everyday password management', paragraphs),
      goodEmail('Does your phone system follow you?', 'phones for flexible working', voipParagraphs),
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

test("a body is written under the operator's own line and the line comes back with the prefix on the front", async () => {
  const typed = 'Fed up with IT support that only shows up when something breaks?!';
  const expected = `${SUBJECT_PREFIX}${typed}`;
  const engine = new KeepWarmEngine(fakeModel([{ ...valid, subject: expected }]));
  const result = await engine.writeFromSubject({ knowledgeBase, subject: typed });
  assert.equal(result.subject, expected);
  assert.ok(result.subject.endsWith('breaks?!'), 'the wording is left exactly as typed');
});

test('a subject-only rewrite leaves the body alone and gets the prefix', async () => {
  const engine = new KeepWarmEngine(fakeModel([{ subject: 'Where do your passwords live?' }]));
  const result = await engine.rewriteSubject({ knowledgeBase, body: valid.plain, currentSubject: `${SUBJECT_PREFIX}Old line`, rejectedSubjects: [] });
  assert.equal(result.subject, `${SUBJECT_PREFIX}Where do your passwords live?`);
  assert.equal(Object.keys(result).length, 1, 'nothing but the subject comes back');
});

test('a body-only rewrite keeps the subject exactly', async () => {
  const subject = `${SUBJECT_PREFIX}Safer passwords`;
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


// ── Service-interest lanes ──────────────────────────────────────────────────
//
// Pressing Write on a lane card means the topic has already been decided, so
// these check the decision is honoured rather than quietly replaced. The one
// failure that would never be spotted before an email went out is a general
// email sitting under a service heading, so the refusal is tested as carefully
// as the success.

// The nine keys as they stand in keepwarm-store.js. Repeated here rather than
// imported because that module opens the database on import, which this file
// deliberately never does.
const INTEREST_KEY_LIST = [
  'cyber_security', 'internet', 'wifi', 'website',
  'domains', 'microsoft_365', 'voip', 'custom_apps',
];

test('every service interest has a complete writing brief', () => {
  for (const key of INTEREST_KEY_LIST) {
    const slot = planInterestSlot({ interestKey: key, seed: '2026-09-17' });
    assert.equal(slot.serviceId, key, `${key} must write about itself`);
    for (const field of ['angle', 'readerPain', 'usefulPoint', 'ctaPrompt', 'openingMove', 'ctaMode']) {
      assert.ok(slot[field], `${key} is missing ${field}`);
    }
  }
  assert.equal(Object.keys(INTEREST_PATTERNS).length, INTEREST_KEY_LIST.length);
});

test('a lane with no brief refuses rather than writing a general email', () => {
  assert.equal(patternForInterest('backups'), null);
  assert.throws(() => planInterestSlot({ interestKey: 'backups' }), /no writing brief/i);
  assert.throws(() => planInterestSlot({ interestKey: '' }), /no writing brief/i);
});

test('no lane brief nudges the model towards backups', () => {
  const text = JSON.stringify(INTEREST_PATTERNS).toLowerCase();
  assert.equal(text.includes('backup'), false);
  assert.equal(text.includes('restore'), false);
});

test('the nothing-ticked lane writes the general IT support email', () => {
  const slot = planInterestSlot({ interestKey: '__none', seed: '2026-09-17' });
  assert.equal(slot.serviceId, 'general');
  assert.match(slot.angle, /support/i);
});

test('the same lane does not write the same email every fortnight', () => {
  const moves = new Set(
    ['2026-09-17', '2026-10-01', '2026-10-15', '2026-10-29']
      .map(seed => planInterestSlot({ interestKey: 'website', seed }).openingMove),
  );
  assert.ok(moves.size > 1, 'the opening move must vary across send days');
});

test('a lane draft goes through the same checks as any other email', async () => {
  // One email, topic supplied rather than planned. The model is the same fake
  // the batch tests use, and the validator is not told to go easy on it.
  const email = goodEmail('Websites on a phone', 'website usefulness and maintenance', paragraphs);
  const engine = new KeepWarmEngine(fakeModel([JSON.stringify({ emails: [email] })]));
  const slot = planInterestSlot({ interestKey: 'website', seed: '2026-09-17' });
  const result = await engine.generateBatch({
    count: 1,
    knowledgeBase,
    slots: [slot],
  });
  assert.equal(result.emails.length, 1);
  assert.equal(result.rejected.length, 0);
});

test('IT support is no longer a lane of its own', () => {
  // Merged into the general email. A brief here would mean Write producing a
  // second general email under a service heading, sent to a list that overlaps
  // the real one.
  assert.equal(patternForInterest('it_support'), null);
  assert.throws(() => planInterestSlot({ interestKey: 'it_support' }), /no writing brief/i);
  assert.equal(Object.prototype.hasOwnProperty.call(INTEREST_PATTERNS, 'it_support'), false);
});

test('the general email still covers IT support', () => {
  const slot = planInterestSlot({ interestKey: '__none', seed: '2026-09-17' });
  assert.match(slot.angle, /IT support/i);
});
