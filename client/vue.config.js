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
    configureWebpack: {
        // 高质量 source map，调试时 Sources 中 .vue 与源码逐字一致、行号准确
        devtool: 'source-map',
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