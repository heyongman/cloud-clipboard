import Vue from 'vue';
import VueRouter from 'vue-router';
import Home from '@/views/Home.vue';
import Ocr from '@/views/Ocr.vue';
import Device from '@/views/Device.vue';

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
            path: '/ocr',
            component: Ocr,
            meta: {
                keepAlive: true,
            },
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
