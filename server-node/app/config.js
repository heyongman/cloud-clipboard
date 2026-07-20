import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const defaultConfigPath = path.join(process.cwd(), 'config.json');

if (!process.argv[2] && !fs.existsSync(defaultConfigPath)) {
    console.log(`\x1b[93mConfig file "${defaultConfigPath}" does not exist.\x1b[39m`);
    console.log('\x1b[93mA default config file is created and used. Check the descriptions in the repository\'s README.md to modify it.\x1b[39m');
    fs.writeFileSync(defaultConfigPath, JSON.stringify({
        server: {
            host: ['::'],
            port: 80,
            httpsPort: 443,
            uds: null,
            prefix: '',
            key: null,
            cert: null,
            history: 10,
            auth: false,
            historyFile: null,
            subscriptionFile: null,
            aiConfigFile: null,
            storageDir: null,
            shanhai: {
                enabled: false,
                email: '',
                password: '',
                tokenFile: null,
                ossUrls: null,
            },
        },
        text: {
            limit: 4096,
        },
        file: {
            chunk: 2097152,
            limit: 268435456,
        },
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
 *      historyFile: [String],
 *      subscriptionFile: [String],
 *      aiConfigFile: [String],
 *      storageDir: [String],
 *      shanhai: {
 *          enabled: Boolean,
 *          email: [String],
 *          password: [String],
 *          tokenFile: [String],
 *          ossUrls: [String[]],
 *      },
 *  },
 *  text: {
 *      limit: Number,
 *  },
 *  file: {
 *      chunk: Number,
 *      limit: Number,
 *  },
 * }}
 */
const config = JSON.parse(fs.readFileSync(process.argv[2] || defaultConfigPath));

if (!config.server.prefix) {
    config.server.prefix = '';
} else {
    config.server.prefix = `/${config.server.prefix.toString().replace(/^\/+|\/+$/g, '')}`;
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
if (config.file && config.file.expire !== undefined) {
    delete config.file.expire;
}

// 归一化 shanhai 配置（向后兼容：缺失时按禁用处理）
const rawShanhai = config.server.shanhai && typeof config.server.shanhai === 'object'
    ? config.server.shanhai
    : {};
// tokenFile 默认存于上传存储目录下（与 server-node/app/uploaded-file.js 的 storageFolder 一致）
const shanhaiStorageDir = config.server.storageDir || path.join(os.tmpdir(), '.cloud-clipboard-storage');
config.server.shanhai = {
    enabled: rawShanhai.enabled === true,
    email: typeof rawShanhai.email === 'string' ? rawShanhai.email : '',
    password: typeof rawShanhai.password === 'string' ? rawShanhai.password : '',
    tokenFile: typeof rawShanhai.tokenFile === 'string' && rawShanhai.tokenFile
        ? rawShanhai.tokenFile
        : path.join(shanhaiStorageDir, 'shanhai-token.json'),
    ossUrls: Array.isArray(rawShanhai.ossUrls) ? rawShanhai.ossUrls : null,
};

export default config;
