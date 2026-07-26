import { useState, useRef } from "react";
import { useParams } from "wouter";
import {
  useListEmails,
  useGenerateEmails,
  useSendEmail,
  useGetProject,
  useGetEmailSendConfig,
  getGetProjectQueryKey,
  getListEmailsQueryKey,
} from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Zap, ChevronDown, ChevronUp, Send, X, Upload, CheckCircle2, AlertCircle, AlertTriangle, Clock } from "lucide-react";
import GenerateModal from "@/components/ui/generate-modal";
import { useCurrentUser } from "@/hooks/use-current-user";

const emailTypes = ["welcome", "sales", "nurture", "reactivation"];

interface EmailScheduleControlsProps {
  emailId: number;
  projectId: number;
  status: string;
  scheduledAt: string | null | undefined;
  canSchedule: boolean;
  onScheduleChange: () => void;
  onError: (msg: string) => void;
}

function EmailScheduleControls({ emailId, projectId, status, scheduledAt, canSchedule, onScheduleChange, onError }: EmailScheduleControlsProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [selectedDateTime, setSelectedDateTime] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const queryClient = useQueryClient();

  if (status === "sent" || !canSchedule) return null;

  const handleSchedule = async () => {
    if (!selectedDateTime) return;
    setIsLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/emails/${emailId}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scheduledAt: new Date(selectedDateTime).toISOString() }),
      });
      if (!r.ok) {
        const d = await r.json() as { error?: string };
        onError(d.error ?? "Failed to schedule email");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: getListEmailsQueryKey(projectId) });
      setShowPicker(false);
      onScheduleChange();
    } catch {
      onError("Failed to schedule email. Try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnschedule = async () => {
    setIsLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/emails/${emailId}/schedule`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) {
        const d = await r.json() as { error?: string };
        onError(d.error ?? "Failed to unschedule email");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: getListEmailsQueryKey(projectId) });
      onScheduleChange();
    } catch {
      onError("Failed to unschedule. Try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (scheduledAt) {
    return (
      <div className="flex items-center gap-2 flex-wrap px-5 pb-3 pt-1 border-t border-border/50 bg-cyan-500/5">
        <div className="flex items-center gap-1.5 text-xs text-cyan-400">
          <Clock className="h-3 w-3" />
          <span>Send reminder at {new Date(scheduledAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
        </div>
        <button
          onClick={handleUnschedule}
          disabled={isLoading}
          className="text-[10px] text-muted-foreground hover:text-red-400 underline underline-offset-2 transition-colors disabled:opacity-50 ml-auto"
        >
          {isLoading ? "Removing…" : "Remove"}
        </button>
      </div>
    );
  }

  return (
    <div className="px-5 pb-3 pt-2 border-t border-border/40">
      {showPicker ? (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="datetime-local"
            value={selectedDateTime}
            onChange={e => setSelectedDateTime(e.target.value)}
            min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
            className="text-xs bg-secondary border border-border rounded-lg px-2 py-1 text-foreground [color-scheme:dark] focus:outline-none focus:border-primary/40"
          />
          <button
            onClick={handleSchedule}
            disabled={!selectedDateTime || isLoading}
            className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/25 disabled:opacity-50 transition-colors"
          >
            {isLoading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Clock className="h-2.5 w-2.5" />}
            Set Reminder
          </button>
          <button onClick={() => setShowPicker(false)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => { setSelectedDateTime(""); setShowPicker(true); }}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-cyan-400 border border-border/50 hover:border-cyan-500/20 px-2.5 py-1 rounded-lg transition-colors"
        >
          <Clock className="h-2.5 w-2.5" /> Schedule send reminder
        </button>
      )}
    </div>
  );
}

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

interface Recipient {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parse either:
 *  - plain email list  (one per line, or comma/semicolon separated)
 *  - CSV with header   (email,first_name,last_name,company)
 */
function parseCsvRecipients(raw: string): Recipient[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Detect multi-column CSV: any line with a comma that isn't a bare email
  const hasMultiColumns = lines.some(l => l.includes(",") && !EMAIL_RE.test(l.trim()));

  if (hasMultiColumns) {
    // Find header row: first line containing "email" or "name"
    const firstLower = lines[0].toLowerCase();
    const hasHeader  = firstLower.includes("email") || firstLower.includes("first") || firstLower.includes("name");
    const headerRow  = hasHeader ? lines[0] : null;

    const parsedHeaders = headerRow
      ? headerRow.split(",").map(h => h.trim().toLowerCase().replace(/^["']|["']$/g, ""))
      : ["email", "first_name"];

    const idx = (keys: string[]) => parsedHeaders.findIndex(h => keys.some(k => h.includes(k)));
    const emailIdx   = idx(["email"]);
    const firstIdx   = idx(["first_name", "firstname", "first"]);
    const lastIdx    = idx(["last_name", "lastname", "last"]);
    const companyIdx = idx(["company", "org", "business"]);

    const dataLines = hasHeader ? lines.slice(1) : lines;
    return dataLines.flatMap(line => {
      const cols = line.split(",").map(c => c.trim().replace(/^["']|["']$/g, ""));
      const rawEmail = emailIdx >= 0 ? (cols[emailIdx] ?? "") : (cols[0] ?? "");
      if (!EMAIL_RE.test(rawEmail)) return [];
      return [{
        email:     rawEmail,
        firstName: firstIdx   >= 0 ? (cols[firstIdx]   || undefined) : undefined,
        lastName:  lastIdx    >= 0 ? (cols[lastIdx]     || undefined) : undefined,
        company:   companyIdx >= 0 ? (cols[companyIdx]  || undefined) : undefined,
      }];
    });
  }

  // Plain email list — split on newlines, commas, or semicolons
  return trimmed
    .split(/[\n,;]+/)
    .map(e => e.trim())
    .filter(e => EMAIL_RE.test(e))
    .map(email => ({ email }));
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

  const recipients = parseCsvRecipients(raw);
  const namedCount  = recipients.filter(r => r.firstName).length;
  const isPersonalized = namedCount > 0;

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
              <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Close</button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-6 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold">Recipients</label>
                  <span className="text-[10px] text-muted-foreground">Supports plain emails or CSV with headers</span>
                </div>
                <textarea
                  value={raw}
                  onChange={e => setRaw(e.target.value)}
                  placeholder={"Plain list:\njohn@example.com\njane@company.com\n\nOr CSV with names (enables {{first_name}} personalisation):\nemail,first_name,last_name,company\njohn@example.com,John,Smith,Acme"}
                  rows={7}
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
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>{recipients.length} valid recipient{recipients.length !== 1 ? "s" : ""} ready to send</span>
                  </div>
                  {isPersonalized ? (
                    <div className="flex items-center gap-2 text-xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-3 py-2">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>{namedCount} of {recipients.length} have names — <span className="font-mono">{"{{first_name}}"}</span> will be personalised. Others get "there" as fallback.</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>No names detected. <span className="font-mono">{"{{first_name}}"}</span> will be replaced with "there". Upload a CSV with a <span className="font-mono">first_name</span> column to personalise.</span>
                    </div>
                  )}
                </div>
              )}

              {sendEmail.isError && (
                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>Send failed. Check that {sendConfig.fromAddress} is verified in your Resend dashboard.</span>
                </div>
              )}

              <div className="text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2">
                Sends from <span className="text-foreground font-mono">{sendConfig.fromAddress}</span>. Verify this address in your Resend dashboard before sending.
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

  const { data: project } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId), enabled: !!projectId } });
  const { data: emails, isLoading } = useListEmails(projectId, { query: { queryKey: getListEmailsQueryKey(projectId), enabled: !!projectId } });
  const { data: currentUserData } = useCurrentUser();
  const isOwnerUser = currentUserData?.isOwner ?? false;
  const canScheduleFeature = isOwnerUser || ["get-going", "growth", "agency"].includes(project?.plan ?? "");
  const generateEmails = useGenerateEmails();
  const queryClient = useQueryClient();

  const showToast = (type: Toast["type"], message: string) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  };

  const handleSubmit = (_websiteUrl: string, _instructions: string, locale: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      generateEmails.mutate(
        { id: projectId, data: { type: selectedType, targetLocale: locale || undefined } },
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
                    {(email as { scheduledAt?: string | null }).scheduledAt && email.status !== "sent" && (
                      <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                        <Clock className="h-2.5 w-2.5" />
                        Scheduled
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
              <EmailScheduleControls
                emailId={email.id}
                projectId={projectId}
                status={email.status}
                scheduledAt={(email as { scheduledAt?: string | null }).scheduledAt}
                canSchedule={canScheduleFeature}
                onScheduleChange={() => showToast("success", "Send reminder scheduled!")}
                onError={(msg) => showToast("error", msg)}
              />
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
        detectedLocale={project?.detectedLocale ?? undefined}
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
