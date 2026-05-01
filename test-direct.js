const fs = require('fs');
const path = require('path');
const axios = require('axios');

let raw = fs.readFileSync(path.join(__dirname, 'plugin_config.json'), 'utf-8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
const cfg = JSON.parse(raw);
const token = cfg.refresh_token.value;
const baseUrl = cfg.base_url.value.replace(/\/+$/, '');
const model = cfg.model.value;

const query = process.argv[2] || '鸣潮里冰原下的星炬的结局';

console.log('===== Direct Kimi test (UTF-8 safe) =====');
console.log('Query:', query);
console.log('Model:', model);
console.log('Backend:', baseUrl);
console.log('');

(async () => {
    const t0 = Date.now();
    try {
        const resp = await axios.post(
            `${baseUrl}/chat/completions`,
            {
                model,
                messages: [{ role: 'user', content: query }],
                use_search: true,
                stream: false,
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                timeout: 90000,
            }
        );
        const answer = resp.data?.choices?.[0]?.message?.content || '[empty]';
        console.log(`OK ${answer.length} chars in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        console.log('');
        console.log('----- Kimi answer -----');
        console.log(answer);
        console.log('-----------------------');
    } catch (e) {
        console.error('FAIL:', e.message);
        if (e.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
        process.exit(1);
    }
})();
