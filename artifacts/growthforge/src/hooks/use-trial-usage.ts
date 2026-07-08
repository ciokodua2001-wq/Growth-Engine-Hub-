import { useState, useEffect, useCallback } from "react";

export interface TrialUsage {
  analyses: number;
  competitors: number;
  strategies: number;
  socialPosts: number;
  emailCampaigns: number;
  videoBlueprints: number;
  agentMessages: number;
  limits: {
    analyses: number;
    competitors: number;
    strategies: number;
    socialPosts: number;
    emailCampaigns: number;
    videoBlueprints: number;
    agentMessages: number;
  };
}

export const TRIAL_LIMITS = {
  analyses: 1,
  competitors: 2,
  strategies: 1,
  socialPosts: 5,
  emailCampaigns: 1,
  videoBlueprints: 1,
  agentMessages: 10,
};

export function useTrialUsage(projectId: number | null) {
  const [usage, setUsage] = useState<TrialUsage | null>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    fetch(`/api/trial/usage/${projectId}`)
      .then((r) => r.json())
      .then((data) => setUsage(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { usage, loading, refetch };
}
