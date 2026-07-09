import { Link } from "wouter";
import { Zap, ArrowLeft } from "lucide-react";

export default function TermsPage() {
  return (
    <div className="min-h-screen text-white" style={{ background: "#040B14" }}>
      <nav className="border-b border-white/8 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-[#00E676]/20 flex items-center justify-center"><Zap className="h-3.5 w-3.5 text-[#00E676]" /></div>
            <span className="font-bold text-white">GrowthForge</span>
          </Link>
          <Link href="/" className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to home
          </Link>
        </div>
      </nav>
      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-10">
          <p className="text-[#00E676] text-sm font-semibold mb-2">Legal</p>
          <h1 className="text-4xl font-black text-white mb-3">Terms of Service</h1>
          <p className="text-white/40 text-sm">Last updated: July 9, 2026 · Strapli Technologies Inc.</p>
        </div>

        <div className="prose prose-invert max-w-none space-y-8 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-xl font-bold text-white mb-3">1. Acceptance of Terms</h2>
            <p>By accessing or using GrowthForge (the "Service") provided by Strapli Technologies Inc. ("Company," "we," "us," or "our"), you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the Service.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">2. Description of Service</h2>
            <p>GrowthForge is an AI-powered marketing platform that analyzes businesses, generates marketing content, provides competitor intelligence, and delivers marketing assets including AI-rendered video. The Service is provided on a subscription basis with a free trial period.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">3. Account Registration</h2>
            <p>To use the Service, you must create an account. You agree to:</p>
            <ul className="list-disc list-inside space-y-1.5 ml-2 mt-3">
              <li>Provide accurate, current, and complete information</li>
              <li>Maintain and update your account information</li>
              <li>Keep your password secure and confidential</li>
              <li>Accept responsibility for all activity under your account</li>
              <li>Notify us immediately of any unauthorized account access</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">4. Free Trial</h2>
            <p>GrowthForge offers a 14-day free trial with limited usage. During the trial, you have access to core features subject to usage limits. No credit card is required to start a free trial. Trial limits are subject to change at our discretion.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">5. Paid Subscriptions, Usage & Refund Terms</h2>
            <p>By subscribing to any paid plan, you explicitly acknowledge and agree to the following:</p>
            <ul className="list-disc list-inside space-y-2 ml-2 mt-3">
              <li><strong className="text-white">AI Resource Consumption:</strong> Every action you take on the platform — including business analysis, competitor discovery, content generation, video rendering, and Forge AI interactions — immediately consumes computational resources that are non-recoverable. The subscription payment compensates for both platform access and these AI resources.</li>
              <li><strong className="text-white">Usage-Based Refund Eligibility:</strong> Refund eligibility is determined by Strapli Technologies based solely on internal platform usage records. Significant consumption of platform resources, as determined at our sole discretion, forfeits refund eligibility regardless of the time elapsed since payment.</li>
              <li><strong className="text-white">Video Rendering is Non-Refundable:</strong> The initiation of any video rendering job — regardless of render time, output length, or quality tier — immediately renders the subscription payment for that billing period fully earned and non-refundable. This applies even within the standard refund window. By initiating a video render, you acknowledge and accept that no refund will be issued.</li>
              <li><strong className="text-white">Consent to Monitoring:</strong> You consent to Strapli Technologies monitoring and recording your platform usage activity for the purposes of refund eligibility determination, fraud prevention, and chargeback dispute resolution.</li>
              <li><strong className="text-white">Chargeback Disputes:</strong> In the event you initiate a payment dispute (chargeback) with your bank or payment processor, you authorize Strapli Technologies to submit your platform usage records, timestamps, and this agreement as evidence in the dispute resolution process.</li>
            </ul>
            <p className="mt-3">The full terms of refund eligibility, refund windows, and abuse prevention are set out in our <Link href="/refund-policy" className="text-[#00E676]">Refund Policy</Link>, which is incorporated into these Terms by reference. By subscribing to any paid plan, you confirm that you have read, understood, and agreed to the Refund Policy in its entirety.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">6. Acceptable Use</h2>
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc list-inside space-y-1.5 ml-2 mt-3">
              <li>Violate any applicable laws or regulations</li>
              <li>Infringe upon intellectual property rights</li>
              <li>Generate spam, misleading, or deceptive content</li>
              <li>Harass, abuse, or harm other individuals</li>
              <li>Attempt to gain unauthorized access to the Service or its systems</li>
              <li>Reverse engineer, decompile, or disassemble the Service</li>
              <li>Use automated bots or scrapers without written permission</li>
              <li>Create multiple accounts to circumvent usage limits, trial restrictions, or refund policies</li>
              <li>Exploit refund policies in bad faith, including consuming significant platform resources with the intent to request a refund</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">7. Intellectual Property</h2>
            <p>The Service, including all software, content, and materials, is owned by Strapli Technologies Inc. and protected by intellectual property laws. You retain ownership of content you create using the Service. By using the Service, you grant us a limited license to process your content to provide and improve the Service.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">8. AI-Generated Content</h2>
            <p>GrowthForge uses artificial intelligence to generate content, strategies, and recommendations. You acknowledge that:</p>
            <ul className="list-disc list-inside space-y-1.5 ml-2 mt-3">
              <li>AI-generated content may not always be accurate or complete</li>
              <li>You are responsible for reviewing and verifying all AI-generated content</li>
              <li>We make no warranties about the accuracy of AI outputs</li>
              <li>You are solely responsible for how you use AI-generated content</li>
              <li>Dissatisfaction with AI output quality does not constitute grounds for a refund</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">9. Disclaimer of Warranties</h2>
            <p>THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR MEET YOUR SPECIFIC REQUIREMENTS.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">10. Limitation of Liability</h2>
            <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, STRAPLI TECHNOLOGIES INC. SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF YOUR USE OF THE SERVICE.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">11. Termination</h2>
            <p>We reserve the right to suspend or terminate your account at our discretion if you violate these Terms, including without limitation any breach of the acceptable use or refund abuse provisions. You may cancel your account at any time. Upon termination, your right to use the Service ceases immediately. No refund is issued upon termination for cause.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">12. Governing Law</h2>
            <p>These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which Strapli Technologies Inc. is incorporated, without regard to conflict of law principles.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">13. Contact</h2>
            <div className="mt-3 p-4 rounded-xl border border-white/8 bg-white/3">
              <p><strong className="text-white">Strapli Technologies Inc.</strong></p>
              <p>Legal: <a href="mailto:legal@usegrowthforge.com" className="text-[#00E676]">legal@usegrowthforge.com</a></p>
              <p>Billing: <a href="mailto:billing@usegrowthforge.com" className="text-[#00E676]">billing@usegrowthforge.com</a></p>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
