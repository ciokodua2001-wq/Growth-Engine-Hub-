import { AuthenticateWithRedirectCallback } from "@clerk/clerk-react";

export default function SsoCallback() {
  return (
    <div className="min-h-screen bg-[#080B14] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-xl shadow-lg shadow-indigo-900/40">
          Z
        </div>
        <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        <p className="text-sm text-white/30">Signing you in…</p>
      </div>
      <AuthenticateWithRedirectCallback />
    </div>
  );
}
