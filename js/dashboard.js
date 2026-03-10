// ==================== THE FUTURISTIC DASHBOARD ENGINE (v4.0 - FIRE & FORGET) ====================
const SUPABASE_URL = "https://mtqnkdblgieliqkthasc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10cW5rZGJsZ2llbGlxa3RoYXNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3MDAyNjIsImV4cCI6MjA4NTI3NjI2Mn0.-trmIlrF9SUnrEJD9Y-K3doiPcT0YOwiwtLwQtixh0I";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Stage map: DB status → what the loader shows ─────────────────────────────
// Edge function writes these status values to the DB as work progresses.
// Loader reads them every 2.5s and updates UI accordingly.
const STAGE_MAP = {
    scraping:     { label: "SCRAPING PROFILE & CONTENT DATA...",  pct: 25 },
    transcribing: { label: "PROCESSING AUDIO TRANSCRIPTS...",     pct: 45 },
    analyzing:    { label: "RUNNING AI NEURAL ANALYSIS...",       pct: 75 },
    completed:    { label: "EXTRACTION COMPLETE ✓",               pct: 100 },
    failed:       { label: "NEURAL LINK FAILED",                  pct: 0  },
};

const POLL_INTERVAL_MS = 2500;       // check DB every 2.5s
const POLL_TIMEOUT_MS  = 8 * 60 * 1000; // give up after 8 minutes

// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.replace("login.html"); return; }

    document.body.classList.add('auth-ready');
    await initializeDashboard(session.user);

    document.getElementById('logoutBtn').onclick = async () => {
        await supabaseClient.auth.signOut();
        window.location.href = "login.html";
    };
});

// ==================== DASHBOARD INIT ====================

async function initializeDashboard(user) {
    await syncUserProfile(user);

    // Check subscription — try join first, fallback to simple active check
    let hasInstagramAccess = false;
    try {
        const { data: subscriptions } = await supabaseClient
            .from('user_subscriptions')
            .select('plan_id, status, subscription_plans(plan_slug)')
            .eq('user_id', user.id)
            .eq('status', 'active');

        if (subscriptions && subscriptions.length > 0) {
            // Check if any active sub has instagram slug
            const slugs = subscriptions
                .map(s => s.subscription_plans?.plan_slug)
                .filter(Boolean);
            hasInstagramAccess = slugs.includes('instagram');

            // Fallback: if join returned no slugs but user has active sub,
            // check plan directly by known instagram plan UUIDs
            if (!hasInstagramAccess && subscriptions.length > 0) {
                // User has SOME active subscription — check plan_id against subscription_plans
                const planIds = subscriptions.map(s => s.plan_id).filter(Boolean);
                if (planIds.length > 0) {
                    const { data: plans } = await supabaseClient
                        .from('subscription_plans')
                        .select('id, plan_slug')
                        .in('id', planIds);
                    hasInstagramAccess = plans?.some(p => p.plan_slug === 'instagram') || false;
                }
            }
        }
    } catch (err) {
        console.warn('Subscription check error:', err);
        hasInstagramAccess = false;
    }

    console.log('Instagram access:', hasInstagramAccess);

    // Only Instagram card exists — lock it if no subscription
    document.querySelectorAll('.platform-select-card').forEach(card => {
        if (!hasInstagramAccess) applyLockOverlay(card);
    });

    document.querySelectorAll('.btn-select-platform').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            const card = btn.closest('.platform-select-card');
            if (card.classList.contains('node-locked')) {
                showNotification("🔒 NODE OFFLINE: Subscription Required", "error");
            } else {
                showInputModal(card.dataset.platform);
            }
        };
    });
}

// ==================== MODAL ====================

