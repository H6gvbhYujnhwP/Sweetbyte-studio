import 'dotenv/config';
import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import authRoutes      from './routes/auth.js';
import clientRoutes    from './routes/clients.js';
import campaignRoutes  from './routes/campaigns.js';
import emailRoutes     from './routes/email.js';
import algorithmRoutes from './routes/algorithm.js';
import portalAuthRoutes from './routes/portal-auth.js';
import portalAdminRoutes from './routes/portal-admin.js';
import portalRoutes from './routes/portal.js';
import idyqBridgeRoutes from './routes/idyq-bridge.js';
import hotProspectsRoutes from './routes/hot-prospects.js';
import adminUsersRoutes from './routes/admin-users.js';
import crmCompaniesRoutes from './routes/crm-companies.js';
import crmContactsRoutes from './routes/crm-contacts.js';
import crmHistoryRoutes from './routes/crm-history.js';
import crmTasksRoutes from './routes/crm-tasks.js';
import crmDealsRoutes from './routes/crm-deals.js';
import crmOrdersRoutes from './routes/crm-orders.js';
import facebookPixelsRoutes from './routes/facebook-pixels.js';
import facebookAdsRoutes from './routes/facebook-ads.js';
import serviceEmailRoutes from './routes/service-email-api.js';
import { metaConfigured, testConnection, META } from './services/meta-api.js';
import { startPoller } from './services/imap-poller.js';
import { startClassifier } from './services/classify-replies.js';
import { startDripTicker } from './services/drip-ticker.js';
import { startServiceEmailTicker } from './services/service-email-ticker.js';
import { selfTest as cryptoSelfTest } from './services/crypto-vault.js';
import { backfillLogos } from './services/logo-backfill.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3001;

// Process-level safety net.
//
// Background: ImapFlow (and other Node libraries that use EventEmitter under
// the hood) can emit 'error' events on instances. If a listener isn't wired
// up, Node treats it as unhandled and terminates the entire process —
// including the drip ticker and reply classifier that share this Node
// instance with the IMAP poller. We've already attached per-instance error
// listeners to ImapFlow clients in services/imap-poller.js. These two
// process-level handlers are belt-and-braces for any similar bug we haven't
// found yet: the process logs the error and stays alive instead of crashing.
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason && reason.stack ? reason.stack : reason);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/api/auth',        authRoutes);
app.use('/api/admin-users', adminUsersRoutes); // Studio staff accounts + per-section access (super-admin only)
app.use('/api/crm/companies', crmCompaniesRoutes); // Sales CRM — company records (requireAccess crm_companies)
app.use('/api/crm/contacts', crmContactsRoutes); // Sales CRM — company contacts (requireAccess crm_companies)
app.use('/api/crm/history', crmHistoryRoutes); // Sales CRM — activity timeline (requireAccess crm_companies)
app.use('/api/crm/tasks', crmTasksRoutes); // Sales CRM — tasks (requireAccess crm_tasks)
app.use('/api/crm/deals', crmDealsRoutes); // Sales CRM — deals/forecast (requireAccess crm_deals)
app.use('/api/crm/orders', crmOrdersRoutes); // Sales CRM — orders/approval/purchasing workflow
app.use('/api/clients',     clientRoutes);
app.use('/api/campaigns',   campaignRoutes);
app.use('/api/email/hot-prospects', hotProspectsRoutes); // CRM — admin-side Hot Prospects list (requireAuth). Mounted BEFORE /api/email so the more specific path matches first.
app.use('/api/email',       emailRoutes);
app.use('/api/facebook-pixels', facebookPixelsRoutes); // Facebook Pixels — admin-side pixel-customer management (requireAuth)
app.use('/api/facebook-ads', facebookAdsRoutes);       // Facebook Ads — Meta Marketing API foundation (requireAuth). Stage 1: connection-status only.
app.use('/api/algorithm',   algorithmRoutes);
app.use('/api/portal',      portalAuthRoutes);   // customer-portal auth (login/logout/check/reset)
app.use('/api/portal',      portalRoutes);       // customer-portal data (posts, inbox, campaigns)
app.use('/api/portal-admin', portalAdminRoutes); // admin-side portal management (requireAuth)
app.use('/api/service-emails', serviceEmailRoutes); // WorkTrackr service emails: HMAC-signed bridge + public unsubscribe (auth is per-route, not router-wide)
app.use('/api/idyq-bridge', idyqBridgeRoutes);   // App integration: mints bridge tickets for the IDYQ admin embed (requireAuth)

const distPath = join(__dirname, '../dist');
app.use(express.static(distPath));
app.get('*', (req, res) => res.sendFile(join(distPath, 'index.html')));

