document.addEventListener("DOMContentLoaded", () => {
  const SUPABASE_URL = "https://mtqnkdblgieliqkthasc.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10cW5rZGJsZ2llbGlxa3RoYXNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3MDAyNjIsImV4cCI6MjA4NTI3NjI2Mn0.-trmIlrF9SUnrEJD9Y-K3doiPcT0YOwiwtLwQtixh0I";
  const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  /* Form Switching Logic */
  document.querySelectorAll(".switch-form").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();
      const target = btn.dataset.target;
      document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active"));
      document.getElementById(target)?.classList.add("active");
    });
  });

  /* Email Login */
  const loginForm = document.getElementById("loginFormElement");
  loginForm?.addEventListener("submit", async e => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) { notify(error.message, "error"); } 
    else { window.location.href = "dashboard.html"; }
  });

  /* Social Login (FIXED) */
  document.querySelectorAll(".btn-social").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.preventDefault();
      const provider = btn.classList.contains("google") ? "google" : "github";
      
      // This creates the correct path regardless of where you are hosted
      const redirectUrl = window.location.origin + window.location.pathname.replace("login.html", "dashboard.html");

      await supabaseClient.auth.signInWithOAuth({
        provider,
        options: { redirectTo: redirectUrl }
      });
    });
  });

  function notify(msg, type) {
    const n = document.createElement("div");
    n.textContent = msg;
    n.style.cssText = `position:fixed;top:20px;right:20px;padding:15px;background:${type==="error"?"#ef4444":"#10b981"};color:white;border-radius:10px;z-index:9999;`;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
  }
});