import Vue from 'vue';
import VueRouter from 'vue-router';

Vue.use(VueRouter);

const Home = () => import(/* webpackChunkName: "view-home" */ '@/views/Home.vue');
const Ocr = () => import(/* webpackChunkName: "view-ocr" */ '@/views/Ocr.vue');
const Device = () => import(/* webpackChunkName: "view-device" */ '@/views/Device.vue');
const Markdown = () => import(/* webpackChunkName: "view-markdown" */ '@/views/Markdown.vue');
const Subscription = () => import(/* webpackChunkName: "view-subscription" */ '@/views/Subscription.vue');

const router = new VueRouter({
    routes: [
        {
            path: '/',
            component: Home,
            meta: {
                keepAlive: true,
                title: '剪贴板',
            },
        },
        {
            path: '/ocr',
            component: Ocr,
            meta: {
                keepAlive: true,
                title: '图片识别',
            },
        },
        {
            path: '/markdown',
            component: Markdown,
            meta: {
                title: 'Markdown转图片',
            },
        },
        {
            path: '/subscription',
            component: Subscription,
            meta: {
                title: '订阅转换',
            },
        },
        {
            path: '/device',
            component: Device,
            meta: {
                keepAlive: true,
                title: '设备列表',
            },
        },
    ],
});

export default router;
