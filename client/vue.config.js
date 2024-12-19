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
        port: 1210,
        proxy: {
            '/ocr/*': {
                target: 'https://aip.baidubce.com/',
                changeOrigin: true,
                pathRewrite: {
                    '^/ocr': ''
                }
            },
            '/*': {
                target: 'http://localhost:9501/',
                changeOrigin: true,
            },
        },
    },
    productionSourceMap: false,
}