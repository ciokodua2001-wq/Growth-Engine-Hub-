import { useParams } from "wouter";
import {
  useGetMarketingStrategy,
  useGenerateMarketingStrategy,
  getGetMarketingStrategyQueryKey,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Megaphone, Zap, Target, MessageCircle, Globe, TrendingUp, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function StrategyCard({ title, content, icon: Icon }: { title: string; content: string | null | undefined; icon: React.ComponentType<{ className?: string }> }) {
  if (!content) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="p-6 rounded-xl bg-card border border-border">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="h-5 w-5 text-primary" />
        <h3 className="font-bold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{content}</p>
    </motion.div>
  );
}

export default function ProjectStrategy() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const { data: strategy, isLoading } = useGetMarketingStrategy(projectId, { query: { enabled: !!projectId } });
  const generateStrategy = useGenerateMarketingStrategy();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleGenerate = () => {
    generateStrategy.mutate(
      { id: projectId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMarketingStrategyQueryKey(projectId) });
          toast({ title: "Marketing strategy generated!" });
        },
        onError: () => toast({ title: "Error", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Marketing Strategy</h1>
          <p className="text-muted-foreground mt-1">AI-generated positioning, messaging, and growth strategy</p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generateStrategy.isPending}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
        >
          {generateStrategy.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {generateStrategy.isPending ? "Generating..." : "Generate Strategy"}
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : strategy ? (
        <div className="grid md:grid-cols-2 gap-5">
          <StrategyCard title="Positioning Statement" content={strategy.positioningStatement} icon={Megaphone} />
          <StrategyCard title="Messaging Framework" content={strategy.messagingFramework} icon={MessageCircle} />
          <StrategyCard title="Brand Voice Guide" content={strategy.brandVoiceGuide} icon={MessageCircle} />
          <StrategyCard title="SEO Strategy" content={strategy.seoStrategy} icon={Globe} />
          <StrategyCard title="Campaign Strategy" content={strategy.campaignStrategy} icon={Target} />
          <StrategyCard title="Lead Generation Strategy" content={strategy.leadGenerationStrategy} icon={TrendingUp} />
          <div className="md:col-span-2">
            <StrategyCard title="Funnel Recommendations" content={strategy.funnelRecommendations} icon={Filter} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <Megaphone className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">No Strategy Yet</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">Generate your AI-powered marketing strategy with positioning, messaging, and growth recommendations.</p>
          <button onClick={handleGenerate} className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl">
            <Zap className="h-4 w-4" /> Generate Strategy
          </button>
        </div>
      )}
    </div>
  );
}
