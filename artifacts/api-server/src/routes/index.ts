import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import analysisRouter from "./analysis";
import competitorsRouter from "./competitors";
import contentRouter from "./content";
import videosRouter from "./videos";
import campaignsRouter from "./campaigns";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(analysisRouter);
router.use(competitorsRouter);
router.use(contentRouter);
router.use(videosRouter);
router.use(campaignsRouter);

export default router;
