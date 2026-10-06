import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Pin the workspace root to this directory.
   *
   * Without this, Next infers the root by walking up looking for a lockfile
   * and found `C:\Users\DC\pnpm-lock.yaml` -- a file belonging to something
   * else entirely -- so it treated the user's home directory as the project
   * root. That pulls the whole profile into the module graph and the dev
   * server's watch set, which is slow at best and can serve the wrong
   * files at worst.
   *
   * Set explicitly because this project has no root lockfile of its own
   * above it by the time it is cloned.
   */
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
