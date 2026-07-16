import { SignIn } from "@clerk/react";
import { Link } from "wouter";
import { Logo } from "@/components/ui/logo";

export default function SignInPage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "#040B14" }}
    >
      <div className="mb-8 flex flex-col items-center gap-3">
        <Link href="/" className="flex items-center gap-3 mb-2">
          <Logo size={52} />
          <span className="text-xl font-bold text-white">GrowthForge</span>
        </Link>
        <p className="text-[#7a8fa6] text-sm">Sign in to your account</p>
      </div>

      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/dashboard"
        appearance={{
          elements: {
            rootBox: "w-full flex justify-center",
          },
        }}
      />

      <p className="mt-6 text-[#7a8fa6] text-sm">
        By signing in you agree to our{" "}
        <a href="#" className="text-[#00E676] hover:underline">Terms of Service</a>
        {" "}and{" "}
        <a href="#" className="text-[#00E676] hover:underline">Privacy Policy</a>.
      </p>
    </div>
  );
}
