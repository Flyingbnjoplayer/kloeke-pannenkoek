/** @type {import('next').NextConfig} */
const { withSentryConfig } = require("@sentry/nextjs");

const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  images: {
    domains: ["**.vercel.ai", "**.vercel.app", "**.pinata.cloud", "**.ipfs.dweb.link"],
  },
  api: {
    externalResolver: true,
    bodyParser: {
      sizeLimit: "10mb"
    }
  },
  experimental: {
    appDir: true,
    optimizeCss: true,
    optimizeJs: true,
    scrollRestoration: "auto",
    optimizeImages: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.vercel.ai",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "**.vercel.app",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "**.pinata.cloud",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "**.ipfs.dweb.link",
        port: "",
        pathname: "/**",
      }
    ]
  },
  webpack: (config, { isServer }) => {
    // Configure Webpack for Web3 and blockchain integrations
    config.resolve.fallback = {
      fs: false,
      net: false,
      tls: false,
      crypto: require.resolve("crypto-browserify"),
    };

    // Add support for Buffer in Node.js
    config.resolve.fallback.buffer = require.resolve("buffer/");
    config.resolve.fallback["crypto"] = require.resolve("crypto-browserify");

    return config;
  }
};

if (process.env.SENTRY_DSN) {
  return withSentryConfig(nextConfig, {
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
  });
}

return nextConfig;
