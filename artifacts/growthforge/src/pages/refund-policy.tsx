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
          <p className="text-white/40 text-sm">Last updated: July 7, 2026 · Strapli Technologies Inc.</p>
        </div>

        <div className="prose prose-invert max-w-none space-y-8 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-xl font-bold text-white mb-3">1. Free Trial</h2>
            <p>GrowthForge offers a 14-day free trial with no credit card required. During the free trial, no charges are made and no refunds are applicable. You can cancel your trial at any time before it ends without any obligation.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">2. Paid Subscriptions</h2>
            <p>When paid plans become available, the following refund policy will apply:</p>
            <ul className="list-disc list-inside space-y-2 ml-2 mt-3">
              <li><strong className="text-white">7-Day Money-Back Guarantee:</strong> If you are not satisfied with your paid subscription, you may request a full refund within 7 days of your first payment.</li>
              <li><strong className="text-white">After 7 Days:</strong> Refunds are not available after the 7-day window. Subscriptions may be cancelled at any time, and access will continue until the end of the current billing period.</li>
              <li><strong className="text-white">Annual Plans:</strong> Annual subscriptions may be refunded within 30 days of purchase if the Service has not been significantly used (fewer than 3 active projects or analyses).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">3. Cancellation</h2>
            <p>You may cancel your subscription at any time from your account settings. Cancellation takes effect at the end of the current billing period. You will not be charged for subsequent billing periods after cancellation, but no partial refunds are issued for unused time in the current period.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">4. Exceptions</h2>
            <p>We may issue refunds outside of our standard policy at our sole discretion in the following circumstances:</p>
            <ul className="list-disc list-inside space-y-1.5 ml-2 mt-3">
              <li>Extended service outages (more than 24 hours of unavailability)</li>
              <li>Billing errors or duplicate charges</li>
              <li>Technical issues that prevent use of core features</li>
            </ul>
            <p className="mt-3">To report any of these issues, contact us at <a href="mailto:billing@usegrowthforge.com" className="text-[#00E676]">billing@usegrowthforge.com</a>.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">5. How to Request a Refund</h2>
            <p>To request a refund within the eligible window:</p>
            <ol className="list-decimal list-inside space-y-2 ml-2 mt-3">
              <li>Email <a href="mailto:billing@usegrowthforge.com" className="text-[#00E676]">billing@usegrowthforge.com</a> with the subject "Refund Request"</li>
              <li>Include your account email address and the reason for the refund</li>
              <li>We will process eligible refunds within 5–10 business days</li>
              <li>Refunds are issued to the original payment method</li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">6. Non-Refundable Items</h2>
            <p>The following are not eligible for refunds:</p>
            <ul className="list-disc list-inside space-y-1.5 ml-2 mt-3">
              <li>Add-on services or one-time purchases</li>
              <li>Subscriptions cancelled after the refund window</li>
              <li>Accounts suspended for Terms of Service violations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">7. Contact</h2>
            <div className="mt-3 p-4 rounded-xl border border-white/8 bg-white/3">
              <p>For billing questions and refund requests:</p>
              <p className="mt-2"><strong className="text-white">Email:</strong> <a href="mailto:billing@usegrowthforge.com" className="text-[#00E676]">billing@usegrowthforge.com</a></p>
              <p><strong className="text-white">Response time:</strong> Within 24 business hours</p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
