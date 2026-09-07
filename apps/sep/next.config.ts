import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['bullmq', 'ioredis', 'imapflow', 'nodemailer', 'mailparser'],
  typedRoutes: false,
};

export default nextConfig;
