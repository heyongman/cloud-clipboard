import Vue from 'vue';
import VueRouter from 'vue-router';
import Home from '@/views/Home.vue';
import Cloud from '@/views/CloupCp.vue';
import Device from '@/views/Device.vue';
import About from '@/views/About.vue';
import OCR from '@/views/OCR.vue';

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
            component: Cloud,
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
    ],
});

export default router;