function showInputModal(platform) {
    const modal = document.createElement('div');
    modal.className = 'custom-modal-overlay';
    modal.style.cssText = `position:fixed; inset:0; background:rgba(0,0,0,0.95); backdrop-filter:blur(15px); display:flex; align-items:center; justify-content:center; z-index:10000;`;

    modal.innerHTML = `
        <div style="background:#0a0a0f; border:1px solid #6366f1; padding:3rem; border-radius:24px; width:90%; max-width:450px; text-align:center; box-shadow:0 0 50px rgba(99,102,241,0.2);">
            <h2 style="letter-spacing:4px; color:white; margin-bottom:1rem;">${platform.toUpperCase()} UPLINK</h2>
            <p style="color:#64748b; font-size:0.9rem; margin-bottom:2rem;">Enter target @handle to initiate neural scan.</p>
            <form id="modalAnalysisForm">
                <input type="text" id="modalUsername" placeholder="@username" required
                    style="width:100%; padding:1.2rem; background:#000; border:1px solid #1e293b; border-radius:12px; color:#818cf8; margin-bottom:2rem; outline:none; font-family:'JetBrains Mono';">
                <div style="display:flex; gap:1rem;">
                    <button type="button" id="modalCancel"
                        style="flex:1; padding:1rem; background:transparent; border:1px solid #334155; color:#64748b; border-radius:12px; cursor:pointer;">ABORT</button>
                    <button type="submit"
                        style="flex:2; padding:1rem; background:#6366f1; color:white; border:none; border-radius:12px; font-weight:bold; cursor:pointer;">INITIATE</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(modal);

    document.getElementById('modalCancel').onclick = () => modal.remove();

    document.getElementById('modalAnalysisForm').onsubmit = async (e) => {
        e.preventDefault();
        const username = document.getElementById('modalUsername').value.trim().replace('@', '');
        if (!username) return;
        modal.remove();
        await launchAnalysis(platform, username);
    };
}

// ==================== FIRE-AND-FORGET ENGINE ====================
// How this works:
//   1. Call edge function → returns 202 in ~1-2s with { reportId }
//   2. Edge function runs the real work in background (EdgeRuntime.waitUntil)
//   3. We poll DB every 2.5s watching `status` change:
//      scraping → (transcribing) → analyzing → completed | failed
//   4. Loader updates in real-time to reflect actual stage
//   5. On completed → redirect. On failed → show error. On timeout → show escape hatch.
//
// Works identically for Instagram, YouTube, and TikTok — platform only affects
// which edge function name + payload key is used.

async function launchAnalysis(platform, username) {
    showFuturisticLoader(username, platform);

    let pollInterval  = null;
    let timeoutHandle = null;
    let currentPct    = 5;
    let lastStatus    = "";

    // Updates loader label + animates progress bar forward (never backward)
    const setStage = (label, targetPct, warn = false) => {
        const statusEl = document.getElementById('loader-status');
        const pctEl    = document.getElementById('loader-percent');
        const barEl    = document.getElementById('loader-bar');
        if (statusEl) {
            statusEl.textContent  = label;
            statusEl.style.color  = warn ? '#f59e0b' : '';
        }
        if (targetPct > currentPct) {
            currentPct = targetPct;
            if (pctEl) pctEl.textContent = `${targetPct}%`;
            if (barEl) barEl.style.width = `${targetPct}%`;
        }
    };

    const stopAll = () => {
        if (pollInterval)  clearInterval(pollInterval);
        if (timeoutHandle) clearTimeout(timeoutHandle);
    };

    const showError = (msg) => {
        stopAll();
        document.getElementById('cyber-overlay')?.remove();
        showNotification(`⚠️ ${msg}`, "error");
    };

    try {
        // ── Map platform to edge function + payload ───────────────
        const fnName = 'Insta-scrap'; // Instagram only

        const { data: { user } } = await supabaseClient.auth.getUser();
        const payload = { userId: user.id, username };

        setStage("ESTABLISHING NEURAL UPLINK...", 5);

        // ── Invoke edge function ──────────────────────────────────
        // Returns almost instantly (202) with reportId.
        // Heavy work runs in background on the server.
        const { data, error } = await supabaseClient.functions.invoke(fnName, { body: payload });

        if (error) throw new Error(error.message || "Edge function failed");
        if (!data?.reportId) throw new Error("No reportId returned — check edge function logs");

        const reportId = data.reportId;
        console.log(`✅ reportId: ${reportId} | Polling every ${POLL_INTERVAL_MS}ms`);

        setStage("NEURAL UPLINK ESTABLISHED — AWAITING DATA...", 10);

        // ── Timeout safety net ────────────────────────────────────
        // If still not completed after 8 minutes, stop polling and
        // give the user an escape hatch to the reports page.
        timeoutHandle = setTimeout(() => {
            clearInterval(pollInterval);
            const subEl = document.getElementById('loader-sub');
            if (subEl) {
                subEl.textContent = "Report will appear in Archives when ready.";
                subEl.style.color = '#64748b';
            }
            setStage("TAKING LONGER THAN EXPECTED...", currentPct, true);

            // Add escape button so user isn't trapped on the loader screen
            const overlay = document.getElementById('cyber-overlay');
            if (overlay) {
                const btn = document.createElement('button');
                btn.textContent = "→ CHECK ARCHIVES";
                btn.style.cssText = `margin-top:2.5rem; padding:0.8rem 2rem; background:transparent;
                    border:1px solid #6366f1; color:#6366f1; border-radius:10px; cursor:pointer;
                    font-family:'JetBrains Mono'; font-size:0.8rem; letter-spacing:2px; position:relative;`;
                btn.onclick = () => { window.location.href = "reports.html"; };
                overlay.appendChild(btn);
            }
        }, POLL_TIMEOUT_MS);

        // ── Polling engine ────────────────────────────────────────
        pollInterval = setInterval(async () => {
            try {
                const { data: report, error: pollErr } = await supabaseClient
                    .from('reports')
                    .select('status')
                    .eq('id', reportId)
                    .single();

                // Transient DB error — just wait for next tick
                if (pollErr) {
                    console.warn("Poll DB error (retrying):", pollErr.message);
                    return;
                }

                const status = report?.status || "scraping";

                // Only update UI on actual status change
                if (status !== lastStatus) {
                    lastStatus = status;
                    console.log(`📡 Status changed → ${status}`);
                    const stage = STAGE_MAP[status] || STAGE_MAP.scraping;
                    setStage(stage.label, stage.pct);
                    updateStageDots(status);
                }

                // ── Terminal: success ─────────────────────────────
                if (status === 'completed') {
                    stopAll();
                    setStage("EXTRACTION COMPLETE ✓", 100);
                    updateStageDots('completed');
                    showNotification("✅ EXTRACTION COMPLETE", "success");
                    // Brief pause so user sees 100% before redirect
                    setTimeout(() => {
                        window.location.href = `reports.html?id=${reportId}`;
                    }, 700);
                }

                // ── Terminal: failure ─────────────────────────────
                else if (status === 'failed') {
                    stopAll();
                    // Fetch error detail from DB
                    const { data: fullReport } = await supabaseClient
                        .from('reports')
                        .select('ai_insights')
                        .eq('id', reportId)
                        .single();
                    const detail = fullReport?.ai_insights?.error || "Check edge function logs";
                    console.error("Report failed:", detail);
                    showError(`NEURAL LINK FAILED: ${detail.substring(0, 100)}`);
                }

            } catch (pollEx) {
                // Unexpected error in poll loop — log but keep going
                console.warn("Unexpected poll exception:", pollEx);
            }
        }, POLL_INTERVAL_MS);

    } catch (err) {
        stopAll();
        document.getElementById('cyber-overlay')?.remove();
        showNotification(`⚠️ NEURAL LINK FAILED: ${err.message}`, "error");
        console.error("launchAnalysis error:", err);
    }
}

// ==================== LOADER UI ====================

function showFuturisticLoader(username, platform) {
    document.getElementById('cyber-overlay')?.remove();

    const colors = { instagram: '#e1306c' };
    const ac = colors[platform] || '#6366f1'; // accent color

    const overlay = document.createElement('div');
    overlay.id = "cyber-overlay";
    overlay.style.cssText = `position:fixed; inset:0; background:#050505; z-index:20000;
        display:flex; align-items:center; justify-content:center; flex-direction:column;`;

    overlay.innerHTML = `
        <style>
            @keyframes scan  { 0%{top:0%}   100%{top:100%} }
            @keyframes pulse { 0%,100%{opacity:.06} 50%{opacity:.14} }
            @keyframes cur   { 0%,100%{opacity:1}   50%{opacity:0}   }
            #loader-bar-wrap { width:min(360px,80vw); height:3px; background:#1a1a2e; border-radius:99px; margin-top:1.8rem; overflow:hidden; }
            #loader-bar      { height:100%; width:5%; border-radius:99px;
                               background:linear-gradient(90deg,${ac},#6366f1);
                               box-shadow:0 0 14px ${ac}; transition:width 1s ease; }
        </style>

        <!-- scan line -->
        <div style="width:100%;height:2px;background:${ac};position:absolute;
             box-shadow:0 0 20px ${ac};animation:scan 2.5s linear infinite;opacity:0.5;"></div>

        <!-- big watermark percent -->
        <div id="loader-percent" style="font-size:22vw;font-weight:900;color:rgba(99,102,241,0.05);
             position:absolute;font-family:'JetBrains Mono';user-select:none;animation:pulse 3s infinite;">5%</div>

        <!-- main content -->
        <div style="position:relative;text-align:center;padding:0 2rem;max-width:500px;width:100%;">

            <div style="font-size:0.65rem;letter-spacing:6px;color:${ac};margin-bottom:1.4rem;opacity:0.8;">
                ${platform.toUpperCase()} NEURAL SCAN
            </div>

            <h2 style="color:white;letter-spacing:5px;font-family:'JetBrains Mono';
                font-size:clamp(0.9rem,3.5vw,1.5rem);line-height:1.3;">
                SCANNING_${username.toUpperCase()}<span style="animation:cur 1s infinite;">_</span>
            </h2>

            <p id="loader-status" style="color:${ac};margin-top:1.2rem;font-size:0.72rem;
               font-family:'JetBrains Mono';letter-spacing:2px;">
                ESTABLISHING NEURAL UPLINK...
            </p>

            <p id="loader-sub" style="color:#2a2a3e;margin-top:0.5rem;font-size:0.6rem;
               font-family:'JetBrains Mono';">
                This takes 2–4 minutes &nbsp;·&nbsp; Do not close this tab.
            </p>

            <div id="loader-bar-wrap"><div id="loader-bar"></div></div>

            <!-- stage dots -->
            <div style="display:flex;gap:2rem;justify-content:center;margin-top:1.6rem;
                 font-size:0.58rem;font-family:'JetBrains Mono';letter-spacing:1px;">
                <span id="sd-scraping"  style="color:#2a2a3e;">◇ SCRAPING</span>
                <span id="sd-analyzing" style="color:#2a2a3e;">◇ ANALYZING</span>
                <span id="sd-completed" style="color:#2a2a3e;">◇ COMPLETE</span>
            </div>
        </div>`;

    document.body.appendChild(overlay);
}

// Updates the 3 stage dots at the bottom of the loader
function updateStageDots(status) {
    const set = (id, active, label) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = (active ? '◆ ' : '◇ ') + label;
        el.style.color  = active ? '#6366f1' : '#2a2a3e';
    };
    const done = (s) => ['scraping','transcribing','analyzing','completed'].indexOf(status) >=
                        ['scraping','transcribing','analyzing','completed'].indexOf(s);
    set('sd-scraping',  done('scraping'),  'SCRAPING');
    set('sd-analyzing', done('analyzing'), 'ANALYZING');
    set('sd-completed', status === 'completed', 'COMPLETE');
}

// ==================== OTHER HELPERS ====================

async function syncUserProfile(user) {
    const { data: profile } = await supabaseClient.from('profiles').select('first_name').eq('id', user.id).maybeSingle();
    const name = profile?.first_name || user.email.split('@')[0];
    document.getElementById('userName').textContent     = name;
    document.getElementById('userEmail').textContent    = user.email;
    document.getElementById('userInitials').textContent = name.charAt(0).toUpperCase();
    document.getElementById('welcomeText').textContent  = `SYSTEM ONLINE, ${name.toUpperCase()} ⚡`;
}

function applyLockOverlay(card) {
    card.classList.add('node-locked');
    card.style.filter = 'grayscale(1) brightness(0.3)';
    const overlay = document.createElement('div');
    overlay.className = 'lock-overlay';
    overlay.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);`;
    overlay.innerHTML = `<span style="border:1px solid #ef4444;color:#ef4444;padding:5px 10px;border-radius:4px;font-size:0.6rem;font-weight:bold;">NODE LOCKED</span>`;
    card.appendChild(overlay);
}

function showNotification(message, type = 'info') {
    const n = document.createElement('div');
    n.textContent = message;
    n.style.cssText = `position:fixed;bottom:30px;left:50%;transform:translateX(-50%);padding:1rem 2rem;
        background:${type === 'error' ? '#ef4444' : '#10b981'};color:white;border-radius:10px;
        z-index:30000;font-weight:bold;box-shadow:0 10px 30px rgba(0,0,0,0.5);font-family:'Outfit';`;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 4000);
}