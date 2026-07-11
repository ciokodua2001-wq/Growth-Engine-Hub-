import { useState, useRef } from "react";
import { useParams } from "wouter";
import {
  useListEmails,
  useGenerateEmails,
  useSendEmail,
  useGetProject,
  useGetEmailSendConfig,
  getListEmailsQueryKey,
} from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Zap, ChevronDown, ChevronUp, Send, X, Upload, CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
import GenerateModal from "@/components/ui/generate-modal";

const emailTypes = ["welcome", "sales", "nurture", "reactivation"];

const typeColors: Record<string, string> = {
  welcome: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  sales: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  nurture: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  reactivation: "bg-orange-500/15 text-orange-400 border-orange-500/20",
};

const EMAIL_STEPS = [
  "Analyzing subscriber journey...",
  "Writing subject lines...",
  "Crafting email sequences...",
  "Personalizing for your audience...",
  "Optimizing for deliverability...",
];

function parseRecipients(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map(e => e.trim())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

interface SendModalProps {
  emailId: number;
  projectId: number;
  subject: string;
  onClose: () => void;
  onSent: (sentCount: number, failCount: number) => void;
  onSendError: (failCount: number) => void;
}

function SendModal({ emailId, projectId, subject, onClose, onSent, onSendError }: SendModalProps) {
  const [raw, setRaw] = useState("");
  const [csvError, setCsvError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sendEmail = useSendEmail();
  const { data: sendConfig, isLoading: configLoading } = useGetEmailSendConfig(projectId);

  const recipients = parseRecipients(raw);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCsvError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv") && !file.name.endsWith(".txt")) {
      setCsvError("Please upload a .csv or .txt file");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRaw(prev => prev ? prev + "\n" + text : text);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSend = () => {
    if (recipients.length === 0) return;
    sendEmail.mutate(
      { id: projectId, emailId, data: { recipients } },
      {
        onSuccess: (data) => {
          onSent(data.sentCount ?? recipients.length, data.failCount ?? 0);
          onClose();
        },
        onError: () => {
          // Modal stays open showing the inline error banner; parent shows error toast
          onSendError(recipients.length);
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl"
      >
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-lg font-bold">Send Campaign</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">"{subject}"</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {configLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !sendConfig?.configured ? (
          /* Setup-required screen — shown when RESEND_API_KEY is not configured */
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4">
              <AlertTriangle className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-yellow-300 mb-1">Email sending not configured</p>
                <p className="text-xs text-muted-foreground">
                  A <span className="font-mono text-foreground">RESEND_API_KEY</span> secret is required to send campaigns.
                  Add it in the Replit Secrets panel, then refresh this page.
                </p>
              </div>
            </div>
            <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
              <li>Create a free account at <span className="text-foreground font-medium">resend.com</span></li>
              <li>Generate an API key and copy it</li>
              <li>Open Replit Secrets and add <span className="font-mono text-foreground">RESEND_API_KEY</span></li>
              <li>Verify <span className="font-mono text-foreground">marketing@usegrowthforge.com</span> in Resend</li>
              <li>Refresh and try again</li>
            </ol>
            <div className="flex justify-end pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-sm font-semibold mb-2 block">Recipients</label>
                <textarea
                  value={raw}
                  onChange={e => setRaw(e.target.value)}
                  placeholder="Paste email addresses separated by commas, semicolons, or newlines&#10;&#10;john@example.com&#10;jane@company.com"
                  rows={6}
                  className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none font-mono"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground border border-border hover:border-primary/50 rounded-lg px-3 py-2 transition-colors"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload CSV / TXT
                </button>
                <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} className="hidden" />
                {csvError && <p className="text-xs text-red-400">{csvError}</p>}
              </div>

              {recipients.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>{recipients.length} valid recipient{recipients.length !== 1 ? "s" : ""} ready to send</span>
                </div>
              )}

              {sendEmail.isError && (
                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>Send failed. Check that {sendConfig.fromAddress} is verified in your Resend dashboard.</span>
                </div>
              )}

              <div className="text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2">
                Sends from <span className="text-foreground font-mono">{sendConfig.fromAddress}</span>. Make sure this address is verified in your Resend dashboard before sending.
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 pb-6">
              <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={recipients.length === 0 || sendEmail.isPending}
                className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground font-bold px-5 py-2 rounded-xl text-sm transition-colors"
              >
                {sendEmail.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sendEmail.isPending ? "Sending..." : `Send to ${recipients.length || "?"} recipient${recipients.length !== 1 ? "s" : ""}`}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

interface Toast {
  id: number;
  type: "success" | "warning" | "error";
  message: string;
}

export default function ProjectEmail() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [selectedType, setSelectedType] = useState("welcome");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [sendingEmail, setSendingEmail] = useState<{ id: number; subject: string } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: emails, isLoading } = useListEmails(projectId, { query: { enabled: !!projectId } });
  const generateEmails = useGenerateEmails();
  const queryClient = useQueryClient();

  const showToast = (type: Toast["type"], message: string) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };

  const handleSubmit = (_websiteUrl: string, _instructions: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      generateEmails.mutate(
        { id: projectId, data: { type: selectedType } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListEmailsQueryKey(projectId) });
            resolve();
          },
          onError: reject,
        }
      );
    });
  };

  const handleSent = (sentCount: number, failCount: number) => {
    queryClient.invalidateQueries({ queryKey: getListEmailsQueryKey(projectId) });
    if (failCount === 0) {
      showToast("success", `Campaign sent to ${sentCount} recipient${sentCount !== 1 ? "s" : ""} successfully.`);
    } else {
      showToast("warning", `Sent to ${sentCount} recipient${sentCount !== 1 ? "s" : ""}. ${failCount} failed — check your Resend dashboard.`);
    }
  };

  const handleSendError = (failCount: number) => {
    showToast("error", `Send failed — all ${failCount} recipient${failCount !== 1 ? "s" : ""} could not be reached. Verify marketing@usegrowthforge.com is verified in Resend.`);
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Email Marketing</h1>
          <p className="text-muted-foreground mt-1">AI-generated email campaigns optimized for every stage of your funnel</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {emailTypes.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)} Sequence</option>)}
          </select>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            <Zap className="h-4 w-4" />
            Generate Email
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : emails && emails.length > 0 ? (
        <div className="space-y-3">
          {emails.map((email, i) => (
            <motion.div
              key={email.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="rounded-xl bg-card border border-border overflow-hidden"
            >
              <div className="p-5 flex items-start gap-4">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-bold text-sm">{email.subject}</h3>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${typeColors[email.type] ?? "bg-secondary text-muted-foreground border-border"}`}>
                      {email.type}
                    </span>
                    {email.status === "sent" && (
                      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-emerald-500/15 text-emerald-400 border-emerald-500/20">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        Sent
                      </span>
                    )}
                  </div>
                  {email.previewText && <p className="text-xs text-muted-foreground mb-3">{email.previewText}</p>}
                  <div className="flex items-center gap-6 flex-wrap">
                    {email.openRate != null && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Open Rate: </span>
                        <span className="text-emerald-400 font-bold">{email.openRate}%</span>
                      </div>
                    )}
                    {email.clickRate != null && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Click Rate: </span>
                        <span className="text-cyan-400 font-bold">{email.clickRate}%</span>
                      </div>
                    )}
                    {email.status === "sent" && email.recipientCount != null && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Recipients: </span>
                        <span className="text-foreground font-bold">{email.recipientCount.toLocaleString()}</span>
                      </div>
                    )}
                    {email.status === "sent" && email.sentAt && (
                      <div className="text-xs text-muted-foreground">
                        Sent {new Date(email.sentAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {email.status === "sent" ? (
                    <button
                      disabled
                      className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold px-3 py-1.5 rounded-lg text-xs opacity-70 cursor-not-allowed"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Sent ✓
                    </button>
                  ) : (
                    <button
                      onClick={() => setSendingEmail({ id: email.id, subject: email.subject })}
                      className="flex items-center gap-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 font-bold px-3 py-1.5 rounded-lg text-xs transition-colors"
                    >
                      <Send className="h-3 w-3" />
                      Send
                    </button>
                  )}
                  <button
                    onClick={() => setExpandedId(expandedId === email.id ? null : email.id)}
                    className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {expandedId === email.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {expandedId === email.id && email.body && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="border-t border-border px-5 py-4"
                >
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed font-sans max-h-80 overflow-y-auto">{email.body}</pre>
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <Mail className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">No Email Campaigns Yet</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">Generate welcome sequences, sales emails, nurture campaigns, and reactivation flows.</p>
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl">
            <Zap className="h-4 w-4" /> Generate Email Campaign
          </button>
        </div>
      )}

      <GenerateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Generate ${selectedType.charAt(0).toUpperCase() + selectedType.slice(1)} Email Sequence`}
        subtitle="AI will write a high-converting multi-email campaign for your funnel"
        defaultWebsiteUrl={project?.websiteUrl ?? ""}
        instructionsPlaceholder={`Examples:\n• Focus on onboarding new users\n• Target enterprise decision makers\n• Emphasize ROI and case studies\n• Use conversational tone`}
        processingSteps={EMAIL_STEPS}
        onSubmit={handleSubmit}
        ctaLabel="Generate Campaign"
      />

      <AnimatePresence>
        {sendingEmail && (
          <SendModal
            emailId={sendingEmail.id}
            projectId={projectId}
            subject={sendingEmail.subject}
            onClose={() => setSendingEmail(null)}
            onSent={handleSent}
            onSendError={handleSendError}
          />
        )}
      </AnimatePresence>

      {/* Toast notifications */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border text-sm font-medium max-w-sm pointer-events-auto ${
                toast.type === "success"
                  ? "bg-emerald-950 border-emerald-500/30 text-emerald-300"
                  : toast.type === "warning"
                  ? "bg-yellow-950 border-yellow-500/30 text-yellow-300"
                  : "bg-red-950 border-red-500/30 text-red-300"
              }`}
            >
              {toast.type === "success" && <CheckCircle2 className="h-4 w-4 shrink-0" />}
              {toast.type === "warning" && <AlertTriangle className="h-4 w-4 shrink-0" />}
              {toast.type === "error" && <AlertCircle className="h-4 w-4 shrink-0" />}
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