app.listen(PORT, () => {
  console.log(`Sweetbyte Studio running on port ${PORT}`);
  console.log(`[env] SUPERGROW_MCP_URL:     ${process.env.SUPERGROW_MCP_URL                             ? 'SET ✓' : 'MISSING ✗'}`);
  console.log(`[env] ANTHROPIC_API_KEY:     ${process.env.ANTHROPIC_API_KEY                             ? 'SET ✓' : 'MISSING ✗'}`);
  console.log(`[env] STUDIO_PASSWORD:       ${process.env.STUDIO_PASSWORD                               ? 'SET ✓' : 'MISSING ✗'}`);
  console.log(`[env] OPENAI_API_KEY:        ${(process.env.OPENAI_API_KEY||process.env.OPENAI_AI_KEY)   ? 'SET ✓' : 'MISSING ✗'}`);
  console.log(`[env] AWS_ACCESS_KEY_ID:     ${process.env.AWS_ACCESS_KEY_ID                             ? 'SET ✓' : 'MISSING ✗'}`);
  console.log(`[env] AWS_SECRET_ACCESS_KEY: ${process.env.AWS_SECRET_ACCESS_KEY                         ? 'SET ✓' : 'MISSING ✗'}`);
  console.log(`[env] AWS_SES_REGION:        ${process.env.AWS_SES_REGION || 'eu-north-1 (default)'}`);
  console.log(`[env] SES_CONFIGURATION_SET: ${process.env.SES_CONFIGURATION_SET || 'NOT SET (account default config set will apply)'}`);
  console.log(`[env] IDYQ_BRIDGE_SECRET:    ${process.env.IDYQ_BRIDGE_SECRET                            ? 'SET ✓' : 'MISSING ✗ (IDYQ admin embed will not work)'}`);
  console.log(`[env] IDYQ_BASE_URL:         ${process.env.IDYQ_BASE_URL || 'https://idoyourquotes.com (default)'}`);
  console.log(`[env] WORKTRACKR_SERVICE_EMAIL_SECRET: ${process.env.WORKTRACKR_SERVICE_EMAIL_SECRET ? 'SET ✓' : 'MISSING ✗ (WorkTrackr service emails will not work)'}`);
  console.log(`[env] SERVICE_EMAIL_FROM:    ${process.env.SERVICE_EMAIL_FROM || 'billy@sweetbyte.co.uk (default)'}`);
  console.log(`[env] SERVICE_EMAIL_CC:      ${process.env.SERVICE_EMAIL_CC || 'westley@sweetbyte.co.uk (default)'}`);
  console.log(`[env] PUBLIC_URL:            ${process.env.PUBLIC_URL || 'NOT SET — unsubscribe links will use the onrender.com host'}`);
  console.log(`[env] META_ACCESS_TOKEN:     ${process.env.META_ACCESS_TOKEN ? 'SET ✓' : 'MISSING ✗ (Facebook Ads disabled)'}`);
  console.log(`[env] META_APP_SECRET:       ${process.env.META_APP_SECRET   ? 'SET ✓' : 'MISSING ✗ (calls unsigned)'}`);
  console.log(`[env] META_APP_ID:           ${process.env.META_APP_ID       ? 'SET ✓' : 'MISSING ✗'}`);
  console.log(`[env] META_BUSINESS_ID:      ${process.env.META_BUSINESS_ID  ? 'SET ✓' : 'MISSING ✗'}`);
  console.log(`[env] META_API_VERSION:      ${process.env.META_API_VERSION || 'v25.0 (default)'}`);
  const ct = cryptoSelfTest();
  console.log(`[env] MAILBOX_ENCRYPTION_KEY: ${ct.ok ? 'SET ✓ (verified)' : `MISSING/INVALID — ${ct.reason}`}`);
  console.log(`[env] DB_PATH:               ${process.env.DB_PATH || '(default)'}`);

  // Start the IMAP poller — only if encryption is configured
  if (ct.ok) startPoller();
  else console.log('[poller] not started — set MAILBOX_ENCRYPTION_KEY to enable inbox monitoring');

  // Start the reply classifier — needs both encryption (so the poller can fetch
  // replies in the first place) and the Anthropic API key for the AI fallback pass.
  if (ct.ok && process.env.ANTHROPIC_API_KEY) startClassifier();
  else console.log('[classifier] not started — needs MAILBOX_ENCRYPTION_KEY and ANTHROPIC_API_KEY');

  // Start the drip ticker — sends scheduled campaigns batch by batch in their
  // chosen window. Doesn't depend on encryption or Anthropic; just SES + DB.
  startDripTicker();

  // Start the service-email ticker — sends WorkTrackr service emails once their
  // undo window closes, and their follow-ups 7 days later. Needs SES + DB only.
  startServiceEmailTicker();

  // Backfill any logos uploaded before the trim-at-upload pipeline shipped.
  // Fire-and-forget — runs in the background, logs progress, doesn't block
  // anything else. Idempotent (skips rows already marked processed) so it's
  // a no-op on subsequent boots once everything is migrated.
  backfillLogos().catch(err => {
    console.error('[logo-backfill] Top-level failure:', err && err.stack ? err.stack : err);
  });

  // Meta Marketing API connection check — non-fatal, fire-and-forget.
  // Proves Studio can reach Facebook with the saved credentials and that the
  // token can see the ad account we'll run ads in. This is the operator's
  // verification line: look for "[meta] connected ✓" in the Render log.
  // A failure logs a clear error and Studio carries on exactly as normal —
  // nothing else depends on this, and no ads are touched.
  if (metaConfigured()) {
    testConnection()
      .then(r => {
        if (r.ok) {
          console.log(`[meta] connected ✓ — ad account "${r.account.name}" (${r.account.id}, ${r.account.currency || '?'}, status ${r.account.account_status}) via Graph ${META.apiVersion}`);
        } else {
          console.error(`[meta] connection FAILED — ${r.error}`);
        }
      })
      .catch(err => {
        console.error('[meta] connection check threw:', err && err.message ? err.message : err);
      });
  } else {
    console.log('[meta] not checked — META_ACCESS_TOKEN is not set');
  }
});
