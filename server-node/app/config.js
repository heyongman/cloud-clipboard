import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const defaultConfigPath = path.join(process.cwd(), 'config.json');

if (!process.argv[2] && !fs.existsSync(defaultConfigPath)) {
    console.log(`\x1b[93mConfig file "${defaultConfigPath}" does not exist.\x1b[39m`);
    console.log('\x1b[93mA default config file is created and used. Check the descriptions in the repository\'s README.md to modify it.\x1b[39m');
    fs.writeFileSync(defaultConfigPath, JSON.stringify({
        server: {
            host: [],
            port: 9501,
            uds: null,
            prefix: '',
            key: null,
            cert: null,
            history: 10,
            auth: false,
        },
        text: {
            limit: 4096,
        },
        file: {
            expire: 31536000,
            chunk: 2000097152,
            limit: 10737418240,
        },
        nav: [
            {icon: '/favicon.ico', label: '云剪贴板', link: '/cloud-cp'},
            {icon: '/favicon.ico', label: 'GPT', link: '/gpt'},
            {icon: '/favicon.ico', label: '家庭助理', link: '/ha'},
            {icon: '/favicon.ico', label: '识图', link: '/ocr'},
        ]
    }, null, 4));
}

/**
 * @type {{
 *  server: {
 *      host: String | String[],
 *      port: [Number],
 *      uds: [String],
 *      prefix: [String],
 *      key: [String],
 *      cert: [String],
 *      forceWss: [Boolean],
 *      history: Number,
 *      auth: Boolean,
 *  },
 *  text: {
 *      limit: Number,
 *  },
 *  file: {
 *      expire: Number,
 *      chunk: Number,
 *      limit: Number,
 *  },
 *  nav: [
 *      { icon:[String], link: [String], label:[String] },
 *  ]
 * }}
 */
const config = JSON.parse(fs.readFileSync(process.argv[2] || defaultConfigPath));

if (!config.server.prefix) {
    config.server.prefix = '';
}
if (config.server.auth === true) {
    config.server.auth = '';
    for (let i = 0; i < 6; i++) {
        config.server.auth += '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'[crypto.randomInt(62)];
    }
}
if (config.server.auth) {
    config.server.auth = config.server.auth.toString();
}

export default config;