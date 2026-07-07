import { Link } from "wouter";
import { Zap, ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
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
          <h1 className="text-4xl font-black text-white mb-3">Privacy Policy</h1>
          <p className="text-white/40 text-sm">Last updated: July 7, 2026 · Strapli Technologies Inc.</p>
        </div>

        <div className="prose prose-invert max-w-none space-y-8 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-xl font-bold text-white mb-3">1. Introduction</h2>
            <p>Strapli Technologies Inc. ("we," "our," or "us") operates GrowthForge at UseGrowthForge.com (the "Service"). This Privacy Policy explains how we collect, use, disclose, and protect your information when you use our Service.</p>
            <p className="mt-3">By using GrowthForge, you agree to the collection and use of information in accordance with this policy.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">2. Information We Collect</h2>
            <h3 className="text-base font-semibold text-white/80 mb-2">2.1 Information You Provide</h3>
            <ul className="list-disc list-inside space-y-1.5 ml-2">
              <li>Account information: name, email address, password</li>
              <li>Business information: website URL, company name, industry</li>
              <li>Payment information (processed securely by our payment processor)</li>
              <li>Communications: emails, support tickets, feedback</li>
            </ul>
            <h3 className="text-base font-semibold text-white/80 mb-2 mt-4">2.2 Information Collected Automatically</h3>
            <ul className="list-disc list-inside space-y-1.5 ml-2">
              <li>Usage data: features used, pages visited, actions taken</li>
              <li>Device information: browser type, operating system, IP address</li>
              <li>Cookies and similar tracking technologies</li>
              <li>Log data: access times, error logs, performance data</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">3. How We Use Your Information</h2>
            <p>We use the information we collect to:</p>
            <ul className="list-disc list-inside space-y-1.5 ml-2 mt-3">
              <li>Provide, maintain, and improve the GrowthForge Service</li>
              <li>Process transactions and send related information</li>
              <li>Send service-related communications and updates</li>
              <li>Respond to your comments, questions, and support requests</li>
              <li>Monitor and analyze usage patterns to improve user experience</li>
              <li>Detect and prevent fraudulent or unauthorized activity</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">4. Data Sharing and Disclosure</h2>
            <p>We do not sell your personal information. We may share your information with:</p>
            <ul className="list-disc list-inside space-y-1.5 ml-2 mt-3">
              <li><strong className="text-white">Service Providers:</strong> Third-party vendors who assist in operating the Service (hosting, analytics, customer support)</li>
              <li><strong className="text-white">Legal Requirements:</strong> When required by law or to protect our legal rights</li>
              <li><strong className="text-white">Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">5. Data Retention</h2>
            <p>We retain your personal information for as long as necessary to provide the Service, comply with legal obligations, resolve disputes, and enforce our agreements. You may request deletion of your account and associated data at any time by contacting us.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">6. Your Rights</h2>
            <p>Depending on your location, you may have the following rights:</p>
            <ul className="list-disc list-inside space-y-1.5 ml-2 mt-3">
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Object to or restrict processing</li>
              <li>Data portability</li>
              <li>Withdraw consent</li>
            </ul>
            <p className="mt-3">To exercise these rights, contact us at <a href="mailto:privacy@usegrowthforge.com" className="text-[#00E676]">privacy@usegrowthforge.com</a>.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">7. Security</h2>
            <p>We implement industry-standard security measures to protect your information. However, no method of transmission over the internet or electronic storage is 100% secure. We cannot guarantee absolute security.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">8. Cookies</h2>
            <p>We use cookies and similar tracking technologies to track activity on our Service. You can instruct your browser to refuse all cookies or indicate when a cookie is being sent. However, some features of the Service may not function properly without cookies.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">9. Children's Privacy</h2>
            <p>GrowthForge is not directed to individuals under 18 years of age. We do not knowingly collect personal information from children. If we discover that a child has provided us with personal information, we will delete it immediately.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">10. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the "Last updated" date. Continued use of the Service after changes constitutes acceptance of the updated policy.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-3">11. Contact Us</h2>
            <p>If you have questions about this Privacy Policy, please contact us:</p>
            <div className="mt-3 p-4 rounded-xl border border-white/8 bg-white/3">
              <p><strong className="text-white">Strapli Technologies Inc.</strong></p>
              <p>Email: <a href="mailto:privacy@usegrowthforge.com" className="text-[#00E676]">privacy@usegrowthforge.com</a></p>
              <p>Website: <a href="https://usegrowthforge.com" className="text-[#00E676]">usegrowthforge.com</a></p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
