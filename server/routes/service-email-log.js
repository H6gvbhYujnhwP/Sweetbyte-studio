/**
 * server/routes/service-email-log.js — read-only admin view of service emails.
 *
 * Separate from routes/service-email-api.js on purpose. That file is the
 * WorkTrackr bridge: HMAC-signed, server-to-server, no admin session. This one
 * sits behind the normal Studio login like every other admin screen. Mixing
 * the two auth models in one router is how a bridge endpoint accidentally ends
 * up reachable from a browser session, or vice versa.
 *
 * Read-only by design. Nothing here resends, cancels or edits — the log tells
 * you what happened, and anything that changes state stays with the bridge.
 */

import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth);

/**
 * GET /api/service-email-log/recent?limit=200&q=&status=
 *
 * Returns recent sends plus headline counts. The counts are computed over ALL
 * rows, not the filtered page — "3 failed today" must stay true regardless of
 * what the operator has typed into the search box.
 */
router.get('/recent', (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const q = String(req.query.q || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();

    const where = [];
    const params = [];

    if (status && ['queued', 'sent', 'failed', 'cancelled'].includes(status)) {
      where.push('status = ?');
      params.push(status);
    }
    if (q) {
      where.push('(lower(to_email) LIKE ? OR lower(company_name) LIKE ? OR lower(contact_name) LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const sql = `
      SELECT id, external_company_id, company_name, contact_name, to_email,
             step, status, error, send_after, sent_at, created_at
        FROM service_email_sends
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC
       LIMIT ?
    `;
    const rows = db.prepare(sql).all(...params, limit);

    // Headline counts. 24h window uses SQLite's own clock so it matches the
    // created_at values exactly rather than depending on the Node process
    // timezone agreeing with the database.
    const counts = db.prepare(`
      SELECT
        COUNT(*)                                                        AS total,
        SUM(CASE WHEN status = 'sent'      THEN 1 ELSE 0 END)            AS sent,
        SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END)            AS failed,
        SUM(CASE WHEN status = 'queued'    THEN 1 ELSE 0 END)            AS queued,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END)            AS cancelled,
        SUM(CASE WHEN status = 'sent'   AND created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS sent24,
        SUM(CASE WHEN status = 'failed' AND created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS failed24
      FROM service_email_sends
    `).get();

    res.json({
      rows: rows.map(r => ({
        id: r.id,
        companyId: r.external_company_id,
        companyName: r.company_name,
        contactName: r.contact_name,
        toEmail: r.to_email,
        step: r.step,
        status: r.status,
        error: r.error || null,
        sendAfter: r.send_after,
        sentAt: r.sent_at,
        createdAt: r.created_at,
      })),
      counts: {
        total: counts?.total || 0,
        sent: counts?.sent || 0,
        failed: counts?.failed || 0,
        queued: counts?.queued || 0,
        cancelled: counts?.cancelled || 0,
        sent24: counts?.sent24 || 0,
        failed24: counts?.failed24 || 0,
      },
    });
  } catch (err) {
    console.error('[service-email-log] recent failed:', err.message);
    res.status(500).json({ error: 'Could not load the service email log' });
  }
});

export default router;
