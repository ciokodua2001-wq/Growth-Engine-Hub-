import { Link } from "wouter";
import { Zap, ArrowLeft } from "lucide-react";

export default function RefundPolicyPage() {
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
          <h1 className="text-4xl font-black text-white mb-3">Refund Policy</h1>
          <p className="text-white/40 text-sm">Last updated: July 9, 2026 · Strapli Technologies Inc.</p>
        </div>

        <div className="prose prose-invert max-w-none space-y-8 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-xl font-bold text-white mb-3">1. Free Trial</h2>
            <p>GrowthForge offers a 14-day free trial with no credit card required. No charges are made during the trial period and no refunds are applicable. You may cancel at any time before the trial ends without any obligation.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">2. Paid Subscriptions — Refund Window</h2>
            <p>Upon the launch of paid plans, the following refund terms apply:</p>
            <ul className="list-disc list-inside space-y-2 ml-2 mt-3">
              <li><strong className="text-white">3-Day Satisfaction Window:</strong> You may request a full refund within 3 calendar days of your first payment, provided that AI quota consumption on the account does not exceed the thresholds defined in Section 3 below.</li>
              <li><strong className="text-white">After 3 Days:</strong> Refunds are not available. You may cancel at any time, and access continues until the end of the current billing period. No partial refunds are issued for unused time within a billing period.</li>
              <li><strong className="text-white">Annual Plans:</strong> Annual subscriptions may be refunded within 7 days of purchase, subject to the AI usage thresholds in Section 3. Annual refunds are not available after 7 days regardless of usage.</li>
              <li><strong className="text-white">Renewal Charges:</strong> Refunds are not available for subscription renewal charges. It is your responsibility to cancel before the renewal date if you do not wish to continue.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">3. AI Usage & Consumption Policy</h2>
            <p>GrowthForge is an AI-powered platform. Each action you take — website analysis, competitor discovery, content generation, video rendering, Forge AI interactions — consumes computational resources that are incurred immediately and are non-recoverable. Because of this:</p>
            <ul className="list-disc list-inside space-y-2 ml-2 mt-3">
              <li><strong className="text-white">High-Usage Accounts:</strong> If more than 40% of any monthly AI quota (analyses, content pieces, video minutes, or Forge AI chats) has been consumed within the refund window, refund eligibility is forfeited regardless of time elapsed.</li>
              <li><strong className="text-white">Video Rendering:</strong> Rendered video minutes are non-refundable once processing has been initiated, irrespective of the refund window. Video Blueprint generation (scripts, storyboards) is subject to the standard 40% usage threshold.</li>
              <li><strong className="text-white">Partial Refunds:</strong> At our sole discretion, we may issue a partial refund proportional to unconsumed quota where high usage would otherwise forfeit a full refund. This is not guaranteed and will be evaluated case by case.</li>
            </ul>
            <p className="mt-3">We reserve the right to review account activity logs before approving any refund request. Refund requests submitted without usage review are not binding.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">4. Cancellation</h2>
            <p>You may cancel your subscription at any time from your account settings. Cancellation takes effect at the end of the current billing period. You will retain full access to your plan until the period ends. No partial refunds are issued for the remaining days in a cancelled billing period.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">5. Exceptions & Discretionary Refunds</h2>
            <p>We may issue refunds outside our standard policy at our sole discretion in the following circumstances only:</p>
            <ul className="list-disc list-inside space-y-1.5 ml-2 mt-3">
              <li>Verified service outages exceeding 24 consecutive hours of platform unavailability</li>
              <li>Confirmed billing errors or duplicate charges caused by our systems</li>
              <li>Verified technical failures preventing access to core features, documented and reported within 72 hours of occurrence</li>
            </ul>
            <p className="mt-3">Dissatisfaction with AI-generated output quality, output volume, or subjective expectations of results does not constitute grounds for a discretionary refund.</p>
            <p className="mt-3">To report an eligible issue, contact <a href="mailto:billing@usegrowthforge.com" className="text-[#00E676]">billing@usegrowthforge.com</a> within 72 hours of the incident with supporting documentation.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">6. Refund Abuse & Fraud Prevention</h2>
            <p>GrowthForge actively monitors for refund abuse. The following conduct may result in permanent account termination, denial of refund, and where applicable, legal action:</p>
            <ul className="list-disc list-inside space-y-1.5 ml-2 mt-3">
              <li>Requesting a refund after deliberately exhausting monthly AI quota or video rendering credits</li>
              <li>Creating multiple accounts to exploit the refund window or trial period repeatedly</li>
              <li>Providing false or misleading information in a refund request</li>
              <li>Initiating a payment dispute (chargeback) without first contacting our billing team</li>
              <li>Sharing, reselling, or redistributing AI-generated outputs in violation of our Terms of Service prior to or concurrent with a refund request</li>
            </ul>
            <p className="mt-3">We reserve the right to dispute any chargeback filed by an account with documented usage activity. Evidence of platform use will be submitted to the relevant payment processor.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">7. Non-Refundable Items</h2>
            <p>The following are not eligible for refunds under any circumstance:</p>
            <ul className="list-disc list-inside space-y-1.5 ml-2 mt-3">
              <li>Rendered video minutes once processing has been initiated</li>
              <li>Add-on services, one-time purchases, or usage top-ups</li>
              <li>Subscriptions cancelled after the applicable refund window</li>
              <li>Renewal charges for subscriptions not cancelled prior to the renewal date</li>
              <li>Accounts suspended or terminated for Terms of Service violations</li>
              <li>Any plan where AI quota consumption exceeds 40% within the refund window</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">8. How to Request a Refund</h2>
            <p>To submit a refund request within the eligible window:</p>
            <ol className="list-decimal list-inside space-y-2 ml-2 mt-3">
              <li>Email <a href="mailto:billing@usegrowthforge.com" className="text-[#00E676]">billing@usegrowthforge.com</a> with the subject line: <strong className="text-white">"Refund Request — [Your Account Email]"</strong></li>
              <li>Include your account email, subscription plan, date of charge, and a brief reason for the request</li>
              <li>Our team will review your account activity within 2 business days and respond with an eligibility determination</li>
              <li>Approved refunds are processed within 5–10 business days and issued to the original payment method</li>
            </ol>
            <p className="mt-3">Refund requests submitted via social media, community forums, or any channel other than the billing email above will not be processed.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">9. Governing Terms</h2>
            <p>This Refund Policy is incorporated into and governed by GrowthForge's <Link href="/terms" className="text-[#00E676]">Terms of Service</Link>. In the event of any conflict between this policy and the Terms of Service, the Terms of Service shall prevail. Strapli Technologies Inc. reserves the right to amend this policy at any time. Continued use of the platform following any amendment constitutes acceptance of the revised policy.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">10. Contact</h2>
            <div className="mt-3 p-4 rounded-xl border border-white/8 bg-white/3">
              <p>For all billing questions and refund requests:</p>
              <p className="mt-2"><strong className="text-white">Email:</strong> <a href="mailto:billing@usegrowthforge.com" className="text-[#00E676]">billing@usegrowthforge.com</a></p>
              <p><strong className="text-white">Response time:</strong> Within 2 business days</p>
              <p className="mt-2 text-white/40 text-sm">Please do not initiate a payment dispute before contacting us — our team is committed to resolving billing issues promptly and fairly.</p>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
