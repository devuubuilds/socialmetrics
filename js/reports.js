const SUPABASE_URL = "https://mtqnkdblgieliqkthasc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10cW5rZGJsZ2llbGlxa3RoYXNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3MDAyNjIsImV4cCI6MjA4NTI3NjI2Mn0.-trmIlrF9SUnrEJD9Y-K3doiPcT0YOwiwtLwQtixh0I";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// We store reports in a global variable so the Realtime listener can update them
let globalReports = [];

window.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return window.location.replace("login.html");

    // --- 1. SIDEBAR & PROFILE SYNC ---
    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', session.user.id)
        .single();

    const fullName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : session.user.user_metadata?.full_name;
    const finalDisplayName = fullName || session.user.email.split('@')[0];

    document.querySelectorAll('.user-name').forEach(el => el.textContent = finalDisplayName);
    document.querySelectorAll('.user-email').forEach(el => el.textContent = session.user.email);

    // --- 2. THE RENDER FUNCTION ---
    // This draws the list on the screen
    function renderReportsList() {
        const list = document.getElementById('reportsList');
        if (!list) return;

        if (globalReports && globalReports.length > 0) {
            list.innerHTML = globalReports.map(r => `
                <div class="report-card" id="report-${r.id}" style="background: #1a1a24; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; transition: 0.3s;">
                    <div style="display: flex; align-items: center; gap: 1.5rem;">
                        <div style="width: 50px; height: 50px; background: #0f172a; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">
                            ${getPlatformIcon(r.platform)}
                        </div>
                        <div>
                            <h3 style="margin: 0; color: white; font-size: 1.1rem;">Analysis for ${r.target_handle || 'User'}</h3>
                            <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 0.85rem;">
                                <span style="text-transform: uppercase; font-weight: bold; color: #6366f1;">${r.platform}</span> • ${new Date(r.created_at).toLocaleDateString()}
                            </p>
                        </div>
                    </div>
                    
                    <div style="display: flex; align-items: center; gap: 2rem;">
                        <div style="text-align: right;">
                            <span style="background: ${getStatusColor(r.status)}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase;">
                                ${r.status}
                            </span>
                        </div>
                        ${r.status === 'completed' ? `
                            <a href="view-report.html?id=${r.id}" style="background: #6366f1; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 0.9rem; transition: 0.2s;" onmouseover="this.style.background='#4f46e5'" onmouseout="this.style.background='#6366f1'">
                                View Report
                            </a>
                        ` : `
                            <button disabled style="background: #334155; color: #94a3b8; padding: 10px 20px; border-radius: 8px; border: none; font-weight: 600; font-size: 0.9rem; cursor: not-allowed;">
                                <span class="spinner" style="display: inline-block; width: 12px; height: 12px; border: 2px solid #94a3b8; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px;"></span>
                                Processing...
                            </button>
                        `}
                    </div>
                </div>
            `).join('');
        } else {
            list.innerHTML = `<div style="text-align: center; padding: 4rem; color: #94a3b8;">
                <div style="font-size: 4rem; margin-bottom: 1rem;">🔎</div>
                <h3>No Reports Yet</h3>
                <p>Go to the dashboard to start your first AI analysis!</p>
                <a href="dashboard.html" style="color: #6366f1; text-decoration: none; font-weight: bold;">Return to Dashboard →</a>
            </div>`;
        }
    }

    // --- 3. INITIAL LOAD ---
    const { data: reports, error } = await supabaseClient
        .from('reports')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

    if (error) {
        document.getElementById('reportsList').innerHTML = `<p style="color: #ef4444; padding: 20px;">Error: ${error.message}</p>`;
        return;
    }

    globalReports = reports || [];
    renderReportsList();

    // --- 4. REALTIME LISTENER 🚀 ---
    // This detects when the Edge Function updates a row in the database
    supabaseClient
        .channel('any-channel-name')
        .on(
            'postgres_changes',
            {
                event: 'UPDATE', // Listen for when status changes from processing -> completed
                schema: 'public',
                table: 'reports',
                filter: `user_id=eq.${session.user.id}`
            },
            (payload) => {
                console.log('Realtime Update Received:', payload.new);
                
                // Update our local array with the new data from the database
                const index = globalReports.findIndex(r => r.id === payload.new.id);
                if (index !== -1) {
                    globalReports[index] = payload.new;
                    renderReportsList(); // Re-draw the list immediately
                }
            }
        )
        .subscribe();
});

// Helpers
function getPlatformIcon(platform) {
    switch (platform?.toLowerCase()) {
        case 'instagram': return '📸';
        case 'tiktok': return '🎵';
        case 'youtube': return '📺';
        default: return '📊';
    }
}

function getStatusColor(status) {
    switch (status?.toLowerCase()) {
        case 'completed': return '#10b981';
        case 'processing': return '#6366f1';
        case 'failed': return '#ef4444';
        default: return '#f59e0b';
    }
}