import express from "express";
import { prisma } from "./db.js";

export const app = express();

app.use(express.json());

app.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok", db: "ok" });
});
