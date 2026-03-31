import Vue from 'vue';
import VueRouter from 'vue-router';

Vue.use(VueRouter);

const Home = () => import(/* webpackChunkName: "view-home" */ '@/views/Home.vue');
const Ocr = () => import(/* webpackChunkName: "view-ocr" */ '@/views/Ocr.vue');
const Device = () => import(/* webpackChunkName: "view-device" */ '@/views/Device.vue');
const Markdown = () => import(/* webpackChunkName: "view-markdown" */ '@/views/Markdown.vue');

const router = new VueRouter({
    routes: [
        {
            path: '/',
            component: Home,
            meta: {
                keepAlive: true,
            },
        },
        {
            path: '/ocr',
            component: Ocr,
            meta: {
                keepAlive: true,
            },
        },
        {
            path: '/markdown',
            component: Markdown,
        },
        {
            path: '/device',
            component: Device,
            meta: {
                keepAlive: true,
            },
        },
    ],
});

export default router;
