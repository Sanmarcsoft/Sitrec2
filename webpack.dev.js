const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const InstallPaths = require('./config/config-install');
const CircularDependencyPlugin = require('circular-dependency-plugin');
const { createProxyMiddleware } = require('http-proxy-middleware');

// Port for the backend server (nginx/Apache with PHP)
// Default 8081 for compatibility with Docker dev setup
const BACKEND_PORT = process.env.SITREC_BACKEND_PORT || 8081;
const BACKEND_TARGET = `http://localhost:${BACKEND_PORT}`;

module.exports = merge(common({ includeIWER: true }), {
    mode: 'development',
    devtool: 'eval-cheap-module-source-map', // Much faster than inline-source-map, especially on Windows
    devServer: {
        static: {
            directory: InstallPaths.dev_path,
            publicPath: '/sitrec', // Public path to access the static files
        },
        hot: true, // Hot reload enabled - "Reload site" dialog is handled in index.js via HMR detection
        open: false, // Don't auto-open browser
        host: '0.0.0.0', // Allow external connections
        port: process.env.SITREC_PORT || process.env.PORT || 3000,
        // File watching for local development
        watchFiles: {
            options: {
                aggregateTimeout: 300, // Wait 300ms after change before rebuilding
            },
        },
        historyApiFallback: {
            rewrites: [
                // Don't rewrite API requests
                { from: /^\/sitrecServer/, to: context => context.parsedUrl.pathname },
                { from: /^\/sitrec-videos/, to: context => context.parsedUrl.pathname },
                { from: /^\/sitrec-cache/, to: context => context.parsedUrl.pathname },
                { from: /^\/sitrec-terrain/, to: context => context.parsedUrl.pathname },
                { from: /^\/sam2/, to: context => context.parsedUrl.pathname },
            ]
        },
        allowedHosts: 'all',
        // Insert PHP proxy BEFORE static file serving to prevent raw PHP being served
        setupMiddlewares: (middlewares, devServer) => {
            // Create proxy middleware for PHP paths
            const phpProxy = createProxyMiddleware({
                target: BACKEND_TARGET,
                changeOrigin: true,
                secure: false,
            });

            // Insert at the very beginning - before static middleware
            middlewares.unshift({
                name: 'php-proxy',
                middleware: (req, res, next) => {
                    if (req.url.startsWith('/sitrecServer')) {
                        return phpProxy(req, res, next);
                    }
                    next();
                }
            });
            return middlewares;
        },
        proxy: [
            {
                context: ['/sitrecServer/**'], // paths to proxy - use ** to match all subpaths
                target: BACKEND_TARGET, // Proxy to Apache/nginx
                changeOrigin: true,
                secure: false,
                logLevel: 'debug',
            },
            {
                context: ['/sitrec-videos'],
                target: BACKEND_TARGET,
                changeOrigin: true,
                secure: false,
            },
            {
                context: ['/sitrec-cache'],
                target: BACKEND_TARGET,
                changeOrigin: true,
                secure: false,
            },
            {
                context: ['/sitrec-terrain/**'],
                target: BACKEND_TARGET,
                changeOrigin: true,
                secure: false,
            },
            {
                context: ['/sam2/**'],
                target: `http://127.0.0.1:${process.env.SAM2_PORT || 8001}`,
                changeOrigin: true,
                pathRewrite: { '^/sam2': '' },
                timeout: 300000,
            },
        ],
    },
    cache: false, // CRITICAL: Disable webpack caching for local development to ensure clean rebuilds
    plugins: [
        new CircularDependencyPlugin({
            exclude: /node_modules/,
            include: /src/,
            // `onDetected` is called for each module that is cyclical
            onDetected({ module: webpackModuleRecord, paths, compilation }) {
                const ignoreModules = ["mathjs"];
                // return if any of the ignoreModules is a substring of any of the paths
                if (paths.some(path => ignoreModules.some(ignoreModule => path.includes(ignoreModule)))) {
                    return;
                }
                // `paths` will be an Array of the relative module paths that make up the cycle
                compilation.errors.push(new Error(paths.join(' -> ')))
            },
        }),
    ],
});
