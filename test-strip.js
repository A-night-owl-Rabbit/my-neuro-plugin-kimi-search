const KimiSearchPlugin = require('./index.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

(async () => {
    let raw = fs.readFileSync(path.join(__dirname, 'plugin_config.json'), 'utf-8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const cfgRaw = JSON.parse(raw);
    const cfg = {};
    for (const [k, v] of Object.entries(cfgRaw)) {
        cfg[k] = (v && typeof v === 'object' && 'type' in v) ? v.value : v;
    }

    const fakeContext = {
        getPluginConfig: () => cfg,
        log: (lvl, msg) => console.log(`[${lvl}]`, msg),
    };

    const plugin = new KimiSearchPlugin();
    plugin.context = fakeContext;
    await plugin.onInit();

    console.log('\n===== 走插件 executeTool 完整流程 =====\n');
    const result = await plugin.executeTool('kimi_web_search', {
        query: '鸣潮里冰原下的星炬的结局',
    });

    console.log('\n----- 主 LLM 实际收到的内容 -----');
    console.log(result);
    console.log('--------------------------------');
    console.log(`\n字数: ${result.length}`);

    const hasCitationList = /搜索结果来自|【检索/.test(result);
    const hasFootnote = /\[\^\d+\^\]/.test(result);
    const hasUrl = /https?:\/\//.test(result);
    console.log(`包含「搜索结果来自/【检索】」: ${hasCitationList ? '❌ 仍有' : '✅ 已剥离'}`);
    console.log(`包含 [^N^] 角标: ${hasFootnote ? '❌ 仍有' : '✅ 已剥离'}`);
    console.log(`包含 URL: ${hasUrl ? '⚠️  有残留' : '✅ 已清除'}`);
})().catch((e) => {
    console.error('FAIL:', e.message);
    process.exit(1);
});
