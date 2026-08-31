import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // The WASM runtime lives under a content-hashed directory and the
        // model bundle has its hash in the filename, so both are safe to cache
        // for a year. An upgrade changes the path, not the contents at a path.
        // This matters more than it looks: the runtime is 11 MB and the model
        // is 3.6 MB, and some of the people this is for are on slow
        // connections in a clinic or a school.
        source: "/:dir(mediapipe|models)/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
