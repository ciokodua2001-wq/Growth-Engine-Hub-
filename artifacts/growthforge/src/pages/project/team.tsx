import { useParams } from "wouter";
import { useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { Loader2, Users, UserPlus, Mail, Trash2, Crown, Clock, CheckCircle2, XCircle, Send, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useCallback } from "react";

type TeamMember = {
  id: number;
  email: string;
  role: "member" | "admin";
  status: "pending" | "active" | "revoked";
  invitedAt: string;
  acceptedAt: string | null;
  userId: string | null;
};

function StatusBadge({ status }: { status: TeamMember["status"] }) {
  if (status === "active") return (
    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
      <CheckCircle2 className="h-2.5 w-2.5" /> Active
    </span>
  );
  if (status === "pending") return (
    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
      <Clock className="h-2.5 w-2.5" /> Pending
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
      <XCircle className="h-2.5 w-2.5" /> Revoked
    </span>
  );
}

export default function ProjectTeam() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const { data: project, isLoading: projectLoading } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId), enabled: !!projectId } });
  const { toast } = useToast();

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const isAgency = project?.plan === "agency";

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/team`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMembers(false);
    }
  }, [projectId]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/team/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Invitation sent!", description: data.message });
        setInviteEmail("");
        fetchMembers();
      } else {
        toast({ title: data.error ?? "Failed to send invite", variant: "destructive" });
      }
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (memberId: number, email: string) => {
    setRemoving(memberId);
    try {
      const res = await fetch(`/api/projects/${projectId}/team/${memberId}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Member removed", description: `${email} no longer has access.` });
        fetchMembers();
      } else {
        const data = await res.json();
        toast({ title: data.error ?? "Failed to remove member", variant: "destructive" });
      }
    } finally {
      setRemoving(null);
    }
  };

  if (projectLoading || loadingMembers) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const activeMembers = members.filter(m => m.status === "active");
  const pendingMembers = members.filter(m => m.status === "pending");
  const revokedMembers = members.filter(m => m.status === "revoked");

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight flex items-center gap-2">
          <Users className="h-7 w-7 text-muted-foreground" /> Team Members
        </h1>
        <p className="text-muted-foreground mt-1">Invite collaborators to access this project</p>
      </div>

      {!isAgency ? (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="p-6 rounded-xl border border-amber-500/20 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <div className="font-bold text-amber-300 mb-1">Agency Plan Required</div>
              <p className="text-sm text-amber-300/70">Team Members is an Agency plan feature. Upgrade to invite collaborators to your projects.</p>
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="space-y-6">
          {/* Invite form */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="p-6 rounded-xl bg-card border border-border">
            <h2 className="font-bold mb-4 flex items-center gap-2"><UserPlus className="h-4 w-4 text-primary" /> Invite a team member</h2>
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    required
                    className="w-full bg-secondary border border-border rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                  />
                </div>
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as "member" | "admin")}
                  className="bg-secondary border border-border rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={inviting || !inviteEmail.trim()}
                  className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
                >
                  {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send Invite
                </button>
              </div>
            </form>
            <div className="mt-4 text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2 space-y-0.5">
              <div><strong>Member</strong> — can view and generate content, cannot manage team or billing.</div>
              <div><strong>Admin</strong> — same as Member plus can view project settings.</div>
            </div>
          </motion.div>

          {/* Active members */}
          {activeMembers.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="p-6 rounded-xl bg-card border border-border">
              <h2 className="font-bold mb-4 flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-400" /> Active Members</h2>
              <div className="space-y-2">
                {activeMembers.map(m => (
                  <div key={m.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary">{m.email[0].toUpperCase()}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{m.email}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {m.role === "admin" ? <Crown className="h-2.5 w-2.5 text-amber-400" /> : null}
                          <span className="text-xs text-muted-foreground capitalize">{m.role}</span>
                          <StatusBadge status={m.status} />
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemove(m.id, m.email)}
                      disabled={removing === m.id}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                      title="Remove member"
                    >
                      {removing === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Pending invites */}
          {pendingMembers.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="p-6 rounded-xl bg-card border border-border">
              <h2 className="font-bold mb-4 flex items-center gap-2"><Clock className="h-4 w-4 text-amber-400" /> Pending Invitations</h2>
              <div className="space-y-2">
                {pendingMembers.map(m => (
                  <div key={m.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                        <Clock className="h-3.5 w-3.5 text-amber-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{m.email}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs text-muted-foreground capitalize">{m.role}</span>
                          <StatusBadge status={m.status} />
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemove(m.id, m.email)}
                      disabled={removing === m.id}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                      title="Revoke invite"
                    >
                      {removing === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeMembers.length === 0 && pendingMembers.length === 0 && revokedMembers.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No team members yet. Invite someone above to get started.</p>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
