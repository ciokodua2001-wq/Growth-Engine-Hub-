import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useUser } from "@clerk/react";
import { Loader2, CheckCircle2, XCircle, Users } from "lucide-react";
import { Link } from "wouter";

type AcceptState = "loading" | "accepting" | "success" | "error" | "needsAuth";

export default function TeamAccept() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { isLoaded, isSignedIn } = useUser();
  const [state, setState] = useState<AcceptState>("loading");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectName, setProjectName] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState("");

  const token = new URLSearchParams(search).get("token") ?? "";

  useEffect(() => {
    if (!isLoaded) return;
    if (!token) { setState("error"); setErrorMsg("Invalid or missing invitation link."); return; }

    if (!isSignedIn) {
      setState("needsAuth");
      return;
    }

    setState("accepting");
    fetch("/api/team/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setProjectId(data.projectId);
          setProjectName(data.projectName ?? "the project");
          setState("success");
        } else {
          setErrorMsg(data.error ?? "Something went wrong.");
          setState("error");
        }
      })
      .catch(() => { setErrorMsg("Network error. Please try again."); setState("error"); });
  }, [isLoaded, isSignedIn, token]);

  const goToSignIn = () => {
    setLocation(`/sign-in?redirect_url=${encodeURIComponent(`/team/accept?token=${token}`)}`);
  };

  return (
    <div className="min-h-screen bg-[#040B14] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <span className="text-2xl font-black text-[#00E676] tracking-tight">GrowthForge AI</span>
        </div>

        <div className="bg-[#080f1e] border border-white/8 rounded-2xl p-8 text-center space-y-4">
          {(state === "loading" || state === "accepting") && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
              <p className="text-white font-semibold">Accepting invitation…</p>
              <p className="text-sm text-white/40">Just a moment</p>
            </>
          )}

          {state === "needsAuth" && (
            <>
              <div className="h-14 w-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
                <Users className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-xl font-bold text-white">You've been invited!</h2>
              <p className="text-sm text-white/50">Sign in or create an account to accept this invitation and start collaborating.</p>
              <button
                onClick={goToSignIn}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3 rounded-xl transition-colors"
              >
                Sign in to Accept
              </button>
            </>
          )}

          {state === "success" && (
            <>
              <div className="h-14 w-14 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-7 w-7 text-green-400" />
              </div>
              <h2 className="text-xl font-bold text-white">You're in!</h2>
              <p className="text-sm text-white/50">You now have access to <strong className="text-white">{projectName}</strong>.</p>
              {projectId && (
                <Link href={`/projects/${projectId}/overview`}>
                  <span className="block w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-3 rounded-xl transition-colors cursor-pointer">
                    Go to Project
                  </span>
                </Link>
              )}
            </>
          )}

          {state === "error" && (
            <>
              <div className="h-14 w-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
                <XCircle className="h-7 w-7 text-red-400" />
              </div>
              <h2 className="text-xl font-bold text-white">Couldn't accept invite</h2>
              <p className="text-sm text-white/50">{errorMsg}</p>
              <Link href="/dashboard">
                <span className="block w-full bg-white/5 hover:bg-white/10 text-white font-semibold py-3 rounded-xl transition-colors cursor-pointer">
                  Go to Dashboard
                </span>
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
