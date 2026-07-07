import { SignIn } from "@clerk/react";
import { Link } from "wouter";

export default function SignInPage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "#040B14" }}
    >
      <div className="mb-8 flex flex-col items-center gap-3">
        <Link href="/" className="flex items-center gap-2 mb-2">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 4L10 16h7L13 28l14-16h-9l5-8z" fill="#00E676" />
          </svg>
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
