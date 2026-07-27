export interface ZStudentProfile {
  userId: string;
  country: string | null;
  province: string | null;
  grade: string | null;
  plan: "free" | "paid";
  monthlyLimit: number | null;
  questionsUsedThisSession: number;
  questionsUsedThisMonth: number;
  lastResetAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface ZQuota {
  plan: "free" | "paid";
  used: number;
  limit: number;
  remaining: number;
  resetAt: string | null;
}

export interface ZSession {
  id: string;
  userId: string;
  subject: string;
  lesson: string;
  unit: string;
  messageCount: number;
  createdAt: string;
}

export interface ZMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  audioUrl: string | null;
  createdAt: string;
}

export interface ZSessionWithMessages extends ZSession {
  messages: ZMessage[];
}
