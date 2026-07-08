import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import projectsRouter from "./projects.js";
import analysisRouter from "./analysis.js";
import competitorsRouter from "./competitors.js";
import contentRouter from "./content.js";
import videosRouter from "./videos.js";
import campaignsRouter from "./campaigns.js";
import authRouter from "./auth.js";
import onboardingRouter from "./onboarding.js";
import trialRouter from "./trial.js";
import adminRouter from "./admin.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(onboardingRouter);
router.use(trialRouter);
router.use(projectsRouter);
router.use(analysisRouter);
router.use(competitorsRouter);
router.use(contentRouter);
router.use(videosRouter);
router.use(campaignsRouter);
router.use(adminRouter);

export default router;
