import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Desactivar el header X-Powered-By
  poweredByHeader: false,

  // Imágenes desde Supabase Storage
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
