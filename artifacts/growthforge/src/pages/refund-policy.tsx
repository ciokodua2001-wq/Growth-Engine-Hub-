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
              <li><strong className="text-white">3-Day Satisfaction Window:</strong> You may request a full refund within 3 calendar days of your first payment, subject to the AI usage conditions defined in Section 3. The 3-day window is an upper time limit, not a guarantee — usage determines eligibility.</li>
              <li><strong className="text-white">After 3 Days:</strong> Refunds are not available. You may cancel at any time and access continues until the end of the current billing period. No partial refunds are issued for unused time within a billing period.</li>
              <li><strong className="text-white">Annual Plans:</strong> Annual subscriptions may be refunded within 7 calendar days of purchase, subject to the AI usage conditions in Section 3. Annual refunds are not available after 7 days under any circumstances.</li>
              <li><strong className="text-white">Renewal Charges:</strong> Refunds are not available for subscription renewal charges. It is the subscriber's responsibility to cancel before the renewal date.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">3. AI Usage & Consumption Policy</h2>
            <p>GrowthForge is an AI-powered platform. Every action — website analysis, competitor discovery, content generation, video rendering, Forge AI interactions — consumes computational resources that are incurred immediately upon execution and are non-recoverable. Accordingly:</p>
            <ul className="list-disc list-inside space-y-2 ml-2 mt-3">
              <li><strong className="text-white">Usage-Based Ineligibility:</strong> If Strapli Technologies determines, based solely on internal platform usage records, that significant quota consumption has occurred during the refund window — across any category including analyses, content pieces, video rendering, or Forge AI interactions — refund eligibility is forfeited, regardless of when within the window the request is submitted. The determination of what constitutes "significant consumption" is made exclusively by Strapli Technologies and is not subject to external audit or disclosure.</li>
              <li><strong className="text-white">Substantial Use Within the Refund Window:</strong> Accounts that substantially or fully utilize their monthly allocation within the refund period — regardless of the time elapsed — are not eligible for a refund. Consuming the majority of your monthly quota within the first 3 days of a subscription is considered full use of the service and forfeits any refund entitlement.</li>
              <li><strong className="text-white">Video Rendering:</strong> Rendered video minutes are non-refundable once processing has been initiated, irrespective of the refund window or usage thresholds. Video Blueprint generation (scripts and storyboards) is subject to the standard usage-based ineligibility assessment above.</li>
              <li><strong className="text-white">Partial Refunds:</strong> At our sole discretion, we may issue a partial refund proportional to demonstrably unconsumed quota. This is not guaranteed and will be evaluated on a case-by-case basis. Requesting a partial refund does not create any entitlement to one.</li>
            </ul>
            <p className="mt-3">All refund requests are subject to a mandatory usage review of internal platform records before any determination is made. Submission of a refund request does not constitute approval.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">4. Cancellation</h2>
            <p>You may cancel your subscription at any time from your account settings. Cancellation takes effect at the end of the current billing period and you retain full access until then. No partial refunds are issued for the remaining days in a cancelled billing period.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">5. Exceptions & Discretionary Refunds</h2>
            <p>We may issue refunds outside our standard policy at our sole discretion, and only in the following circumstances:</p>
            <ul className="list-disc list-inside space-y-1.5 ml-2 mt-3">
              <li>Verified service outages exceeding 24 consecutive hours of platform unavailability</li>
              <li>Confirmed billing errors or duplicate charges caused by our payment systems</li>
              <li>Verified technical failures preventing access to core features, documented and reported to us within 72 hours of occurrence</li>
            </ul>
            <p className="mt-3">The following do not constitute grounds for a discretionary refund under any circumstances: dissatisfaction with AI-generated output quality, output volume, creative direction, or any subjective expectation of results.</p>
            <p className="mt-3">Eligible exceptions must be reported to <a href="mailto:billing@usegrowthforge.com" className="text-[#00E676]">billing@usegrowthforge.com</a> within 72 hours of the incident with supporting documentation. Claims submitted after this window will not be considered.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">6. Refund Abuse & Fraud Prevention</h2>
            <p>Strapli Technologies operates active fraud detection systems that monitor account activity patterns for refund abuse. The following measures are in place to protect the integrity of the platform:</p>
            <ul className="list-disc list-inside space-y-2 ml-2 mt-3">
              <li><strong className="text-white">Velocity Detection:</strong> Accounts exhibiting unusually rapid quota consumption followed by a refund request are automatically flagged for fraud review. Such patterns are treated as indicators of intentional abuse.</li>
              <li><strong className="text-white">Account Linking:</strong> Strapli Technologies may correlate accounts sharing the same IP address, payment method, email domain, or device fingerprint. Abuse patterns detected across linked accounts may result in refund denial on all associated accounts.</li>
              <li><strong className="text-white">Repeat Exploitation:</strong> Creating multiple accounts — across the same or different identities — to repeatedly exploit the refund window or free trial constitutes fraud and may be referred to the relevant payment network and, where applicable, law enforcement.</li>
              <li><strong className="text-white">Chargeback Disputes:</strong> Initiating a payment dispute (chargeback) without first contacting our billing team is a breach of this policy. For any account with documented usage activity, Strapli Technologies will submit platform usage evidence to the relevant payment processor to dispute the chargeback. Accounts with a sustained chargeback history will be permanently banned.</li>
              <li><strong className="text-white">False Claims:</strong> Providing false or misleading information in a refund request — including misrepresenting usage, technical issues, or account ownership — may result in permanent account termination and legal action for fraud.</li>
              <li><strong className="text-white">Output Redistribution:</strong> Sharing, reselling, or commercially redistributing AI-generated outputs in violation of our Terms of Service, concurrent with or prior to a refund request, voids all refund eligibility and may result in legal action.</li>
            </ul>
            <p className="mt-3">Strapli Technologies reserves the right to permanently ban any account found to have engaged in refund abuse, without refund and without prior notice.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">7. Non-Refundable Items</h2>
            <p>The following are not eligible for refunds under any circumstances:</p>
            <ul className="list-disc list-inside space-y-1.5 ml-2 mt-3">
              <li>Rendered video minutes once processing has been initiated</li>
              <li>Subscriptions where Strapli Technologies determines that significant quota has been consumed, as outlined in Section 3</li>
              <li>Add-on services, one-time purchases, or usage top-ups</li>
              <li>Subscriptions cancelled after the applicable refund window</li>
              <li>Renewal charges for subscriptions not cancelled prior to the renewal date</li>
              <li>Accounts suspended or terminated for Terms of Service violations</li>
              <li>Accounts flagged for refund abuse or fraud as described in Section 6</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">8. How to Request a Refund</h2>
            <p>To submit a refund request within the eligible window:</p>
            <ol className="list-decimal list-inside space-y-2 ml-2 mt-3">
              <li>Email <a href="mailto:billing@usegrowthforge.com" className="text-[#00E676]">billing@usegrowthforge.com</a> with the subject line: <strong className="text-white">"Refund Request — [Your Account Email]"</strong></li>
              <li>Include your account email address, subscription plan, date of charge, and a brief reason for the request</li>
              <li>Our team will conduct a usage review within 2 business days and respond with a determination</li>
              <li>Approved refunds are processed within 5–10 business days to the original payment method</li>
            </ol>
            <p className="mt-3">Refund requests submitted via social media, community forums, or any channel other than the billing email above will not be considered or processed.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">9. Governing Terms</h2>
            <p>This Refund Policy is incorporated into and governed by GrowthForge's <Link href="/terms" className="text-[#00E676]">Terms of Service</Link>. In the event of any conflict between this policy and the Terms of Service, the Terms of Service shall prevail. Strapli Technologies Inc. reserves the right to amend this policy at any time with or without notice. Continued use of the platform following any amendment constitutes your acceptance of the revised policy.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">10. Contact</h2>
            <div className="mt-3 p-4 rounded-xl border border-white/8 bg-white/3">
              <p>For all billing questions and refund requests:</p>
              <p className="mt-2"><strong className="text-white">Email:</strong> <a href="mailto:billing@usegrowthforge.com" className="text-[#00E676]">billing@usegrowthforge.com</a></p>
              <p><strong className="text-white">Response time:</strong> Within 2 business days</p>
              <p className="mt-2 text-white/40 text-sm">Please do not initiate a payment dispute before contacting us. Our team resolves billing issues promptly and filing a chargeback without prior contact will be treated as abuse under Section 6.</p>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
