const SUPABASE_URL = "https://mtqnkdblgieliqkthasc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10cW5rZGJsZ2llbGlxa3RoYXNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3MDAyNjIsImV4cCI6MjA4NTI3NjI2Mn0.-trmIlrF9SUnrEJD9Y-K3doiPcT0YOwiwtLwQtixh0I";
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

window.addEventListener('DOMContentLoaded', async () => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) return;

    const { data: report, error } = await _supabase.from('reports').select('*').eq('id', id).single();
    if (error || !report) return;

    document.getElementById('loading').style.display = 'none';

    // 🎯 GET HTML FROM html_report COLUMN (NOT ai_insights.html)
    if (report.html_report) {
        // Inject the pre-rendered HTML from edge function
        document.getElementById("report-container").innerHTML = report.html_report;
    } else if (report.status === 'completed') {
        document.getElementById("report-container").innerHTML = "<h2>Report completed but HTML not found</h2>";
    } else if (report.status === 'transcribing') {
        const progress = report.content_data?.transcribed_count || 0;
        const total = report.content_data?.total_reels || 0;
        document.getElementById("report-container").innerHTML = `<h2>Transcribing reels... ${progress}/${total}</h2>`;
    } else if (report.status === 'analyzing') {
        document.getElementById("report-container").innerHTML = "<h2>Running AI analysis...</h2>";
    } else {
        document.getElementById("report-container").innerHTML = `<h2>Report ${report.status}...</h2>`;
    }
});