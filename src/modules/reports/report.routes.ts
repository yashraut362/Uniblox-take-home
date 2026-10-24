import { Router } from "express";
import * as reportService from "./report.service.js";

export const reportRouter = Router();

reportRouter.get("/admin/report", async (_req, res) => {
  res.json(await reportService.getReport());
});
