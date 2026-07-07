import { useParams } from "wouter";
import {
  useListEmails,
  useGenerateEmails,
  getListEmailsQueryKey,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Zap, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

const emailTypes = ["welcome", "sales", "nurture", "reactivation"];

const typeColors: Record<string, string> = {
  welcome: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  sales: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  nurture: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  reactivation: "bg-orange-500/15 text-orange-400 border-orange-500/20",
};

export default function ProjectEmail() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [selectedType, setSelectedType] = useState("welcome");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { data: emails, isLoading } = useListEmails(projectId, { query: { enabled: !!projectId } });
  const generateEmails = useGenerateEmails();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleGenerate = () => {
    generateEmails.mutate(
      { id: projectId, data: { type: selectedType } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmailsQueryKey(projectId) });
          toast({ title: "Email campaign generated!" });
        },
        onError: () => toast({ title: "Error", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Email Marketing</h1>
          <p className="text-muted-foreground mt-1">AI-generated email campaigns optimized for every stage of your funnel</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {emailTypes.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)} Sequence</option>)}
          </select>
          <button
            onClick={handleGenerate}
            disabled={generateEmails.isPending}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            {generateEmails.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
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
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-sm">{email.subject}</h3>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${typeColors[email.type] ?? "bg-secondary text-muted-foreground border-border"}`}>
                      {email.type}
                    </span>
                  </div>
                  {email.previewText && <p className="text-xs text-muted-foreground mb-3">{email.previewText}</p>}
                  <div className="flex items-center gap-6">
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
                  </div>
                </div>
                <button
                  onClick={() => setExpandedId(expandedId === email.id ? null : email.id)}
                  className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                >
                  {expandedId === email.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
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
          <button onClick={handleGenerate} className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl">
            <Zap className="h-4 w-4" /> Generate Email Campaign
          </button>
        </div>
      )}
    </div>
  );
}
