// ==================== BILLING ENGINE v10.0 ====================
const SUPABASE_URL      = 'https://mtqnkdblgieliqkthasc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10cW5rZGJsZ2llbGlxa3RoYXNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3MDAyNjIsImV4cCI6MjA4NTI3NjI2Mn0.-trmIlrF9SUnrEJD9Y-K3doiPcT0YOwiwtLwQtixh0I';
const PAYPAL_CLIENT_ID  = 'AdcFI5LChK2-GIloE2Azd4PXGaYUXK6Uv0bgjFYZeT_fa6IoyykOg_1XMeHteN2eTWMLl9jcAdgWiMeN';
const PAYPAL_PLAN_ID    = 'P-16746590U6204582RNGW2DPA';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const PLAN_PRICES = { instagram: 20.00 };
let activeDiscount = null;

// ==================== INIT ====================

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    await syncUserSidebar(session.user);
    await refreshSubscriptionStatus(session.user);

    const priceSpan = document.getElementById('price-instagram');
    if (priceSpan) priceSpan.textContent = '20.00';

    loadPayPalSDK(() => renderPayPalButton());
});

// ==================== PAYPAL ====================

function loadPayPalSDK(callback) {
    if (window.paypal) { callback(); return; }
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&vault=true&intent=subscription`;
    s.setAttribute('data-sdk-integration-source', 'button-factory');
    s.onload = callback;
    s.onerror = () => {
        const c = document.getElementById('paypal-billing-btn-container');
        if (c) c.innerHTML = '<p style="color:#ef4444;font-size:0.8rem;text-align:center;padding:1rem;">⚠️ PayPal failed to load. Check your connection.</p>';
    };
    document.head.appendChild(s);
}

function renderPayPalButton() {
    const container = document.getElementById('paypal-billing-btn-container');
    if (!container) return;
    container.innerHTML = '';

    const basePrice  = PLAN_PRICES.instagram;
    const applies    = !activeDiscount?.applies_to_plans || activeDiscount.applies_to_plans.includes('instagram');
    const finalPrice = (activeDiscount && applies) ? basePrice - basePrice * activeDiscount.discount_value / 100 : basePrice;

    if (finalPrice <= 0) {
        container.innerHTML = `<button onclick="finalizePurchase(null)" style="width:100%;padding:1rem;background:#10b981;color:white;border:none;border-radius:12px;font-weight:700;font-size:1rem;cursor:pointer;">🎉 Claim Free Access</button>`;
        return;
    }

    if (!window.paypal) {
        container.innerHTML = '<p style="color:#ef4444;font-size:0.8rem;text-align:center;padding:1rem;">⚠️ PayPal not loaded. Refresh page.</p>';
        return;
    }

    paypal.Buttons({
        style: { shape: 'rect', color: 'blue', layout: 'vertical', label: 'subscribe', height: 48 },
        createSubscription: (_d, actions) => actions.subscription.create({ plan_id: PAYPAL_PLAN_ID }),
        onApprove: async (data) => {
            showNotification('🔄 Activating your subscription...', 'info');
            await finalizePurchase(data.subscriptionID);
        },
        onError: (err) => {
            console.error('PayPal error:', err);
            showNotification('⚠️ PayPal error. Please try again.', 'error');
        }
    }).render('#paypal-billing-btn-container');
}

// ==================== FINALIZE ====================

async function finalizePurchase(subscriptionId) {
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        const providerId = subscriptionId ? 'PAYPAL_SUB_' + subscriptionId : (activeDiscount ? 'BYPASS_' + activeDiscount.code : 'FREE');

        const { error } = await supabaseClient.rpc('activate_user_plan', {
            p_user_id:     user.id,
            p_plan_slug:   'instagram',
            p_provider_id: providerId
        });
        if (error) throw error;

        if (activeDiscount) {
            await supabaseClient.from('discount_code_usage').insert({
                discount_code_id:      activeDiscount.id,
                user_id:               user.id,
                subscription_id:       subscriptionId,
                discount_amount_cents: 0
            });
        }

        showNotification('🚀 SUBSCRIPTION ACTIVE — REDIRECTING...', 'success');
        setTimeout(() => window.location.href = 'dashboard.html', 2000);
    } catch (err) {
        console.error('finalizePurchase error:', err);
        showNotification('Error: ' + err.message, 'error');
    }
}

// ==================== DISCOUNT ====================

async function applyDiscount() {
    const code = document.getElementById('discountCode')?.value.trim().toUpperCase();
    if (!code) return;

    try {
        const { data: { user } } = await supabaseClient.auth.getUser();

        const { data: used } = await supabaseClient
            .from('discount_code_usage').select('id').eq('user_id', user.id).maybeSingle();
        if (used) { showNotification('🔒 This account already used a promo code.', 'error'); return; }

        const { data: codeData, error } = await supabaseClient
            .from('discount_codes').select('*').eq('code', code).eq('is_active', true).single();
        if (error || !codeData) { showNotification('❌ Invalid or expired code.', 'error'); return; }

        activeDiscount = codeData;

        const span    = document.getElementById('price-instagram');
        const applies = !codeData.applies_to_plans || codeData.applies_to_plans.includes('instagram');
        if (span && applies) {
            const orig  = PLAN_PRICES.instagram;
            const final = (orig - orig * codeData.discount_value / 100).toFixed(2);
            span.innerHTML = `<span style="text-decoration:line-through;opacity:0.5;font-size:0.8em;">$${orig.toFixed(2)}</span> $${final}`;
        }

        showNotification(`✅ ${codeData.discount_value}% discount applied!`, 'success');
        renderPayPalButton();

    } catch (err) {
        console.error('applyDiscount error:', err);
        showNotification('⚠️ System error. Try again.', 'error');
    }
}

// ==================== SUBSCRIPTION STATUS ====================

async function refreshSubscriptionStatus(user) {
    try {
        const { data: sub } = await supabaseClient
            .from('user_subscriptions')
            .select('plan_id, status, subscription_plans(plan_name)')
            .eq('user_id', user.id).eq('status', 'active').maybeSingle();

        const el = document.getElementById('currentPlanStatus');
        if (!el) return;

        if (!sub) { el.innerHTML = 'NO ACTIVE SUBSCRIPTIONS'; return; }

        let planName = sub.subscription_plans?.plan_name;
        if (!planName && sub.plan_id) {
            const { data: plan } = await supabaseClient
                .from('subscription_plans').select('plan_name').eq('id', sub.plan_id).single();
            planName = plan?.plan_name || 'Active Plan';
        }

        el.innerHTML = `<span style="color:#10b981;font-weight:bold;">● ACTIVE: ${(planName || 'Plan').toUpperCase()}</span>`;
    } catch (err) {
        const el = document.getElementById('currentPlanStatus');
        if (el) el.innerHTML = 'Could not load status.';
    }
}

// ==================== HELPERS ====================

async function syncUserSidebar(user) {
    try {
        const { data: profile } = await supabaseClient
            .from('profiles').select('first_name, last_name').eq('id', user.id).maybeSingle();
        const name = profile?.first_name ? `${profile.first_name} ${profile.last_name || ''}`.trim() : user.email.split('@')[0];
        document.querySelectorAll('.user-name, #displayUserName').forEach(el => el.textContent = name);
        document.querySelectorAll('.user-email, #displayUserEmail').forEach(el => el.textContent = user.email);
    } catch (err) { console.warn('syncUserSidebar:', err); }
}

function showNotification(message, type = 'info') {
    const colors = { success: '#10b981', error: '#ef4444', info: '#6366f1' };
    const n = document.createElement('div');
    n.style.cssText = `position:fixed;bottom:30px;left:50%;transform:translateX(-50%);padding:1rem 2rem;background:${colors[type]||colors.info};color:white;border-radius:10px;z-index:99999;font-family:'Outfit',sans-serif;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,0.4);max-width:90vw;text-align:center;`;
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 4000);
}