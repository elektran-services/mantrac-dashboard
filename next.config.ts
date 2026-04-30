import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import path from "path";

// Production VPS often has no committed env file unless you create one on the server.
// Next.js reads env files automatically, but explicitly loading here guarantees SMTP/monitor
// vars exist when only `.env.local` or `.env.production` is present in the app directory.
loadEnv({ path: path.resolve(process.cwd(), ".env.production") });
loadEnv({ path: path.resolve(process.cwd(), ".env.local"), override: true });

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
