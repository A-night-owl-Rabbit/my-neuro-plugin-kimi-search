const fs = require('fs');
const path = require('path');
const KimiSearchPlugin = require('./index.js');

function loadFlatCfg() {
    let raw = fs.readFileSync(path.join(__dirname, 'plugin_config.json'), 'utf-8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const cfgRaw = JSON.parse(raw);
    const cfg = {};
    for (const [k, v] of Object.entries(cfgRaw)) {
        cfg[k] = (v && typeof v === 'object' && 'type' in v) ? v.value : v;
    }
    return cfg;
}

(async () => {
    const cfg = loadFlatCfg();
    const fakeContext = {
        getPluginConfig: () => cfg,
        log: (lvl, msg) => console.log(`  [${lvl}]`, msg),
    };

    const plugin = new KimiSearchPlugin();
    plugin.context = fakeContext;
    await plugin.onInit();

    console.log('\n===== 深度研究模式测试 =====');
    console.log('Provider:', cfg.provider);
    console.log('Model:', cfg.official_model);
    console.log('');

    const t0 = Date.now();
    const result = await plugin.executeTool('kimi_web_search', {
        query: '鸣潮里冰原下的星炬的结局',
        deep_research: true,
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    console.log('\n----- 主 LLM 实际收到的内容 -----');
    console.log(result);
    console.log('--------------------------------');
    console.log(`\n字数: ${result.length}, 耗时: ${elapsed}s`);
})().catch((e) => {
    console.error('FAIL:', e);
    process.exit(1);
});
