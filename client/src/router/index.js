import Vue from 'vue';
import VueRouter from 'vue-router';
import Home from '@/views/HeHome.vue';
import Device from '@/views/Device.vue';
import About from '@/views/About.vue';
import OCR from '@/views/OcrConverter.vue';
import CloudApp from "@/views/CloudApp.vue";
import Test from "@/views/Test.vue";

Vue.use(VueRouter);

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
            path: '/cloud-cp',
            component: CloudApp,
            meta: {
                keepAlive: true,
            },
        },
        {
            path: '/cloud-cp/device',
            component: Device,
            meta: {
                keepAlive: true,
            },
        },
        {
            path: '/cloud-cp/about',
            component: About,
            meta: {
                keepAlive: true,
            },
        },
        {
            path: '/ocr',
            component: OCR,
            meta: {
                keepAlive: true,
            },
        },
        {
            path: '/test',
            component: Test,
            meta: {
                keepAlive: true,
            },
        },
    ],
});

export default router;
