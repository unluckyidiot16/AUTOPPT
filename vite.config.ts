// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    base: "/AUTOPPT/", // <= 레포 이름
    server: {
        host: true,
        port: 5173,
    },
});
