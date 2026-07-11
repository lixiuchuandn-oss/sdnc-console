import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src'),
		},
	},
	server: {
		host: true,
		port: 5173,
		strictPort: true,
		proxy: {
			'/api': {
				target: process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:3000',
				changeOrigin: true,
			},
		},
	},
});
