import React, { useEffect, useState, useCallback } from 'react';
import { SB } from '../brand.js';

const STAGES = [
  { key: 'generating_posts',  label: 'Writing posts',  icon: '✍️' },
  { key: 'generating_images', label: 'Images',         icon: '🖼️' },
  { key: 'awaiting_approval', label: 'Review',         icon: '👁️' },
  { key: 'deploying',         label: 'To Supergrow',   icon: '🚀' },
  { key: 'done',              label: 'Complete',       icon: '✅' },
];

const GREEN  = SB.primary;
const LIGHT  = SB.tint;
const BORDER = SB.light;
const DARK   = SB.dark;

export default function CampaignProgress({ campaignId, onComplete }) {
  const [campaign, setCampaign]     = useState(null);
  const [logs, setLogs]             = useState([]);
  const [files, setFiles]           = useState(null);
  const [posts, setPosts]           = useState([]);
  const [deploying, setDeploying]   = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [expandedPost, setExpanded] = useState(null);
  const [cardState, setCardState]   = useState({});
  // Add-more-posts control (admin only, while in review)
  const [addCount, setAddCount]       = useState(3);
  const [addingPosts, setAddingPosts] = useState(false);

  function parsePosts(c) {
    if (c?.posts_json) {
      try { setPosts(JSON.parse(c.posts_json)); } catch (_) {}
    }
  }

  const setCard = useCallback((index, patch) => {
    setCardState(prev => ({ ...prev, [index]: { ...(prev[index] || {}), ...patch } }));
  }, []);

  useEffect(() => {
    // EventSource cannot send custom headers — pass token as query param
    const token = localStorage.getItem('studioToken') || '';

    // Always pull the saved campaign state once on mount, BEFORE/independent
    // of the live feed. The live feed only reliably streams while a campaign
    // is active; for a campaign that already finished or FAILED while the
    // operator was away, the feed may open-then-close with no 'status' frame.
    // This unconditional fetch guarantees a revisited failed campaign loads
    // its stored error_log so the red "Campaign failed" banner shows the
    // actual reason, not a blank/stale screen.
    fetch(`/api/campaigns/${campaignId}`)
      .then(r => r.json())
      .then(d => {
        setCampaign(d);
        parsePosts(d);
        if (d?.files_json) { try { setFiles(JSON.parse(d.files_json)); } catch (_) {} }
        if (d?.status === 'failed' && d?.error_log) {
          setLogs(l => l.some(m => m.includes(d.error_log)) ? l : [...l, `ERROR: ${d.error_log}`]);
        }
      })
      .catch(() => {});

    const es = new EventSource(`/api/campaigns/progress/${campaignId}?token=${encodeURIComponent(token)}`);
    es.onerror = () => {
      setLogs(l => l.some(m => m.includes('Live updates')) ? l : [...l, 'ERROR: Live updates disconnected — page will keep polling for changes…']);
      fetch(`/api/campaigns/${campaignId}`).then(r => r.json()).then(d => { setCampaign(d); parsePosts(d); });
    };
    es.onmessage = e => {
      const data = JSON.parse(e.data);
      if (data.type === 'status') {
        setCampaign(data.campaign);
        parsePosts(data.campaign);
        if (data.campaign?.files_json) {
          try { setFiles(JSON.parse(data.campaign.files_json)); } catch (_) {}
        }
      }
      if (data.type === 'progress') {
        setCampaign(prev => prev ? { ...prev, ...data } : data);
      }
      if (data.type === 'log') {
        setLogs(l => [...l.slice(-199), data.message]);
      }
      if (data.type === 'awaiting_approval') {
        setLogs(l => [...l, `✓ ${data.message}`]);
        fetch(`/api/campaigns/${campaignId}`)
          .then(r => r.json())
          .then(d => { setCampaign(d); parsePosts(d); });
      }
      if (data.type === 'post_updated') {
        setLogs(l => [...l, data.message]);
        setPosts(prev => {
          const next = [...prev];
          next[data.postIndex] = data.post;
          return next;
        });
        setCard(data.postIndex, { regenImage: false, regenPost: false });
      }
      if (data.type === 'post_update_error') {
        setLogs(l => [...l, `ERROR: ${data.message}`]);
        setCard(data.postIndex, { regenImage: false, regenPost: false });
      }
      if (data.type === 'complete') {
        setFiles(data.files);
        setCampaign(prev => prev ? { ...prev, status: 'completed', stage: 'done', progress: 100, posts_deployed: data.deployed } : prev);
        fetch(`/api/campaigns/${campaignId}`)
          .then(r => r.json())
          .then(d => parsePosts(d));
        es.close();
        if (onComplete) onComplete();
      }
      if (data.type === 'error') {
        setCampaign(prev => prev ? { ...prev, status: 'failed', stage: 'error' } : prev);
        setLogs(l => [...l, `ERROR: ${data.message}`]);
        es.close();
      }
    };

    fetch(`/api/campaigns/${campaignId}`)
      .then(r => r.json())
      .then(d => {
        setCampaign(d);
        parsePosts(d);
        if (d.files_json) { try { setFiles(JSON.parse(d.files_json)); } catch (_) {} }
      });

    // Polling fallback — syncs campaign state every 8s even if SSE drops
    const pollInterval = setInterval(() => {
      fetch(`/api/campaigns/${campaignId}`)
        .then(r => r.json())
        .then(d => {
          setCampaign(prev => {
            if (!prev || prev.stage !== d.stage || prev.progress !== d.progress ||
                prev.posts_generated !== d.posts_generated || prev.images_generated !== d.images_generated ||
                prev.add_status !== d.add_status || prev.add_done !== d.add_done) {
              parsePosts(d);
              if (d.files_json) { try { setFiles(JSON.parse(d.files_json)); } catch (_) {} }
              return d;
            }
            return prev;
          });
        })
        .catch(() => {});
    }, 8000);

    return () => { es.close(); clearInterval(pollInterval); };
  }, [campaignId]);

  // Auto-scroll on new log lines was removed — it dragged the whole page
  // to the bottom on every regen action because scrollIntoView walks up the
  // DOM and scrolls every scrollable parent. The log terminal is now manually
  // scrollable; new lines still appear, the page just doesn't move.

  async function handleDeploy() {
    if (!window.confirm('Push all posts straight to Supergrow scheduled? They will auto-publish on Supergrow\u2019s calendar slots, skipping customer approval.')) return;
    setDeploying(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/deploy`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        setLogs(l => [...l, `Deploy error: ${err.error}`]);
        setDeploying(false);
      }
    } catch (err) {
      setLogs(l => [...l, `Deploy failed: ${err.message}`]);
      setDeploying(false);
    }
  }

  async function handleSendToCustomer() {
    setDeploying(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/send-to-customer`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setLogs(l => [...l, `Send error: ${data.error}`]);
        setDeploying(false);
        return;
      }
      // Reflect the new state locally so the banner switches to "waiting on
      // customer" without needing a full refresh.
      setCampaign(c => c ? { ...c, sent_to_customer_at: new Date().toISOString() } : c);
      setDeploying(false);
    } catch (err) {
      setLogs(l => [...l, `Send failed: ${err.message}`]);
      setDeploying(false);
    }
  }

  async function handleCancel() {
    if (!window.confirm('Cancel this campaign? Posts generated so far will be lost.')) return;
    setCancelling(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/cancel`, { method: 'POST' });
    } catch (err) {
      setLogs(l => [...l, `Cancel failed: ${err.message}`]);
    }
    setCancelling(false);
  }

  async function handleAddPosts() {
    const n = addCount;
    // Show the bar immediately; the background job + live feed/polling take over.
    setCampaign(prev => prev ? { ...prev, add_status: 'running', add_done: 0, add_total: n } : prev);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/add-posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: n })
      });
      const data = await res.json();
      if (!res.ok) {
        setCampaign(prev => prev ? { ...prev, add_status: null } : prev);
        alert(data.error || 'Failed to add posts');
      }
      // On success we do nothing else — new posts drop into the grid and the
      // bar fills as the background job reports progress.
    } catch (err) {
      setCampaign(prev => prev ? { ...prev, add_status: null } : prev);
      alert('Failed to add posts');
    }
  }

  async function handleRegenImage(postIndex) {
    setCard(postIndex, { regenImage: true });
    // No log entry here — avoids triggering scrollIntoView on the log terminal
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/regenerate-image/${postIndex}`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        setLogs(l => [...l, `Image regen error: ${err.error}`]);
        setCard(postIndex, { regenImage: false });
      }
    } catch (err) {
      setLogs(l => [...l, `Image regen failed: ${err.message}`]);
      setCard(postIndex, { regenImage: false });
    }
  }

  async function handleRegenPost(postIndex) {
    setCard(postIndex, { regenPost: true });
    setLogs(l => [...l, `Regenerating post ${postIndex + 1} text with GPT-4o…`]);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/regenerate-post/${postIndex}`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        setLogs(l => [...l, `Post regen error: ${err.error}`]);
        setCard(postIndex, { regenPost: false });
      }
    } catch (err) {
      setLogs(l => [...l, `Post regen failed: ${err.message}`]);
      setCard(postIndex, { regenPost: false });
    }
  }

  // Per-post logo Position/Size/Background change. Synchronous endpoint (no
  // SSE) — the updated post comes straight back in the JSON response, so we
  // splice it into `posts` directly. No AI cost; ~½ sec. Mirrors the
  // customer-portal recomposite behaviour (decision #65 / parity #73).
  async function handleRecompositeLogo(postIndex, patch) {
    setCard(postIndex, { recompLogo: true });
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/recomposite-logo/${postIndex}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'pre_logo_unavailable') {
          setLogs(l => [...l, `Logo controls need a fresh image — click New image on post ${postIndex + 1} first.`]);
        } else {
          setLogs(l => [...l, `Logo update error: ${data.error}`]);
        }
        setCard(postIndex, { recompLogo: false });
        return;
      }
      setPosts(prev => {
        const next = [...prev];
        next[postIndex] = data.post;
        return next;
      });
      setCard(postIndex, { recompLogo: false });
    } catch (err) {
      setLogs(l => [...l, `Logo update failed: ${err.message}`]);
      setCard(postIndex, { recompLogo: false });
    }
  }

  function startEdit(postIndex, currentText) {
    setCard(postIndex, { editing: true, editText: currentText });
  }

  async function saveEdit(postIndex) {
    const text = cardState[postIndex]?.editText ?? '';
    if (!text.trim()) return;
    setCard(postIndex, { editing: false });
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/edit-post/${postIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedin_post_text: text })
      });
      if (res.ok) {
        const { post } = await res.json();
        setPosts(prev => { const next = [...prev]; next[postIndex] = post; return next; });
        setLogs(l => [...l, `✓ Post ${postIndex + 1} text saved.`]);
      } else {
        const err = await res.json();
        setLogs(l => [...l, `Edit save error: ${err.error}`]);
      }
    } catch (err) {
      setLogs(l => [...l, `Edit save failed: ${err.message}`]);
    }
  }

  function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  const progress      = campaign?.progress || 0;
  const currentStage  = campaign?.stage;
  const stageIdx      = STAGES.findIndex(s => s.key === currentStage);
  const isAwaiting    = currentStage === 'awaiting_approval';
  const adding        = campaign?.add_status === 'running';
  const isDone        = campaign?.status === 'completed';
  const isFailed      = campaign?.status === 'failed';
  const isRunning     = !isDone && !isFailed && !isAwaiting;
  // Distinguishes campaigns that finished via the customer portal (customer
  // clicked Approve all → posts auto-pushed to Supergrow's live queue) from
  // campaigns that finished via the admin's Send-to-Supergrow button (admin
  // pushed drafts → customer approves later in Supergrow's Kanban). Drives
  // banner copy and locks the per-card Edit/Rewrite/New image buttons so a
  // stale tab can't blow away posts that are already live.
  const isPortalDeployed = isDone && campaign?.deployed_by === 'portal';
  // Button 1 ("Send to customer for approval") was clicked: switch the banner
  // to the "waiting on customer" state. Only meaningful while awaiting_approval.
  const sentToCustomer = isAwaiting && !!campaign?.sent_to_customer_at;

  return (
    <div style={{ padding: '24px 32px', width: '100%', boxSizing: 'border-box' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1a1a1a', margin: 0 }}>
          {isAwaiting          ? '👁️ Review posts before sending to Supergrow' :
           isPortalDeployed    ? '✅ Customer approved & sent to Supergrow' :
           isDone              ? '✅ Campaign complete' :
           isFailed            ? '❌ Campaign failed' :
                                 '⟳ Campaign in progress'}
        </h2>
        {isRunning && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 6 }}>
            <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
              Do not close this page — this takes 20–35 minutes.
            </p>
            <button
              onClick={handleCancel}
              disabled={cancelling}
              style={{
                fontSize: 12, padding: '5px 12px', border: '0.5px solid #F7C1C1',
                borderRadius: 7, background: '#fff', color: '#E24B4A',
                cursor: cancelling ? 'not-allowed' : 'pointer', flexShrink: 0
              }}
            >
              {cancelling ? 'Cancelling…' : '✕ Cancel campaign'}
            </button>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ background: '#fff', border: '0.5px solid #e0e0dc', borderRadius: 10, padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>Overall progress</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: GREEN }}>{progress}%</span>
        </div>
        <div style={{ height: 8, background: '#f0f0ec', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: GREEN, borderRadius: 4, transition: 'width 0.6s ease' }} />
        </div>
      </div>

      {/* Stage pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {STAGES.map((stage, i) => {
          const done   = stageIdx > i || currentStage === 'done';
          const active = currentStage === stage.key;
          return (
            <div key={stage.key} style={{
              flex: '1 1 0', minWidth: 100,
              background: done ? LIGHT : active ? '#FFFBF0' : '#fafafa',
              border: `1px solid ${done ? BORDER : active ? '#FAC775' : '#e8e8e4'}`,
              borderRadius: 8, padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 8
            }}>
              <span style={{ fontSize: 18 }}>{done ? '✓' : active ? '⟳' : stage.icon}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: done ? DARK : active ? '#7a4a00' : '#aaa' }}>
                  {stage.label}
                </div>
                {active && campaign && (
                  <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
                    {stage.key === 'generating_images' && `${campaign.images_generated || 0}/${campaign.total_posts || 12} images`}
                    {stage.key === 'deploying' && `${campaign.posts_deployed || 0}/${campaign.total_posts || 12} sent`}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Post grid — awaiting approval or done */}
      {(isAwaiting || isDone) && posts.length > 0 && (
        <div style={{ marginBottom: 24 }}>

          {/* Add more posts — admin only, while in review.
              While a batch is generating it swaps to a live progress bar. */}
          {isAwaiting && (adding ? (
            <div style={{ background: '#fff', border: '0.5px solid #e0e0dc', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: DARK }}>
                  Creating {campaign.add_total || addCount} more post{(campaign.add_total || addCount) === 1 ? '' : 's'}…
                </span>
                <span style={{ fontSize: 13, color: '#888' }}>
                  {campaign.add_done || 0} of {campaign.add_total || addCount} done
                </span>
              </div>
              <div style={{ height: 8, background: LIGHT, borderRadius: 6, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.round(((campaign.add_done || 0) / Math.max(1, campaign.add_total || addCount)) * 100)}%`,
                  height: '100%', background: GREEN, borderRadius: 6, transition: 'width 0.4s'
                }} />
              </div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 8 }}>
                Keep this tab open — new posts drop in below as they finish. Your existing posts stay put.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: '#fff', border: '0.5px solid #e0e0dc', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#888' }}>
                <strong style={{ color: '#1a1a1a', fontWeight: 600 }}>Add more posts</strong> — fresh topics, no duplicates. Images and engine match this set. Adds this many on top of what's here.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  value={addCount}
                  onChange={e => setAddCount(Number(e.target.value))}
                  style={{ fontSize: 13, padding: '7px 10px', border: '0.5px solid #d0d0cc', borderRadius: 7, background: '#fff', color: '#1a1a1a' }}
                >
                  <option value={3}>3 posts</option>
                  <option value={6}>6 posts</option>
                  <option value={12}>12 posts</option>
                  <option value={18}>18 posts</option>
                  <option value={24}>24 posts</option>
                </select>
                <button
                  onClick={handleAddPosts}
                  style={{ fontSize: 13, padding: '7px 16px', border: '0.5px solid #d0d0cc', borderRadius: 7, background: '#fff', color: '#1a1a1a', cursor: 'pointer', fontWeight: 500 }}
                >
                  + Add
                </button>
              </div>
            </div>
          ))}

          {/* Deploy banner — two-button flow (decision #72).
              State A: not yet sent → two buttons.
              State B: sent to customer → "waiting on customer" + Button 2 still available. */}
          {isAwaiting && !sentToCustomer && (
            <div style={{
              background: '#FFFBF0', border: '1px solid #FAC775', borderRadius: 10,
              padding: '16px 20px', marginBottom: 20
            }}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{posts.length} posts ready</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>
                  Review, edit or regenerate any post below. Then choose how this campaign goes out.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button
                  onClick={handleSendToCustomer}
                  disabled={deploying || adding}
                  style={{
                    flex: 1, minWidth: 220,
                    background: '#fff', color: '#185FA5', border: '1px solid #85B7EB',
                    padding: '11px 20px', borderRadius: 8, fontWeight: 600, fontSize: 13,
                    cursor: (deploying || adding) ? 'not-allowed' : 'pointer', opacity: adding ? 0.5 : 1
                  }}
                >
                  {deploying ? 'Working…' : 'Send to customer for approval'}
                </button>
                <button
                  onClick={handleDeploy}
                  disabled={deploying || adding}
                  style={{
                    flex: 1, minWidth: 220,
                    background: (deploying || adding) ? SB.light : GREEN, color: '#fff', border: 'none',
                    padding: '11px 20px', borderRadius: 8, fontWeight: 600, fontSize: 13,
                    cursor: (deploying || adding) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {deploying ? 'Working…' : 'Push to Supergrow scheduled'}
                </button>
              </div>
              {adding && (
                <div style={{ fontSize: 11, color: '#b8860b', marginTop: 10 }}>
                  Finishing the new posts first — you can send or push once they're all done.
                </div>
              )}
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 11, lineHeight: 1.5 }}>
                Left: the customer reviews in their portal, approves there, then it schedules.
                &nbsp;·&nbsp; Right: skips the customer, schedules now. Supergrow picks the exact posting times from its calendar slots.
              </div>
            </div>
          )}

          {isAwaiting && sentToCustomer && (
            <div style={{
              background: '#F4F9FE', border: '1px solid #85B7EB', borderRadius: 10,
              padding: '16px 20px', marginBottom: 20
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>Waiting on customer</div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 3, lineHeight: 1.5 }}>
                The customer can see all {posts.length} posts in their portal. When they approve,
                the campaign schedules into Supergrow automatically.
              </div>
              <button
                onClick={handleDeploy}
                disabled={deploying}
                style={{
                  marginTop: 13,
                  background: deploying ? SB.light : GREEN, color: '#fff', border: 'none',
                  padding: '10px 18px', borderRadius: 8, fontWeight: 600, fontSize: 13,
                  cursor: deploying ? 'not-allowed' : 'pointer'
                }}
              >
                {deploying ? 'Working…' : 'Push to Supergrow scheduled instead'}
              </button>
              <span style={{ fontSize: 11, color: '#aaa', marginLeft: 10 }}>
                Still available if you decide not to wait for the customer.
              </span>
            </div>
          )}

          {/* Done banner — admin-deployed variant.
              Customer-portal-deployed campaigns show a different banner just
              below this one (no Re-send button — those posts are already in
              Supergrow's live queue, not drafts). */}
          {isDone && !isPortalDeployed && (
            <div style={{
              background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 10,
              padding: '12px 16px', marginBottom: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: DARK }}>
                ✓ {campaign.posts_deployed} drafts sent to Supergrow — waiting for client approval in Kanban
              </span>
              <button
                onClick={handleDeploy}
                disabled={deploying}
                style={{
                  fontSize: 12, fontWeight: 500, padding: '6px 14px',
                  background: deploying ? SB.light : '#fff',
                  color: DARK, border: `1px solid ${BORDER}`,
                  borderRadius: 7, cursor: deploying ? 'not-allowed' : 'pointer', flexShrink: 0
                }}
              >
                {deploying ? 'Re-sending...' : 'Re-send all to Supergrow'}
              </button>
            </div>
          )}

          {/* Done banner — customer-portal-deployed variant.
              These posts are already live in Supergrow's scheduled queue
              (queue_post, not draft) so a Re-send button would be wrong —
              it'd duplicate live posts. The whole post grid below renders
              read-only: Edit/Rewrite/New image buttons are gated out. */}
          {isPortalDeployed && (
            <div style={{
              background: '#E0EAFA', border: '1px solid #B8CDF0', borderRadius: 10,
              padding: '12px 16px', marginBottom: 20,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1A3A7A' }}>
                ✓ Customer approved{campaign.completed_at ? ` on ${new Date(campaign.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
              </div>
              <div style={{ fontSize: 12, color: '#3A5A9A', marginTop: 4 }}>
                All {campaign.posts_deployed || posts.length} posts pushed to Supergrow's scheduled queue. Editing and regeneration are locked because the posts are already live.
              </div>
            </div>
          )}

          {/* Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
            {posts.map((post, i) => {
              const isExpanded  = expandedPost === (post.id || i);
              const cs          = cardState[i] || {};
              const isEditing   = !!cs.editing;
              const isRegenImg  = !!cs.regenImage;
              const isRegenPost = !!cs.regenPost;
              const isRecompLogo = !!cs.recompLogo;
              const isBusy      = isRegenImg || isRegenPost || isRecompLogo;
              const logoEnabled = !!post.pre_logo_image_url;
              const logoPos     = post.logo_position || post.default_logo_position || 'bottom-right';
              const logoSize    = post.logo_size     || post.default_logo_size     || 'small';
              const logoPanel   = post.logo_panel    || post.default_logo_panel    || 'white';

              return (
                <div key={post.id || i} style={{
                  background: '#fff', border: '0.5px solid #e0e0dc', borderRadius: 12,
                  overflow: 'hidden', display: 'flex', flexDirection: 'column',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                  opacity: isBusy ? 0.7 : 1, transition: 'opacity 0.3s'
                }}>

                  {/* Image */}
                  <div style={{ position: 'relative' }}>
                    {post.image_url
                      ? <img src={post.image_url} alt={`Post ${i + 1}`} style={{ width: '100%', height: 'auto', maxHeight: 300, objectFit: 'contain', background: '#f5f5f3', display: 'block' }} onError={e => { e.target.style.display = 'none'; }} />
                      : <div style={{ height: 80, background: '#f5f5f3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: 11, color: '#bbb' }}>No image generated</span></div>
                    }
                    {(isRegenImg || isRecompLogo || (adding && !post.image_url)) && (
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.80)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6, textAlign: 'center', padding: 12 }}>
                        <div style={{ width: 24, height: 24, border: `2px solid ${GREEN}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        <span style={{ fontSize: 11, color: DARK, fontWeight: 500 }}>{isRecompLogo ? 'Updating logo…' : 'Generating…'}</span>
                        {isRecompLogo && <span style={{ fontSize: 10, color: '#888' }}>Repositioning logo — no charge.</span>}
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>Post {i + 1}</div>
                        <div style={{ fontSize: 10, color: '#999', marginTop: 1 }}>{[post.content_pillar, post.format].filter(Boolean).join(' · ')}</div>
                        {(post.suggested_day || post.suggested_time) && (
                          <div style={{ fontSize: 10, color: GREEN, marginTop: 2 }}>📅 {post.suggested_day} {post.suggested_time}</div>
                        )}
                      </div>
                      {isDone && post.supergrow_app_url && (
                        <a href={post.supergrow_app_url} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 11, color: GREEN, textDecoration: 'none', fontWeight: 600, background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '3px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          View in Supergrow →
                        </a>
                      )}
                    </div>

                    <div style={{ fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 6 }}>{post.topic}</div>

                    {isEditing ? (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <textarea
                          value={cs.editText || ''}
                          onChange={e => setCard(i, { editText: e.target.value })}
                          style={{ flex: 1, minHeight: 200, fontSize: 11, lineHeight: 1.6, padding: 8, border: `1px solid ${GREEN}`, borderRadius: 6, resize: 'vertical', fontFamily: 'inherit', color: '#333', outline: 'none' }}
                          autoFocus
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => saveEdit(i)} style={{ flex: 1, fontSize: 11, fontWeight: 600, padding: '6px 0', background: GREEN, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>✓ Save</button>
                          <button onClick={() => setCard(i, { editing: false })} style={{ fontSize: 11, padding: '6px 10px', background: '#f5f5f3', color: '#555', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{
                          fontSize: 11, color: '#555', lineHeight: 1.6, flex: 1,
                          maxHeight: isExpanded ? 'none' : 96, overflow: 'hidden',
                          maskImage: isExpanded ? 'none' : 'linear-gradient(to bottom, black 50%, transparent 100%)',
                          WebkitMaskImage: isExpanded ? 'none' : 'linear-gradient(to bottom, black 50%, transparent 100%)',
                          whiteSpace: 'pre-wrap'
                        }}>
                          {post.linkedin_post_text}
                        </div>
                        <button onClick={() => setExpanded(isExpanded ? null : (post.id || i))}
                          style={{ marginTop: 8, fontSize: 11, color: GREEN, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', fontWeight: 500 }}>
                          {isExpanded ? '▲ Collapse' : '▼ Read full post'}
                        </button>
                      </>
                    )}

                    {/* Action buttons — only visible during the review stage.
                        Once the campaign is deployed (admin or customer-portal),
                        the posts are either live in Supergrow's queue or sitting
                        as drafts the customer is reviewing — admin shouldn't be
                        able to overwrite them from this screen. The view here
                        becomes read-only. */}
                    {isAwaiting && !isEditing && (
                      <>
                        {/* Per-post logo controls — admin parity with the
                            customer card (decision #73). Greys out with a
                            hint when the post has no stored pre-logo image,
                            exactly like the customer side. */}
                        <div style={{
                          marginTop: 10, paddingTop: 10,
                          borderTop: '0.5px dashed #e8b04a',
                          opacity: (isBusy || !logoEnabled) ? 0.6 : 1,
                        }}>
                          <div style={{ fontSize: 10, color: '#9a6f00', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500, marginBottom: 6 }}>
                            Logo on this image
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                            <div>
                              <div style={{ fontSize: 10, color: '#999', marginBottom: 3 }}>Position</div>
                              <select value={logoPos} disabled={isBusy || !logoEnabled}
                                onChange={e => handleRecompositeLogo(i, { logo_position: e.target.value })}
                                style={{ width: '100%', fontSize: 11, padding: '5px 4px', border: '1px solid #ddd', borderRadius: 5, background: '#fff', color: '#333', cursor: (isBusy || !logoEnabled) ? 'not-allowed' : 'pointer' }}>
                                <option value="top-right">Top right</option>
                                <option value="top-left">Top left</option>
                                <option value="bottom-right">Bottom right</option>
                                <option value="bottom-left">Bottom left</option>
                              </select>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: '#999', marginBottom: 3 }}>Size</div>
                              <select value={logoSize} disabled={isBusy || !logoEnabled}
                                onChange={e => handleRecompositeLogo(i, { logo_size: e.target.value })}
                                style={{ width: '100%', fontSize: 11, padding: '5px 4px', border: '1px solid #ddd', borderRadius: 5, background: '#fff', color: '#333', cursor: (isBusy || !logoEnabled) ? 'not-allowed' : 'pointer' }}>
                                <option value="large">Large</option>
                                <option value="medium">Medium</option>
                                <option value="small">Small</option>
                              </select>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: '#999', marginBottom: 3 }}>Background</div>
                              <select value={logoPanel} disabled={isBusy || !logoEnabled}
                                onChange={e => handleRecompositeLogo(i, { logo_panel: e.target.value })}
                                style={{ width: '100%', fontSize: 11, padding: '5px 4px', border: '1px solid #ddd', borderRadius: 5, background: '#fff', color: '#333', cursor: (isBusy || !logoEnabled) ? 'not-allowed' : 'pointer' }}>
                                <option value="white">White panel</option>
                                <option value="none">No panel</option>
                              </select>
                            </div>
                          </div>
                          {!logoEnabled && (
                            <div style={{ fontSize: 10, color: '#999', marginTop: 6, lineHeight: 1.4, fontStyle: 'italic' }}>
                              Click <span style={{ fontWeight: 500, fontStyle: 'normal' }}>New image</span> to enable these controls on this post.
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: 6, marginTop: 10, borderTop: '1px solid #f0f0ec', paddingTop: 10 }}>
                          <button onClick={() => startEdit(i, post.linkedin_post_text)} disabled={isBusy}
                            style={{ flex: 1, fontSize: 11, padding: '5px 0', background: '#f5f5f3', border: '1px solid #ddd', borderRadius: 6, cursor: isBusy ? 'not-allowed' : 'pointer', color: '#333' }}>
                            ✏️ Edit text
                          </button>
                          <button onClick={() => handleRegenPost(i)} disabled={isBusy}
                            style={{ flex: 1, fontSize: 11, padding: '5px 0', background: '#f5f5f3', border: '1px solid #ddd', borderRadius: 6, cursor: isBusy ? 'not-allowed' : 'pointer', color: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            {isRegenPost
                              ? <><span style={{ width: 12, height: 12, border: `1.5px solid ${GREEN}`, borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} /> Writing…</>
                              : '🔄 Rewrite post'}
                          </button>
                          <button onClick={() => handleRegenImage(i)} disabled={isBusy}
                            style={{ flex: 1, fontSize: 11, padding: '5px 0', background: '#f5f5f3', border: '1px solid #ddd', borderRadius: 6, cursor: isBusy ? 'not-allowed' : 'pointer', color: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            {isRegenImg
                              ? <><span style={{ width: 12, height: 12, border: `1.5px solid ${GREEN}`, borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} /> Imaging…</>
                              : '🖼️ New image'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Download files */}
      {isDone && files && (
        <div style={{ background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: DARK, marginBottom: 10 }}>Download output files</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.keys(files).map(name => (
              <button key={name} onClick={() => downloadFile(name, files[name])}
                style={{ fontSize: 11, padding: '5px 12px', border: `1px solid ${DARK}`, borderRadius: 6, background: '#fff', color: DARK, cursor: 'pointer' }}>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {isFailed && (
        <div style={{ background: '#FCEBEB', border: '1px solid #F7C1C1', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#501313' }}>Campaign failed</div>
          <div style={{ fontSize: 12, color: '#791F1F', marginTop: 4 }}>{campaign.error_log}</div>
        </div>
      )}

      {/* Log terminal */}
      <div style={{ background: '#111', borderRadius: 10, padding: '14px 16px', fontFamily: '"Menlo","Monaco","Consolas",monospace', fontSize: 11.5, color: SB.light, maxHeight: 240, overflow: 'auto', border: '1px solid #2a2a2a' }}>
        <div style={{ color: '#444', marginBottom: 6, fontSize: 10, letterSpacing: '0.05em' }}>CAMPAIGN LOG</div>
        {logs.length === 0
          ? <div style={{ color: '#444' }}>Waiting for first update…</div>
          : logs.map((l, i) => (
            <div key={i} style={{ marginBottom: 3, lineHeight: 1.5, color: l.startsWith('ERROR') ? '#F09595' : l.startsWith('✓') ? SB.light : '#7a7a7a' }}>
              <span style={{ color: '#333', userSelect: 'none' }}>{String(i + 1).padStart(2, '0')} </span>{l}
            </div>
          ))
        }
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
