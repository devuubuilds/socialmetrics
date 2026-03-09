const SUPABASE_URL = "https://mtqnkdblgieliqkthasc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10cW5rZGJsZ2llbGlxa3RoYXNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3MDAyNjIsImV4cCI6MjA4NTI3NjI2Mn0.-trmIlrF9SUnrEJD9Y-K3doiPcT0YOwiwtLwQtixh0I";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

window.addEventListener('DOMContentLoaded', async () => {
    // 1. Get Session
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return window.location.href = 'login.html';

    const user = session.user;

    // 2. Fetch from profiles table (The real source of truth)
    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', user.id)
        .single();

    // Logic to handle if names are null or empty
    const firstName = profile?.first_name || "";
    const lastName = profile?.last_name || "";
    const fullName = (firstName + " " + lastName).trim() || user.user_metadata?.full_name || "";

    // 3. Fill the Input Boxes
    const nameInput = document.getElementById('name');
    const emailInput = document.getElementById('email');
    
    if (nameInput) nameInput.value = fullName;
    if (emailInput) emailInput.value = user.email;
    
    // 4. Update ALL Sidebar elements (fixes the sync bug)
    const finalDisplayName = fullName || user.email.split('@')[0];
    document.querySelectorAll('.user-name').forEach(el => el.textContent = finalDisplayName);
    document.querySelectorAll('.user-email').forEach(el => el.textContent = user.email);
});

async function saveSettings() {
    const btn = document.querySelector('button[onclick="saveSettings()"]');
    if (!btn) return;

    const originalText = btn.innerText;
    btn.innerText = "Saving...";
    btn.disabled = true;

    const fullName = document.getElementById('name').value.trim();
    
    // Split name properly even if they only enter one name
    const nameParts = fullName.split(/\s+/); 
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    try {
        const { data: { user } } = await supabaseClient.auth.getUser();

        // STEP A: Update Auth Metadata
        const { error: authError } = await supabaseClient.auth.updateUser({
            data: { full_name: fullName }
        });
        if (authError) throw authError;

        // STEP B: Update Profiles Table (using upsert to create if it doesn't exist)
        const { error: profileError } = await supabaseClient
            .from('profiles')
            .upsert({ 
                id: user.id,
                email: user.email,
                first_name: firstName, 
                last_name: lastName,
                updated_at: new Date().toISOString()
            });

        if (profileError) throw profileError;

        // STEP C: Refresh the session so the new name is inside the browser token
        await supabaseClient.auth.refreshSession();

        // Show a nice success message (you can use your showNotification function here)
        alert("✅ Profile Updated Successfully!");
        
        // Reload to ensure all components see the new data
        window.location.reload();

    } catch (error) {
        console.error("Update Error:", error);
        alert("Update failed: " + error.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}