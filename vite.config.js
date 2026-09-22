import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    loader: "tsx",
    include: /\.[jt]sx?$/,
  },
});
