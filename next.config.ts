import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The persistence layer reads fixture packages and (in local development) the
  // filesystem-backed blob store, so nothing here may be bundled for the client.
  serverExternalPackages: ['@vercel/blob'],
};

export default nextConfig;
