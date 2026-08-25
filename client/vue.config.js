module.exports = {
    outputDir: 'dist',
    publicPath: '',
    integrity: true,
    transpileDependencies: [
        'vuetify',
    ],
    pluginOptions: {
        webpackBundleAnalyzer: {
            analyzerMode: 'disabled',
            openAnalyzer: false,
        },
    },
    devServer: {
        https: true,
        port: 1210,
        proxy: {
            '/*': {
                target: 'https://localhost:8443/',
                changeOrigin: true,
                secure: false,
            },
        },
    },
    productionSourceMap: false,
}